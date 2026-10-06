"""Ticket tier pricing rules.

Plain arithmetic over an event's ticket tiers, kept separate so every number
can be explained: the price range, the base price used for the attendance
formula, and the average price used for revenue.
"""

from . import models
from .sales import as_utc, pct, sort_snapshots

SALE_PHASES = ("early_bird", "advance", "standard", "last_minute", "gate", "premium")

# The base price is the cheapest regular (non-premium) tier sold in one of
# these phases, so VIP prices and early-bird discounts never distort the
# attendance formula.
BASE_PRICE_PHASES = ("standard", "advance")

# Confidence is raised slightly when the event has tier data: defined tiers,
# and again when tier-level sales have actually been recorded.
TIER_DEFINED_CONFIDENCE_BOOST = 0.02
TIER_SALES_CONFIDENCE_BOOST = 0.01

# Tier patterns (premium revenue share, early-bird ticket share) need at least
# this many completed events, matching the other learned patterns.
MIN_EVENTS_FOR_TIER_PATTERNS = 2


def sorted_tiers(tiers: list[models.TicketTier]) -> list[models.TicketTier]:
    return sorted(tiers, key=lambda t: (t.sort_order or 0, t.price, t.id or 0))


def base_price(event: models.Event, tiers: list[models.TicketTier]) -> tuple[float, str]:
    """Return (price, source) where source explains where the price came from."""
    candidates = [
        t for t in tiers if t.sale_phase in BASE_PRICE_PHASES and not t.is_premium
    ]
    if candidates:
        tier = min(candidates, key=lambda t: t.price)
        return tier.price, f"lowest standard/advance tier: {tier.name}"
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


def latest_tier_snapshot(snapshots: list[models.TicketSalesSnapshot]):
    """The most recent snapshot that recorded per-tier sales, or None."""
    with_tiers = [s for s in sort_snapshots(snapshots) if s.tier_sales_rows]
    return with_tiers[-1] if with_tiers else None


def compute_revenue_breakdown(
    event: models.Event,
    tiers: list[models.TicketTier],
    snapshots: list[models.TicketSalesSnapshot],
) -> dict:
    base, _ = base_price(event, tiers)
    latest = latest_tier_snapshot(snapshots)
    if latest is None:
        return {
            "event_id": event.id,
            "has_tier_data": False,
            "base_price": base,
            "tiers": [],
            "explanation": "No tier-level sales have been recorded for this event yet.",
        }

    sold_by_tier = {row.tier_id: row.tickets_sold for row in latest.tier_sales_rows}
    ordered_tiers = sorted_tiers(tiers)
    total_tickets = sum(sold_by_tier.get(t.id, 0) for t in ordered_tiers)
    total_revenue = round(sum(sold_by_tier.get(t.id, 0) * t.price for t in ordered_tiers), 2)

    items = []
    for tier in ordered_tiers:
        sold = sold_by_tier.get(tier.id, 0)
        tier_revenue = round(sold * tier.price, 2)
        sold_out = tier.quantity_available is not None and sold >= tier.quantity_available > 0
        items.append(
            {
                "tier_id": tier.id,
                "name": tier.name,
                "price": tier.price,
                "sale_phase": tier.sale_phase,
                "is_premium": tier.is_premium,
                "quantity_available": tier.quantity_available,
                "tickets_sold": sold,
                "revenue": tier_revenue,
                "share_of_tickets_pct": pct(sold, total_tickets),
                "share_of_revenue_pct": pct(tier_revenue, total_revenue),
                "sell_through_pct": pct(sold, tier.quantity_available),
                "sold_out": sold_out,
            }
        )

    realized = round(total_revenue / total_tickets, 2) if total_tickets else None

    def joiner(item):
        tickets, revenue = item["share_of_tickets_pct"] or 0, item["share_of_revenue_pct"] or 0
        return "but" if revenue < tickets else "and"

    sentences = []
    for item in items:
        if item["sold_out"]:
            sentences.append(
                f"{item['name']} sold out: {item['share_of_tickets_pct']}% of tickets "
                f"{joiner(item)} {item['share_of_revenue_pct']}% of revenue."
            )
    for item in items:
        if item["is_premium"] and item["tickets_sold"] and not item["sold_out"]:
            sentences.append(
                f"{item['name']} is {item['share_of_tickets_pct']}% of tickets "
                f"{joiner(item)} {item['share_of_revenue_pct']}% of revenue."
            )
    if not sentences and total_tickets:
        top = max(items, key=lambda i: i["revenue"])
        sentences.append(
            f"{top['name']} brings the most revenue: {top['share_of_revenue_pct']}% "
            f"from {top['share_of_tickets_pct']}% of tickets."
        )
    if realized is not None:
        sentences.append(
            f"Realized average price is KES {realized:,.0f} per ticket versus a base "
            f"price of KES {base:,.0f}."
        )
    else:
        sentences.append("No tickets have been sold in any tier yet.")

    return {
        "event_id": event.id,
        "has_tier_data": True,
        "snapshot_id": latest.id,
        "recorded_at": as_utc(latest.recorded_at),
        "tickets_sold_total": total_tickets,
        "revenue_total": total_revenue,
        "realized_average_price": realized,
        "base_price": base,
        "tiers": items,
        "explanation": " ".join(sentences),
    }


