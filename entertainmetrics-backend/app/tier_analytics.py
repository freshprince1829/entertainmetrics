"""Descriptive tier analytics.

Shares, sell-through and sell-out times describe which tiers buyers chose.
They are not demand curves or causal estimates: a tier selling out fast says
nothing on its own about what would have happened at another price.
"""

from datetime import date

from . import models
from .pricing import PRICE_BANDS, latest_tier_snapshot, sorted_tiers
from .sales import as_utc, pct, sort_snapshots

DESCRIPTIVE_NOTE = (
    "Descriptive statistics of the tiers buyers chose. They are not demand curves "
    "or causal estimates of how buyers would respond to different prices."
)

# Cross-event tier patterns need at least this many completed events.
MIN_EVENTS_FOR_TIER_PATTERNS = 2


def _days_to_sell_out(tier: models.TicketTier, ordered_tier_snapshots) -> float | None:
    """Days from the event's first tier snapshot until this tier first reached
    its quantity. None when the quantity is unknown or it has not sold out."""
    if not tier.quantity_available or not ordered_tier_snapshots:
        return None
    start = as_utc(ordered_tier_snapshots[0].recorded_at)
    for snapshot in ordered_tier_snapshots:
        row = next((r for r in snapshot.tier_sales_rows if r.tier_id == tier.id), None)
        if row is not None and row.tickets_sold >= tier.quantity_available:
            seconds = (as_utc(snapshot.recorded_at) - start).total_seconds()
            return round(seconds / 86400, 1)
    return None


def _group(items: list[dict], key: str, total_tickets: int, total_revenue: float) -> list[dict]:
    groups: dict[str, dict] = {}
    for item in items:
        group = groups.setdefault(item[key], {"key": item[key], "tickets": 0, "revenue": 0.0})
        group["tickets"] += item["tickets_sold"]
        group["revenue"] += item["revenue"]
    result = []
    for group in groups.values():
        group["revenue"] = round(group["revenue"], 2)
        group["share_of_tickets_pct"] = pct(group["tickets"], total_tickets)
        group["share_of_revenue_pct"] = pct(group["revenue"], total_revenue)
        result.append(group)
    return sorted(result, key=lambda g: -g["tickets"])


def _days_text(days: float) -> str:
    whole = round(days)
    if abs(days - whole) < 0.05:
        return f"{whole} day" + ("" if whole == 1 else "s")
    return f"{days} days"


def compute_tier_analytics(
    event: models.Event,
    tiers: list[models.TicketTier],
    snapshots: list[models.TicketSalesSnapshot],
) -> dict:
    latest = latest_tier_snapshot(snapshots)
    empty = {
        "event_id": event.id,
        "has_tier_data": False,
        "tiers": [],
        "by_sale_phase": [],
        "by_access_level": [],
        "by_audience": [],
        "affordability_profile": [],
        "insights": [],
        "note": DESCRIPTIVE_NOTE,
    }
    if latest is None:
        return {**empty, "message": "No tier-level sales have been recorded for this event yet."}

    rows = {row.tier_id: row for row in latest.tier_sales_rows}
    ordered = sorted_tiers(tiers)
    tier_snapshots = [s for s in sort_snapshots(snapshots) if s.tier_sales_rows]
    total_tickets = sum(rows[t.id].tickets_sold for t in ordered if t.id in rows)
    total_revenue = round(
        sum(rows[t.id].tickets_sold * t.price for t in ordered if t.id in rows), 2
    )
    if total_tickets == 0:
        return {
            **empty,
            "snapshot_id": latest.id,
            "recorded_at": as_utc(latest.recorded_at),
            "message": "Tier sales are recorded, but no tickets have been sold yet.",
        }

    items = []
    for tier in ordered:
        row = rows.get(tier.id)
        sold = row.tickets_sold if row else 0
        checked_in = row.checked_in if row else None
        revenue = round(sold * tier.price, 2)
        items.append(
            {
                "tier_id": tier.id,
                "name": tier.name,
                "price": tier.price,
                "sale_phase": tier.sale_phase,
                "access_level": tier.access_level,
                "audience": tier.audience,
                "partner_name": tier.partner_name,
                "price_band": tier.price_band,
                "is_premium": tier.is_premium,
                "quantity_available": tier.quantity_available,
                "tickets_sold": sold,
                "revenue": revenue,
                "share_of_tickets_pct": pct(sold, total_tickets),
                "share_of_revenue_pct": pct(revenue, total_revenue),
                "sell_through_pct": pct(sold, tier.quantity_available),
                "days_to_sell_out": _days_to_sell_out(tier, tier_snapshots),
                "realized_average_price": round(revenue / sold, 2) if sold else None,
                # Contribution to the event's average price: these add up to it.
                "revenue_per_ticket": round(revenue / total_tickets, 2),
                "checked_in": checked_in,
                "show_rate_pct": pct(checked_in, sold) if checked_in is not None else None,
            }
        )

    band_groups = {g["key"]: g for g in _group(items, "price_band", total_tickets, total_revenue)}
    affordability = [band_groups[band] for band in PRICE_BANDS if band in band_groups]

    partner_items = [i for i in items if i["audience"] == "partner" and i["tickets_sold"]]
    partner_tickets = sum(i["tickets_sold"] for i in partner_items)
    partner_revenue = sum(i["revenue"] for i in partner_items)
    partner_average = round(partner_revenue / partner_tickets, 2) if partner_tickets else None
    partner_names = sorted({i["partner_name"] for i in partner_items if i["partner_name"]})

    realized_average = round(total_revenue / total_tickets, 2)

    # Fixed, plain-language rules.
    insights = []
    for item in items:
        if item["days_to_sell_out"] is not None:
            insights.append(f"{item['name']} sold out in {_days_text(item['days_to_sell_out'])}.")
    for item in items:
        if item["is_premium"] and item["tickets_sold"]:
            insights.append(
                f"{item['name']}: {item['share_of_tickets_pct']}% of tickets, "
                f"{item['share_of_revenue_pct']}% of revenue."
            )
    if partner_tickets:
        insights.append(
            f"Partner tickets: {pct(partner_tickets, total_tickets)}% of tickets at an "
            f"average of KES {partner_average:,.0f}"
            + (f" ({', '.join(partner_names)})." if partner_names else ".")
        )
    if affordability:
        top_band = max(affordability, key=lambda g: g["tickets"])
        insights.append(
            f"Most tickets ({top_band['share_of_tickets_pct']}%) were sold in the "
            f"{top_band['key']} price band."
        )
    show_rates = [i for i in items if i["show_rate_pct"] is not None]
    if show_rates:
        lowest = min(show_rates, key=lambda i: i["show_rate_pct"])
        insights.append(
            f"Lowest show rate: {lowest['name']} at {lowest['show_rate_pct']}% of "
            "tickets sold checked in."
        )
    insights.append(f"Realized average price is KES {realized_average:,.0f} per ticket.")

    return {
        "event_id": event.id,
        "has_tier_data": True,
        "message": None,
        "snapshot_id": latest.id,
        "recorded_at": as_utc(latest.recorded_at),
        "tickets_sold_total": total_tickets,
        "revenue_total": total_revenue,
        "realized_average_price": realized_average,
        "partner_discount_share_pct": pct(partner_tickets, total_tickets),
        "partner_average_price": partner_average,
        "tiers": items,
        "by_sale_phase": _group(items, "sale_phase", total_tickets, total_revenue),
        "by_access_level": _group(items, "access_level", total_tickets, total_revenue),
        "by_audience": _group(items, "audience", total_tickets, total_revenue),
        "affordability_profile": affordability,
        "insights": insights,
        "note": DESCRIPTIVE_NOTE,
    }


