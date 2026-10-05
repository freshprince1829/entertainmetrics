"""Rule-based ticket sales and attendance tracking.

Snapshots are cumulative readings (tickets sold, gate sales, people checked in,
revenue) recorded before and during an event. Everything here is plain
arithmetic so each number can be explained; there is no machine learning.
"""

from datetime import datetime, timedelta, timezone

from . import models, schemas

# Snapshots may be logged up to this many days after the event date, so late
# gate / door counts can still be entered.
LATE_ENTRY_GRACE_DAYS = 1

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
