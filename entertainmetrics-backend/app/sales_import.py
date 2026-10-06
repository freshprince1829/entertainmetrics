"""CSV import of ticket sales into tier snapshots.

Each CSV row is a cumulative count for one ticket type at one date/time
(like a snapshot). Rows sharing a date/time become one snapshot; tiers not
listed at that time keep their previous count. The import is all-or-nothing:
every row must be valid and every ticket type matched, mapped or created,
and the existing cumulative / capacity / date rules apply to the result.
"""

import csv
import io
from datetime import datetime, time, timedelta, timezone

from . import models, schemas
from .sales import SnapshotRejected, as_utc, resolve_tier_sales, sort_snapshots, validate_new_snapshot

MAX_IMPORT_ROWS = 5000
IMPORT_NOTE = "Imported from CSV"
# Rows with only a date are treated as end-of-day counts.
DATE_ONLY_TIME = time(23, 59)

COLUMN_ALIASES = {
    "recorded_at": ("date_time", "datetime", "recorded_at", "timestamp", "date"),
    "time": ("time",),
    "ticket_type": ("ticket_type", "type", "tier", "ticket", "ticket_name", "category"),
    "quantity": ("quantity", "qty", "sold", "tickets", "tickets_sold", "count"),
    "revenue": ("revenue", "amount", "total", "sales"),
    "scanned_in": ("scanned_in", "checked_in", "scanned", "scans", "scan_ins"),
}
DATETIME_FORMATS = (
    "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M",
    "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M",
)
DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y")

# Keyword suggestions for unmatched ticket types.
PARTNER_BRANDS = {
    "equity": "Equity Bank", "kcb": "KCB", "absa": "Absa", "stanbic": "Stanbic",
    "ncba": "NCBA", "co-op": "Co-op Bank", "coop": "Co-op Bank", "safaricom": "Safaricom",
    "m-pesa": "M-Pesa", "mpesa": "M-Pesa", "airtel": "Airtel", "visa": "Visa",
    "mastercard": "Mastercard", "family bank": "Family Bank", "dtb": "DTB",
    "standard chartered": "Standard Chartered", "i&m": "I&M Bank",
}
PARTNER_WORDS = ("partner", "bank", "card", "sponsor")
GROUP_WORDS = ("group", "couple", "squad", "table", "bundle", "pair")
COMPLIMENTARY_WORDS = ("comp", "complimentary", "guest list", "guestlist", "free")


def suggest_tags(ticket_type: str) -> dict:
    """Guess access level, sale phase and audience from keywords."""
    text = ticket_type.lower()
    if "vvip" in text:
        access = "vvip"
    elif "vip" in text:
        access = "vip"
    elif "all access" in text or "all-access" in text or "backstage" in text:
        access = "all_access"
    elif any(word in text for word in GROUP_WORDS):
        access = "group"
    else:
        access = "general"

    if "early" in text:
        phase = "early_bird"
    elif "last minute" in text or "last-minute" in text or "late" in text:
        phase = "last_minute"
    elif "gate" in text or "door" in text or "walk" in text:
        phase = "gate"
    elif "advance" in text or "presale" in text or "pre-sale" in text:
        phase = "advance"
    elif access in ("vip", "vvip", "all_access"):
        phase = "premium"
    else:
        phase = "standard"

    partner_name = next((name for key, name in PARTNER_BRANDS.items() if key in text), None)
    if partner_name or any(word in text for word in PARTNER_WORDS):
        audience = "partner"
    elif any(word in text for word in COMPLIMENTARY_WORDS):
        audience = "complimentary"
    elif access == "group":
        audience = "group"
    else:
        audience = "public"

    return {
        "suggested_access_level": access,
        "suggested_sale_phase": phase,
        "suggested_audience": audience,
        "suggested_partner_name": partner_name,
    }


def _normalise(header: str) -> str:
    return header.strip().lower().replace(" ", "_").replace("-", "_")


