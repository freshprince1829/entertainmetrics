"""Ticket tier pricing rules.

Plain arithmetic over an event's ticket tiers, kept separate so every number
can be explained: the price range, the base price used for the attendance
formula, and the average price used for revenue.
"""

from . import models

SALE_PHASES = ("early_bird", "advance", "standard", "last_minute", "gate")

# The base price is the cheapest regular (non-premium) tier sold in one of
# these phases, so VIP prices and early-bird discounts never distort the
# attendance formula.
BASE_PRICE_PHASES = ("standard", "advance")


def sorted_tiers(tiers: list[models.TicketTier]) -> list[models.TicketTier]:
    return sorted(tiers, key=lambda t: (t.sort_order or 0, t.price, t.id or 0))


def base_price(event: models.Event, tiers: list[models.TicketTier]) -> tuple[float, str]:
    """Return (price, source) where source explains where the price came from."""
    candidates = [
        t for t in tiers if t.sale_phase in BASE_PRICE_PHASES and not t.is_premium
    ]
    if candidates:
        tier = min(candidates, key=lambda t: t.price)
        return tier.price, f"lowest standard/advance tier ({tier.name})"
    return event.ticket_price, "event ticket price (no standard or advance tier)"


def price_range(tiers: list[models.TicketTier]) -> dict:
    if not tiers:
        return {
            "tier_count": 0,
            "price_low": None,
            "price_high": None,
            "average_price_by_quantity": None,
            "weighting": None,
        }

    prices = [t.price for t in tiers]
    quantities = [t.quantity_available for t in tiers]
    if all(q is not None for q in quantities) and sum(quantities) > 0:
        average = sum(t.price * t.quantity_available for t in tiers) / sum(quantities)
        weighting = "quantity_available"
    else:
        average = sum(prices) / len(prices)
        weighting = "simple_mean"

    return {
        "tier_count": len(tiers),
        "price_low": min(prices),
        "price_high": max(prices),
        "average_price_by_quantity": round(average, 2),
        "weighting": weighting,
    }
