"""Rule-based ticket sales and attendance tracking.

Snapshots are cumulative readings (tickets sold, gate sales, people checked in,
revenue) recorded before and during an event. Everything here is plain
arithmetic so each number can be explained; there is no machine learning.
"""

from datetime import date, datetime, timedelta, timezone

from . import models, schemas

# Snapshots may be logged up to this many days after the event date, so late
# gate / door counts can still be entered.
LATE_ENTRY_GRACE_DAYS = 1

# Sales velocity is measured over the snapshots from the last N days.
VELOCITY_WINDOW_DAYS = 7
# Floor for the velocity time span, so two counts taken minutes apart on event
# day are not extrapolated into an unrealistic tickets-per-day rate.
MIN_VELOCITY_SPAN_DAYS = 1.0

# Live status: within +/- this percentage of the prediction counts as on track.
LIVE_STATUS_TOLERANCE_PCT = 10.0

# Learned event-day patterns are only trusted with at least this many
# completed events.
MIN_EVENTS_FOR_PATTERNS = 2

# Prediction integration (only used with enough snapshots).
MIN_SNAPSHOTS_FOR_SALES_SIGNAL = 2
SALES_PROJECTION_WEIGHT = 0.6
BASE_FORMULA_WEIGHT = 0.4
SNAPSHOT_CONFIDENCE_STEP = 0.01
MAX_SNAPSHOT_CONFIDENCE_BOOST = 0.05
# Upper bound on the learned gate share, so gate / (1 - gate) stays finite.
MAX_GATE_SHARE = 0.9

CUMULATIVE_FIELDS = (
    "tickets_sold_total",
    "gate_tickets_sold",
    "attendance_checked_in",
    "revenue_to_date",
)


def as_utc(value: datetime) -> datetime:
    """Treat naive datetimes (e.g. from SQLite) as UTC so they compare safely."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def sort_snapshots(snapshots: list[models.TicketSalesSnapshot]):
    return sorted(snapshots, key=lambda s: (as_utc(s.recorded_at), s.id or 0))


def validate_new_snapshot(
    event: models.Event,
    existing: list[models.TicketSalesSnapshot],
    new: schemas.SalesSnapshotCreate,
) -> str | None:
    """Return an error message if the snapshot is not acceptable, else None.

    Field-level checks (>= 0, gate <= total, attendance <= total) are handled
    by the request schema; this covers checks that need the event or history.
    """
    if new.tickets_sold_total > event.capacity:
        return (
            f"tickets_sold_total ({new.tickets_sold_total}) cannot exceed "
            f"event capacity ({event.capacity})"
        )

    # The calendar date is taken in the timezone the client sent, i.e. the
    # local date at the venue.
    latest_allowed = event.event_date + timedelta(days=LATE_ENTRY_GRACE_DAYS)
    if new.recorded_at.date() > latest_allowed:
        return (
            "recorded_at is too late: snapshots can be logged up to "
            f"{LATE_ENTRY_GRACE_DAYS} day after the event ({latest_allowed.isoformat()})"
        )

    # Values are cumulative, so they may never go down over time. Compare with
    # the closest snapshot before and after the new one's timestamp.
    new_time = as_utc(new.recorded_at)
    ordered = sort_snapshots(existing)
    previous = [s for s in ordered if as_utc(s.recorded_at) <= new_time]
    following = [s for s in ordered if as_utc(s.recorded_at) > new_time]

    for field in CUMULATIVE_FIELDS:
        new_value = getattr(new, field)
        if new_value is None:
            continue
        if previous:
            before = getattr(previous[-1], field)
            if before is not None and new_value < before:
                return (
                    f"{field} ({new_value}) is lower than the previous snapshot "
                    f"({before}); values are cumulative and cannot decrease"
                )
        if following:
            after = getattr(following[0], field)
            if after is not None and new_value > after:
                return (
                    f"{field} ({new_value}) is higher than the next snapshot "
                    f"({after}); values are cumulative and cannot decrease"
                )

    return None


def pct(part, whole) -> float | None:
    if part is None or not whole:
        return None
    return round(part / whole * 100, 1)


def event_phase(event_date: date, today: date) -> str:
    if today < event_date:
        return "pre-event"
    if today == event_date:
        return "event-day"
    return "post-event"


def sales_velocity(ordered: list[models.TicketSalesSnapshot]) -> float | None:
    """Tickets sold per day across the last VELOCITY_WINDOW_DAYS of snapshots
    (all snapshots if they span less than that). None with fewer than 2."""
    if len(ordered) < 2:
        return None
    latest = ordered[-1]
    latest_time = as_utc(latest.recorded_at)
    window_start = latest_time - timedelta(days=VELOCITY_WINDOW_DAYS)
    window = [s for s in ordered if as_utc(s.recorded_at) >= window_start]
    if len(window) < 2:
        window = ordered[-2:]
    first = window[0]
    span_days = (latest_time - as_utc(first.recorded_at)).total_seconds() / 86400
    span_days = max(span_days, MIN_VELOCITY_SPAN_DAYS)
    return round((latest.tickets_sold_total - first.tickets_sold_total) / span_days, 2)


def projected_final_sales(
    latest_total: int, velocity: float | None, days_until_event: int, capacity: int
) -> int:
    """Latest total plus the current velocity over the remaining days, capped
    at capacity. On or after event day nothing further is projected."""
    projected = latest_total + (velocity or 0) * max(days_until_event, 0)
    return int(min(capacity, max(round(projected), latest_total)))


def final_actuals_preview(
    event: models.Event, latest: models.TicketSalesSnapshot
) -> dict:
    """The values close-out would write. Attendance uses check-ins when
    recorded, otherwise tickets sold. Revenue is only replaced when the
    snapshot has a revenue figure; otherwise the event's value is kept."""
    if latest.attendance_checked_in is not None:
        attendance, attendance_source = latest.attendance_checked_in, "attendance_checked_in"
    else:
        attendance, attendance_source = latest.tickets_sold_total, "tickets_sold_total"

    if latest.revenue_to_date is not None:
        revenue, revenue_source = latest.revenue_to_date, "revenue_to_date"
    else:
        revenue, revenue_source = event.revenue, "unchanged"

    return {
        "snapshot_id": latest.id,
        "recorded_at": latest.recorded_at,
        "actual_attendance": attendance,
        "attendance_source": attendance_source,
        "revenue": revenue,
        "revenue_source": revenue_source,
    }


