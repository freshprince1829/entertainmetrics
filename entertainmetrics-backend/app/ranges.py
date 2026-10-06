"""Rule-based prediction ranges (LOW / EXPECTED / HIGH).

These are heuristic bands built from named constants, not statistical
confidence intervals: they show how much the estimate could plausibly move
given the confidence score and the ticket sales evidence available.
"""

import math
from datetime import date

from . import models
from .sales import SALES_PROJECTION_WEIGHT, range_position, sales_velocity, sort_snapshots

# Starting spread around the expected value (+/-25%).
BAND_BASE_SPREAD = 0.25
# Higher confidence narrows the band: spread -= this * confidence score.
BAND_CONFIDENCE_NARROWING = 0.10
# Each sales snapshot narrows the band a little, up to a maximum.
BAND_SNAPSHOT_NARROWING = 0.015
BAND_MAX_SNAPSHOT_NARROWING = 0.075
# The band is never narrower than +/-8%.
BAND_MIN_SPREAD = 0.08
# With sales velocity, the sales-based range runs from half to 1.5x the
# current pace over the remaining days.
SALES_LOW_PACE = 0.5
SALES_HIGH_PACE = 1.5
# Weight of the sales-based range when blended with the formula spread
# (same weighting as the sales signal in the expected value).
BAND_SALES_WEIGHT = SALES_PROJECTION_WEIGHT


def band_spread(confidence: float, snapshot_count: int) -> float:
    narrowing = min(snapshot_count * BAND_SNAPSHOT_NARROWING, BAND_MAX_SNAPSHOT_NARROWING)
    spread = BAND_BASE_SPREAD - BAND_CONFIDENCE_NARROWING * confidence - narrowing
    return max(BAND_MIN_SPREAD, spread)


def compute_band(
    *,
    expected_attendance: int,
    confidence: float,
    capacity: int,
    event: models.Event,
    snapshots: list[models.TicketSalesSnapshot],
    today: date,
    effective_price: float,
    attendance_price: float,
    price_high: float,
) -> dict:
    ordered = sort_snapshots(snapshots)
    spread = band_spread(confidence, len(ordered))
    formula_low = expected_attendance * (1 - spread)
    formula_high = expected_attendance * (1 + spread)

    notes = [
        "Heuristic range, not a statistical confidence interval.",
        f"Started from +/-{BAND_BASE_SPREAD:.0%} around the expected attendance of "
        f"{expected_attendance:,} and narrowed for confidence {confidence:.2f} and "
        f"{len(ordered)} sales snapshot(s) to +/-{spread:.1%} "
        f"(never narrower than +/-{BAND_MIN_SPREAD:.0%}).",
    ]

    velocity = sales_velocity(ordered)
    if velocity is not None:
        latest = ordered[-1].tickets_sold_total
        days = max((event.event_date - today).days, 0)
        sales_low = min(capacity, max(latest, latest + SALES_LOW_PACE * velocity * days))
        sales_high = min(capacity, max(latest, latest + SALES_HIGH_PACE * velocity * days))
        low = BAND_SALES_WEIGHT * sales_low + (1 - BAND_SALES_WEIGHT) * formula_low
        high = BAND_SALES_WEIGHT * sales_high + (1 - BAND_SALES_WEIGHT) * formula_high
        notes.append(
            f"Ticket sales of {latest:,} at {velocity:,.1f}/day over {days} remaining "
            f"day(s) could reach {sales_low:,.0f} (half pace) to {sales_high:,.0f} "
            f"(1.5x pace); this was blended {BAND_SALES_WEIGHT:.0%}/"
            f"{1 - BAND_SALES_WEIGHT:.0%} with the formula spread."
        )
    else:
        low, high = formula_low, formula_high

    # The band always contains the expected value and stays within capacity.
    attendance_low = max(0, min(math.floor(min(low, expected_attendance)), capacity))
    attendance_high = max(0, min(math.ceil(max(high, expected_attendance)), capacity))

    low_price = min(effective_price, attendance_price)
    high_price = max(effective_price, price_high)
    notes.append(
        f"Attendance is clamped to 0-{capacity:,}. Revenue range = low attendance x "
        f"KES {low_price:,.0f} to high attendance x KES {high_price:,.0f}."
    )

    return {
        "attendance_low": attendance_low,
        "attendance_high": attendance_high,
        "revenue_low": round(attendance_low * low_price, 2),
        "revenue_high": round(attendance_high * high_price, 2),
        "method_note": " ".join(notes),
    }


def in_range(value: float | None, low: float | None, high: float | None) -> bool | None:
    position = range_position(value, low, high)
    return None if position is None else position == "within predicted range"