def prediction_prices(
    event: models.Event,
    tiers: list[models.TicketTier],
    snapshots: list[models.TicketSalesSnapshot],
    requested_price: float,
) -> dict:
    """Decide which prices a prediction uses.

    - No tiers: the requested ticket price for both steps (unchanged behaviour).
    - Tiers and the event's stored price requested: attendance uses the base
      price; revenue uses the realized average price from tier sales, else the
      average tier price, else the event ticket price.
    - Tiers but a different price requested: a what-if run, so the requested
      price is used for both steps, as before.
    """
    if not tiers:
        return {
            "uses_tiers": False,
            "attendance_price": requested_price,
            "effective_price": requested_price,
            "price_low": requested_price,
            "price_high": requested_price,
            "confidence_boost": 0.0,
            "note": None,
        }

    tier_range = price_range(tiers)
    if requested_price != event.ticket_price:
        return {
            "uses_tiers": False,
            "attendance_price": requested_price,
            "effective_price": requested_price,
            "price_low": requested_price,
            "price_high": requested_price,
            "confidence_boost": 0.0,
            "note": (
                f"What-if ticket price KES {requested_price:,.0f} was used for both "
                "attendance and revenue instead of the event's ticket tiers."
            ),
        }

    base, base_source = base_price(event, tiers)
    breakdown = compute_revenue_breakdown(event, tiers, snapshots)
    boost = TIER_DEFINED_CONFIDENCE_BOOST
    if breakdown["has_tier_data"] and breakdown["realized_average_price"] is not None:
        effective = breakdown["realized_average_price"]
        effective_source = (
            f"realized average price from {breakdown['tickets_sold_total']:,} tickets "
            "sold across tiers"
        )
        boost += TIER_SALES_CONFIDENCE_BOOST
    elif tier_range["average_price_by_quantity"] is not None:
        effective = tier_range["average_price_by_quantity"]
        effective_source = (
            "average tier price weighted by quantity available"
            if tier_range["weighting"] == "quantity_available"
            else "simple average of tier prices (quantities not all known)"
        )
    else:
        effective, effective_source = event.ticket_price, "event ticket price"

    return {
        "uses_tiers": True,
        "attendance_price": base,
        "effective_price": effective,
        "price_low": tier_range["price_low"],
        "price_high": tier_range["price_high"],
        "confidence_boost": boost,
        "note": (
            f"Pricing: the attendance formula used the base price KES {base:,.0f} "
            f"({base_source}), so premium and early-bird prices do not distort demand; "
            f"revenue used an effective price of KES {effective:,.2f} ({effective_source}). "
            f"Confidence includes +{boost:.2f} for ticket tier data."
        ),
    }


def compute_tier_patterns(
    events: list[models.Event], today, exclude_event_id: int | None = None
) -> dict:
    """Average premium share of revenue and early-bird share of tickets across
    completed events (date passed) whose latest tier snapshot sold tickets."""
    premium_shares = []
    early_bird_shares = []
    for event in events:
        if event.id == exclude_event_id or event.event_date >= today:
            continue
        latest = latest_tier_snapshot(event.sales_snapshots)
        if latest is None:
            continue
        rows = latest.tier_sales_rows
        tickets = sum(row.tickets_sold for row in rows)
        revenue = sum(row.tickets_sold * row.tier.price for row in rows)
        if not tickets or not revenue:
            continue
        premium_shares.append(
            sum(r.tickets_sold * r.tier.price for r in rows if r.tier.is_premium) / revenue
        )
        early_bird_shares.append(
            sum(r.tickets_sold for r in rows if r.tier.sale_phase == "early_bird") / tickets
        )

    used = len(premium_shares)
    return {
        "avg_premium_revenue_share_pct": (
            round(sum(premium_shares) / used * 100, 1) if used else None
        ),
        "avg_early_bird_ticket_share_pct": (
            round(sum(early_bird_shares) / used * 100, 1) if used else None
        ),
        "tier_events_used": used,
        "tier_sufficient_history": used >= MIN_EVENTS_FOR_TIER_PATTERNS,
    }