def compute_progress(
    event: models.Event, snapshots: list[models.TicketSalesSnapshot], today: date
) -> dict:
    ordered = sort_snapshots(snapshots)
    days_until_event = (event.event_date - today).days
    phase = event_phase(event.event_date, today)
    base = {
        "event_id": event.id,
        "capacity": event.capacity,
        "phase": phase,
        "days_until_event": days_until_event,
        "snapshot_count": len(ordered),
    }

    if not ordered:
        return {
            **base,
            "explanation": "No ticket sales snapshots have been recorded for this event yet.",
        }

    latest = ordered[-1]
    total = latest.tickets_sold_total
    velocity = sales_velocity(ordered)
    projected = projected_final_sales(total, velocity, days_until_event, event.capacity)
    sell_through = pct(total, event.capacity)
    gate_share = pct(latest.gate_tickets_sold, total)
    show_rate = pct(latest.attendance_checked_in, total)

    if phase == "pre-event":
        parts = [f"{days_until_event} day(s) until the event."]
    elif phase == "event-day":
        parts = ["It is event day; these are live numbers, not final actuals."]
    else:
        parts = [
            "The event has passed. These are the latest recorded numbers; they only "
            "become final actuals when the event is closed out."
        ]
    parts.append(
        f"{total:,} of {event.capacity:,} tickets sold ({sell_through}% sell-through)."
    )
    if velocity is None:
        parts.append("At least two snapshots are needed to measure sales velocity.")
    else:
        parts.append(
            f"Selling about {velocity:,.1f} tickets/day over the last "
            f"{VELOCITY_WINDOW_DAYS} days of snapshots."
        )
    if days_until_event > 0 and velocity is not None:
        parts.append(
            f"At that pace, sales are projected to reach {projected:,} by event day "
            "(capped at capacity)."
        )
    else:
        parts.append(f"Projected final sales: {projected:,} (no further days to project).")
    if latest.gate_tickets_sold:
        parts.append(f"{latest.gate_tickets_sold:,} sold at the gate ({gate_share}% of tickets).")
    if show_rate is not None:
        parts.append(
            f"{latest.attendance_checked_in:,} people checked in "
            f"({show_rate}% of tickets sold)."
        )

    return {
        **base,
        "latest_recorded_at": latest.recorded_at,
        "tickets_sold_total": total,
        "gate_tickets_sold": latest.gate_tickets_sold,
        "attendance_checked_in": latest.attendance_checked_in,
        "revenue_to_date": latest.revenue_to_date,
        "sell_through_pct": sell_through,
        "velocity_tickets_per_day": velocity,
        "gate_share_pct": gate_share,
        "show_rate_pct": show_rate,
        "projected_final_sales": projected,
        "finalize_preview": final_actuals_preview(event, latest),
        "explanation": " ".join(parts),
    }