def _find_columns(fieldnames: list[str]) -> dict:
    normalised = {_normalise(name): name for name in fieldnames if name}
    found = {}
    for key, aliases in COLUMN_ALIASES.items():
        found[key] = next((normalised[a] for a in aliases if a in normalised), None)
    return found


def _parse_datetime(value: str, time_value: str | None, tz: timezone) -> datetime:
    value = value.strip()
    if time_value and time_value.strip():
        value = f"{value} {time_value.strip()}"
    for fmt in DATETIME_FORMATS:
        try:
            parsed = datetime.strptime(value, fmt)
            break
        except ValueError:
            continue
    else:
        for fmt in DATE_FORMATS:
            try:
                parsed = datetime.combine(datetime.strptime(value, fmt).date(), DATE_ONLY_TIME)
                break
            except ValueError:
                continue
        else:
            try:
                parsed = datetime.fromisoformat(value)
            except ValueError as error:
                raise ValueError(f"unrecognised date/time '{value}'") from error
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=tz)


def _parse_int(value: str, field: str) -> int | None:
    value = (value or "").strip().replace(",", "")
    if value == "":
        return None
    try:
        number = float(value)
    except ValueError as error:
        raise ValueError(f"{field} '{value}' is not a number") from error
    if number < 0 or number != int(number):
        raise ValueError(f"{field} must be a whole number of 0 or more")
    return int(number)


def _parse_money(value: str) -> float | None:
    value = (value or "").strip().replace(",", "").replace("KES", "").strip()
    if value == "":
        return None
    try:
        amount = float(value)
    except ValueError as error:
        raise ValueError(f"revenue '{value}' is not a number") from error
    if amount < 0:
        raise ValueError("revenue cannot be negative")
    return amount