def compute_cross_event_patterns(events: list[models.Event], today: date) -> dict:
    """Average tier shares across completed events: event date passed AND
    final actuals recorded, so live or unfinalized numbers never enter."""
    per_event = []
    early_bird_days = []
    for event in events:
        if event.event_date >= today or event.actual_attendance is None:
            continue
        analytics = compute_tier_analytics(event, event.tiers, event.sales_snapshots)
        if not analytics["has_tier_data"]:
            continue
        per_event.append(analytics)
        early_bird_days.extend(
            t["days_to_sell_out"] for t in analytics["tiers"]
            if t["sale_phase"] == "early_bird" and t["days_to_sell_out"] is not None
        )

    used = len(per_event)

    def averages(dimension: str) -> list[dict]:
        keys = sorted({g["key"] for a in per_event for g in a[dimension]})
        result = []
        for key in keys:
            # An event without this category contributes a 0% share.
            groups = [next((g for g in a[dimension] if g["key"] == key), None) for a in per_event]
            result.append(
                {
                    "key": key,
                    "avg_share_of_tickets_pct": round(
                        sum(g["share_of_tickets_pct"] or 0 for g in groups if g) / used, 1
                    ),
                    "avg_share_of_revenue_pct": round(
                        sum(g["share_of_revenue_pct"] or 0 for g in groups if g) / used, 1
                    ),
                    "events_with_key": sum(1 for g in groups if g),
                }
            )
        return sorted(result, key=lambda r: -r["avg_share_of_tickets_pct"])

    sufficient = used >= MIN_EVENTS_FOR_TIER_PATTERNS
    if sufficient:
        explanation = f"Averaged over {used} completed events with tier-level sales."
    else:
        explanation = (
            f"Not enough history yet: {used} completed event(s) with tier sales and final "
            f"actuals; at least {MIN_EVENTS_FOR_TIER_PATTERNS} are needed."
        )

    return {
        "events_used": used,
        "min_events_required": MIN_EVENTS_FOR_TIER_PATTERNS,
        "sufficient_history": sufficient,
        "by_access_level": averages("by_access_level") if used else [],
        "by_sale_phase": averages("by_sale_phase") if used else [],
        "by_audience": averages("by_audience") if used else [],
        "avg_early_bird_days_to_sell_out": (
            round(sum(early_bird_days) / len(early_bird_days), 1) if early_bird_days else None
        ),
        "early_bird_tiers_sold_out": len(early_bird_days),
        "explanation": explanation,
        "note": DESCRIPTIVE_NOTE,
    }