def live_status(percent_of_prediction: float | None) -> str | None:
    if percent_of_prediction is None:
        return None
    if percent_of_prediction > 100 + LIVE_STATUS_TOLERANCE_PCT:
        return "ahead"
    if percent_of_prediction < 100 - LIVE_STATUS_TOLERANCE_PCT:
        return "behind"
    return "on track"


def compute_live_vs_predicted(
    event: models.Event,
    snapshots: list[models.TicketSalesSnapshot],
    latest_prediction: models.Prediction | None,
    today: date,
) -> dict:
    ordered = sort_snapshots(snapshots)
    latest = ordered[-1] if ordered else None
    predicted = latest_prediction.predicted_attendance if latest_prediction else None
    tickets = latest.tickets_sold_total if latest else None
    attendance = latest.attendance_checked_in if latest else None

    tickets_pct = pct(tickets, predicted)
    attendance_pct = pct(attendance, predicted)
    status = live_status(tickets_pct)

    if latest is None:
        explanation = "No snapshots recorded yet, so there is nothing live to compare."
    elif predicted is None:
        explanation = "No prediction exists for this event yet; run a forecast to compare."
    else:
        explanation = (
            f"{tickets:,} tickets sold so far is {tickets_pct}% of the predicted "
            f"attendance of {predicted:,}, so the event is {status} "
            f"(within +/-{LIVE_STATUS_TOLERANCE_PCT:.0f}% counts as on track). "
            "Status uses tickets sold because check-ins build up during the event."
        )
        if attendance is not None:
            explanation += f" {attendance:,} people checked in ({attendance_pct}% of prediction)."
        explanation += " These are live numbers, not final actuals."

    return {
        "event_id": event.id,
        "phase": event_phase(event.event_date, today),
        "recorded_at": latest.recorded_at if latest else None,
        "predicted_attendance": predicted,
        "tickets_sold_so_far": tickets,
        "attendance_so_far": attendance,
        "tickets_percent_of_prediction": tickets_pct,
        "attendance_percent_of_prediction": attendance_pct,
        "status": status,
        "status_basis": "tickets_sold_so_far",
        "tolerance_pct": LIVE_STATUS_TOLERANCE_PCT,
        "is_final": False,
        "explanation": explanation,
    }


def compute_event_day_patterns(
    events: list[models.Event], today: date, exclude_event_id: int | None = None
) -> dict:
    """Average gate share and show rate across completed events (date passed)
    whose latest snapshot has tickets sold and a check-in count."""
    gate_shares = []
    show_rates = []
    for event in events:
        if event.id == exclude_event_id or event.event_date >= today:
            continue
        ordered = sort_snapshots(event.sales_snapshots)
        if not ordered:
            continue
        latest = ordered[-1]
        if not latest.tickets_sold_total or latest.attendance_checked_in is None:
            continue
        gate_shares.append(latest.gate_tickets_sold / latest.tickets_sold_total)
        show_rates.append(latest.attendance_checked_in / latest.tickets_sold_total)

    events_used = len(gate_shares)
    sufficient = events_used >= MIN_EVENTS_FOR_PATTERNS
    avg_gate = round(sum(gate_shares) / events_used * 100, 1) if events_used else None
    avg_show = round(sum(show_rates) / events_used * 100, 1) if events_used else None

    if sufficient:
        explanation = (
            f"Learned from {events_used} completed events: on average {avg_gate}% of "
            f"tickets were sold at the gate and {avg_show}% of ticket holders attended."
        )
    else:
        explanation = (
            f"Not enough history yet: {events_used} completed event(s) with sales and "
            f"check-in snapshots; at least {MIN_EVENTS_FOR_PATTERNS} are needed before "
            "these patterns are used."
        )

    return {
        "avg_gate_share_pct": avg_gate,
        "avg_show_rate_pct": avg_show,
        "events_used": events_used,
        "min_events_required": MIN_EVENTS_FOR_PATTERNS,
        "sufficient_history": sufficient,
        "explanation": explanation,
    }