def run_import(
    *,
    event: models.Event,
    existing_tiers: list[models.TicketTier],
    existing_snapshots: list[models.TicketSalesSnapshot],
    request: schemas.SalesImportRequest,
    tier_factory,
) -> dict:
    """Parse, match and validate. Returns the preview plus the transient
    snapshots to save. `tier_factory(spec)` returns a tier object for each
    tier the caller asked to create (transient for a dry run, flushed for a
    real import)."""
    errors: list[str] = []
    tz = timezone(timedelta(minutes=request.utc_offset_minutes))

    reader = csv.DictReader(io.StringIO(request.csv_text.lstrip("﻿")))
    columns = _find_columns(reader.fieldnames or [])
    missing = [c for c in ("recorded_at", "ticket_type", "quantity") if not columns[c]]
    if missing:
        names = {"recorded_at": "date/time", "ticket_type": "ticket type", "quantity": "quantity"}
        return _result(errors=[
            "Missing required column(s): " + ", ".join(names[m] for m in missing)
            + ". Expected headers like date_time, ticket_type, quantity."
        ])

    tiers_by_name = {t.name.strip().lower(): t for t in existing_tiers}
    mappings = {k.strip().lower(): v for k, v in request.mappings.items()}
    tiers_by_id = {t.id: t for t in existing_tiers}
    created_by_type = {}
    for spec in request.create_tiers:
        key = spec.ticket_type.strip().lower()
        name = (spec.name or spec.ticket_type).strip()
        if name.lower() in tiers_by_name:
            errors.append(f"Cannot create tier '{name}': the event already has a tier with that name.")
            continue
        tier = tier_factory(spec)
        created_by_type[key] = tier
        tiers_by_id[tier.id] = tier
    for ticket_type, tier_id in request.mappings.items():
        if tier_id not in tiers_by_id:
            errors.append(f"Mapping for '{ticket_type}' points to a tier that is not in this event.")

    rows = []
    unmatched: dict[str, dict] = {}
    for number, raw in enumerate(reader, start=2):  # row 1 is the header
        if number - 1 > MAX_IMPORT_ROWS:
            errors.append(f"Too many rows: at most {MAX_IMPORT_ROWS} rows can be imported at once.")
            break
        if not any((value or "").strip() for value in raw.values()):
            continue
        row = {"row_number": number, "ticket_type": (raw.get(columns["ticket_type"]) or "").strip(),
               "errors": [], "status": "error", "tier_id": None, "tier_name": None}
        try:
            row["recorded_at"] = _parse_datetime(
                raw.get(columns["recorded_at"]) or "",
                raw.get(columns["time"]) if columns["time"] else None,
                tz,
            )
        except ValueError as error:
            row["recorded_at"] = None
            row["errors"].append(str(error))
        for field, parser in (("quantity", lambda v: _parse_int(v, "quantity")),
                              ("revenue", _parse_money),
                              ("scanned_in", lambda v: _parse_int(v, "scanned-in count"))):
            column = columns[field]
            try:
                row[field] = parser(raw.get(column) or "") if column else None
            except ValueError as error:
                row[field] = None
                row["errors"].append(str(error))
        if row["quantity"] is None and not any("quantity" in e for e in row["errors"]):
            row["errors"].append("quantity is required")
        if not row["ticket_type"]:
            row["errors"].append("ticket type is required")
        if (row["scanned_in"] is not None and row["quantity"] is not None
                and row["scanned_in"] > row["quantity"]):
            row["errors"].append("scanned-in count cannot exceed quantity")

        key = row["ticket_type"].lower()
        tier = None
        if key in tiers_by_name:
            tier, row["status"] = tiers_by_name[key], "matched"
        elif key in mappings and mappings[key] in tiers_by_id:
            tier, row["status"] = tiers_by_id[mappings[key]], "mapped"
        elif key in created_by_type:
            tier, row["status"] = created_by_type[key], "new_tier"
        elif row["ticket_type"]:
            row["status"] = "unmatched"
            entry = unmatched.setdefault(key, {"ticket_type": row["ticket_type"], "rows": 0,
                                               "suggested_price": None, **suggest_tags(row["ticket_type"])})
            entry["rows"] += 1
            if row["revenue"] and row["quantity"]:
                entry["suggested_price"] = round(row["revenue"] / row["quantity"], 2)
        if tier is not None:
            row["tier_id"] = tier.id if tier.id and tier.id > 0 else None
            row["tier_name"] = tier.name
            row["_tier"] = tier
            if row["revenue"] is not None and row["quantity"] is not None:
                expected = row["quantity"] * tier.price
                if abs(row["revenue"] - expected) > 0.5:
                    row["errors"].append(
                        f"revenue {row['revenue']:,.2f} does not match quantity x tier price "
                        f"({expected:,.2f})"
                    )
        if row["errors"]:
            row["status"] = "error"
        rows.append(row)

    if not rows and not errors:
        errors.append("The CSV has no data rows.")

    # Duplicate ticket type at the same time would be ambiguous.
    seen = {}
    for row in rows:
        if row.get("_tier") is not None and row["recorded_at"] is not None:
            key = (row["recorded_at"], id(row["_tier"]))
            if key in seen:
                row["errors"].append(f"duplicate of row {seen[key]} (same ticket type and time)")
                row["status"] = "error"
            else:
                seen[key] = row["row_number"]

    row_errors = [r for r in rows if r["errors"]]
    for row in row_errors:
        errors.append(f"Row {row['row_number']}: " + "; ".join(row["errors"]))
    if unmatched:
        errors.append(
            "Unmatched ticket type(s): " + ", ".join(u["ticket_type"] for u in unmatched.values())
            + ". Map each to an existing tier or create it."
        )

    built = []
    if not errors:
        built, snapshot_errors = _build_snapshots(event, rows, tiers_by_id, existing_snapshots)
        errors.extend(snapshot_errors)

    return _result(
        rows=rows,
        unmatched=list(unmatched.values()),
        errors=errors,
        built=built if not errors else [],
    )