def apply_sales_signals(
    *,
    base_attendance: int,
    base_confidence: float,
    capacity: int,
    event: models.Event,
    snapshots: list[models.TicketSalesSnapshot],
    patterns: dict,
    today: date,
) -> dict | None:
    """Blend ticket sales evidence into a base prediction.

    Returns None with fewer than MIN_SNAPSHOTS_FOR_SALES_SIGNAL snapshots, so
    the prediction stays exactly as the base formula produced it.
    """
    ordered = sort_snapshots(snapshots)
    if len(ordered) < MIN_SNAPSHOTS_FOR_SALES_SIGNAL:
        return None

    latest = ordered[-1]
    velocity = sales_velocity(ordered)
    days_until_event = (event.event_date - today).days
    projected = projected_final_sales(
        latest.tickets_sold_total, velocity, days_until_event, capacity
    )

    if patterns["sufficient_history"]:
        gate_share = min(patterns["avg_gate_share_pct"] / 100, MAX_GATE_SHARE)
        show_rate = patterns["avg_show_rate_pct"] / 100
        # If a share g of all tickets is usually sold at the gate, A advance
        # tickets imply A * g / (1 - g) gate tickets in total.
        advance = projected - latest.gate_tickets_sold
        expected_gate = max(
            latest.gate_tickets_sold, advance * gate_share / (1 - gate_share)
        )
        expected_tickets = min(capacity, advance + expected_gate)
        sales_estimate = expected_tickets * show_rate
        learned_note = (
            f"Learned show rate ({patterns['avg_show_rate_pct']}%) and gate share "
            f"({patterns['avg_gate_share_pct']}%) from {patterns['events_used']} "
            f"completed events were applied: about {expected_gate:,.0f} gate tickets "
            f"expected, {expected_tickets:,.0f} tickets in total, of whom "
            f"{sales_estimate:,.0f} are expected to attend."
        )
    else:
        sales_estimate = projected
        learned_note = (
            "Learned show rate and gate share were not applied because there is not "
            f"enough history ({patterns['events_used']} of "
            f"{patterns['min_events_required']} completed events needed), so projected "
            "ticket sales are used as the attendance estimate."
        )

    blended = (
        SALES_PROJECTION_WEIGHT * sales_estimate + BASE_FORMULA_WEIGHT * base_attendance
    )
    attendance = int(max(0, min(capacity, round(blended))))

    boost = min(len(ordered) * SNAPSHOT_CONFIDENCE_STEP, MAX_SNAPSHOT_CONFIDENCE_BOOST)
    confidence = round(max(0.3, min(base_confidence + boost, 0.95)), 2)

    velocity_text = f"{velocity:,.1f} tickets/day" if velocity is not None else "no velocity"
    insight = (
        f"Ticket sales projection used: {len(ordered)} snapshots, latest "
        f"{latest.tickets_sold_total:,} sold at {velocity_text}, projecting "
        f"{projected:,} final ticket sales. {learned_note} The final estimate blends "
        f"{SALES_PROJECTION_WEIGHT:.0%} sales-based estimate ({sales_estimate:,.0f}) "
        f"with {BASE_FORMULA_WEIGHT:.0%} base formula ({base_attendance:,}). "
        f"Confidence includes +{boost:.2f} for {len(ordered)} sales snapshots."
    )

    return {
        "predicted_attendance": attendance,
        "confidence_score": confidence,
        "projected_final_sales": projected,
        "sales_estimate": sales_estimate,
        "learned_patterns_used": patterns["sufficient_history"],
        "insight": insight,
    }