def _build_snapshots(event, rows, tiers_by_id, existing_snapshots):
    """Group rows by time, carry forward tiers not listed, and validate each
    resulting snapshot against everything before and after it."""
    combined = list(existing_snapshots)
    groups: dict[datetime, list[dict]] = {}
    for row in rows:
        groups.setdefault(as_utc(row["recorded_at"]), []).append(row)

    built, errors = [], []
    for when in sorted(groups):
        group = groups[when]
        listed = {row["_tier"].id: row for row in group}
        sales = []
        for tier_id in tiers_by_id:
            previous = _previous_row(combined, tier_id, when)
            if tier_id in listed:
                row = listed[tier_id]
                # Without a scanned-in value, keep the tier's previous
                # check-in count (check-ins are cumulative too).
                checked_in = row["scanned_in"]
                if checked_in is None and previous is not None:
                    checked_in = previous.checked_in
                sales.append({"tier_id": tier_id, "tickets_sold": row["quantity"],
                              "checked_in": checked_in})
                continue
            if previous is not None:
                sales.append({"tier_id": tier_id, "tickets_sold": previous.tickets_sold,
                              "checked_in": previous.checked_in})
        local_time = group[0]["recorded_at"]
        try:
            snapshot = schemas.SalesSnapshotCreate(
                recorded_at=local_time, notes=IMPORT_NOTE,
                tier_sales=[schemas.TierSaleInput(**sale) for sale in sales],
            )
            resolved = resolve_tier_sales(snapshot, tiers_by_id, combined)
            message = validate_new_snapshot(event, combined, resolved)
            if message:
                raise SnapshotRejected(400, message)
        except SnapshotRejected as rejection:
            numbers = ", ".join(str(r["row_number"]) for r in group)
            errors.append(f"Rows {numbers} ({local_time:%Y-%m-%d %H:%M}): {rejection.message}")
            continue
        except ValueError as error:  # pydantic validation
            numbers = ", ".join(str(r["row_number"]) for r in group)
            errors.append(f"Rows {numbers}: {error}")
            continue
        transient = models.TicketSalesSnapshot(
            event_id=event.id,
            recorded_at=as_utc(resolved.recorded_at),
            tickets_sold_total=resolved.tickets_sold_total,
            gate_tickets_sold=resolved.gate_tickets_sold,
            attendance_checked_in=resolved.attendance_checked_in,
            revenue_to_date=resolved.revenue_to_date,
            notes=IMPORT_NOTE,
        )
        transient.tier_sales_rows = [
            models.SnapshotTierSales(tier_id=s.tier_id, tickets_sold=s.tickets_sold,
                                     checked_in=s.checked_in)
            for s in resolved.tier_sales
        ]
        combined.append(transient)
        built.append(transient)
    return built, errors


def _previous_row(snapshots, tier_id, when):
    for snapshot in reversed(sort_snapshots(snapshots)):
        if as_utc(snapshot.recorded_at) <= when:
            row = next((r for r in snapshot.tier_sales_rows if r.tier_id == tier_id), None)
            if row is not None:
                return row
    return None


def _result(rows=None, unmatched=None, errors=None, built=None) -> dict:
    rows = rows or []
    return {
        "can_import": not errors,
        "rows": [{k: v for k, v in row.items() if not k.startswith("_")} for row in rows],
        "unmatched_types": unmatched or [],
        "errors": errors or [],
        "snapshots": [
            {
                "recorded_at": as_utc(s.recorded_at),
                "tickets_sold_total": s.tickets_sold_total,
                "gate_tickets_sold": s.gate_tickets_sold,
                "revenue_to_date": s.revenue_to_date,
                "attendance_checked_in": s.attendance_checked_in,
            }
            for s in (built or [])
        ],
        "_built": built or [],
    }
