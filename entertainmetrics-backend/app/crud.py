from collections.abc import Mapping

from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from . import models, schemas
from .sales import as_utc


def create_event(db: Session, event: schemas.EventCreate):
    db_event = models.Event(**event.model_dump())
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    return db_event


def get_events(db: Session):
    return (
        db.query(models.Event)
        .options(selectinload(models.Event.tiers))
        .order_by(models.Event.event_date.desc(), models.Event.id.desc())
        .all()
    )


def update_event_actuals(
    db: Session, event: models.Event, actuals: schemas.EventActualsUpdate
):
    event.actual_attendance = actuals.actual_attendance
    event.revenue = actuals.revenue
    db.commit()
    db.refresh(event)
    return event


def get_sales_snapshots(db: Session, event_id: int):
    return (
        db.query(models.TicketSalesSnapshot)
        .options(
            selectinload(models.TicketSalesSnapshot.tier_sales_rows).selectinload(
                models.SnapshotTierSales.tier
            )
        )
        .filter(models.TicketSalesSnapshot.event_id == event_id)
        .order_by(
            models.TicketSalesSnapshot.recorded_at.asc(),
            models.TicketSalesSnapshot.id.asc(),
        )
        .all()
    )


def create_sales_snapshot(
    db: Session, event_id: int, snapshot: schemas.SalesSnapshotCreate
):
    data = snapshot.model_dump(exclude={"tier_sales"})
    # Store in UTC so ordering is correct whatever offset the client sent.
    data["recorded_at"] = as_utc(data["recorded_at"])
    db_snapshot = models.TicketSalesSnapshot(event_id=event_id, **data)
    for sale in snapshot.tier_sales or []:
        db_snapshot.tier_sales_rows.append(
            models.SnapshotTierSales(tier_id=sale.tier_id, tickets_sold=sale.tickets_sold)
        )
    db.add(db_snapshot)
    db.commit()
    db.refresh(db_snapshot)
    return db_snapshot


def delete_sales_snapshot(db: Session, snapshot: models.TicketSalesSnapshot):
    db.delete(snapshot)
    db.commit()


def get_event_tiers(db: Session, event_id: int):
    return (
        db.query(models.TicketTier)
        .filter(models.TicketTier.event_id == event_id)
        .order_by(
            models.TicketTier.sort_order.asc(),
            models.TicketTier.price.asc(),
            models.TicketTier.id.asc(),
        )
        .all()
    )


def create_tier(db: Session, event_id: int, tier: schemas.TicketTierCreate):
    db_tier = models.TicketTier(event_id=event_id, **tier.model_dump())
    db.add(db_tier)
    db.commit()
    db.refresh(db_tier)
    return db_tier


def update_tier(db: Session, tier: models.TicketTier, changes: dict):
    for field, value in changes.items():
        setattr(tier, field, value)
    db.commit()
    db.refresh(tier)
    return tier


def delete_tier(db: Session, tier: models.TicketTier):
    db.delete(tier)
    db.commit()


def tier_sales_summary(db: Session, tier_id: int) -> tuple[int, int]:
    """(number of snapshots recording this tier, highest tickets_sold recorded)."""
    row = (
        db.query(
            func.count(models.SnapshotTierSales.id),
            func.coalesce(func.max(models.SnapshotTierSales.tickets_sold), 0),
        )
        .filter(models.SnapshotTierSales.tier_id == tier_id)
        .one()
    )
    return row[0], row[1]


def get_events_with_snapshots(db: Session):
    return (
        db.query(models.Event)
        .join(models.TicketSalesSnapshot)
        .options(
            selectinload(models.Event.sales_snapshots)
            .selectinload(models.TicketSalesSnapshot.tier_sales_rows)
            .selectinload(models.SnapshotTierSales.tier)
        )
        .distinct()
        .all()
    )


def get_latest_prediction(db: Session, event_id: int):
    return _latest_prediction(db, event_id)


def finalize_event_actuals(
    db: Session, event: models.Event, actual_attendance: int, revenue: float | None
):
    event.actual_attendance = actual_attendance
    event.revenue = revenue
    db.commit()
    db.refresh(event)
    return event


def create_artist(db: Session, artist: schemas.ArtistCreate):
    db_artist = models.Artist(**artist.model_dump())
    db.add(db_artist)
    db.commit()
    db.refresh(db_artist)
    return db_artist


def get_artists(db: Session):
    return db.query(models.Artist).order_by(models.Artist.artist_name.asc()).all()


def create_event_artist(db: Session, event_artist: schemas.EventArtistCreate):
    db_event_artist = models.EventArtist(**event_artist.model_dump())
    db.add(db_event_artist)
    db.commit()
    db.refresh(db_event_artist)
    return db_event_artist


def delete_event_artist(db: Session, event_artist: models.EventArtist):
    db.delete(event_artist)
    db.commit()


def delete_artist(db: Session, artist: models.Artist) -> int:
    """Delete an artist and (via the relationship cascade) every lineup slot
    they hold. Returns the number of lineup slots removed."""
    lineup_entries_removed = len(artist.event_links)
    db.delete(artist)
    db.commit()
    return lineup_entries_removed


def get_event_lineup(db: Session, event_id: int):
    return (
        db.query(models.EventArtist)
        .filter(models.EventArtist.event_id == event_id)
        .order_by(models.EventArtist.performance_order.asc(), models.EventArtist.id.asc())
        .all()
    )


def create_prediction(
    db: Session,
    prediction_data: Mapping[str, object] | None = None,
    **kwargs,
):
    payload = dict(prediction_data or {})
    payload.update(kwargs)

    db_prediction = models.Prediction(**payload)
    db.add(db_prediction)
    db.commit()
    db.refresh(db_prediction)
    return db_prediction


def get_predictions(db: Session):
    return db.query(models.Prediction).order_by(models.Prediction.id.desc()).all()


def get_dashboard_summary(db: Session):
    summary = (
        db.query(
            db.query(func.count(models.Event.id)).scalar_subquery().label("total_events"),
            db.query(func.count(models.Artist.id))
            .scalar_subquery()
            .label("total_artists"),
            db.query(func.count(models.Prediction.id))
            .scalar_subquery()
            .label("total_predictions"),
            db.query(func.coalesce(func.avg(models.Prediction.predicted_attendance), 0.0))
            .scalar_subquery()
            .label("average_predicted_attendance"),
            db.query(func.coalesce(func.avg(models.Prediction.predicted_revenue), 0.0))
            .scalar_subquery()
            .label("average_predicted_revenue"),
        )
        .one()
    )

    return {
        "total_events": summary.total_events,
        "total_artists": summary.total_artists,
        "total_predictions": summary.total_predictions,
        "average_predicted_attendance": float(summary.average_predicted_attendance),
        "average_predicted_revenue": float(summary.average_predicted_revenue),
    }


def get_recent_events(db: Session, limit: int = 5):
    return (
        db.query(models.Event)
        .options(selectinload(models.Event.tiers))
        .order_by(models.Event.created_at.desc(), models.Event.id.desc())
        .limit(limit)
        .all()
    )


def get_recent_predictions(db: Session, limit: int = 5):
    return (
        db.query(models.Prediction)
        .order_by(models.Prediction.created_at.desc(), models.Prediction.id.desc())
        .limit(limit)
        .all()
    )


def _percent_error(predicted: float, actual: float | None) -> float | None:
    """Signed % error of the prediction relative to the actual value."""
    if actual is None or actual == 0:
        return None
    return round((predicted - actual) / actual * 100, 1)


def _latest_prediction(db: Session, event_id: int):
    return (
        db.query(models.Prediction)
        .filter(models.Prediction.event_id == event_id)
        .order_by(models.Prediction.created_at.desc(), models.Prediction.id.desc())
        .first()
    )


def get_predicted_vs_actual(db: Session):
    """Compare each event's latest prediction with its recorded actuals, and
    list events that are still waiting for actual results."""
    events = (
        db.query(models.Event)
        .order_by(models.Event.event_date.asc(), models.Event.id.asc())
        .all()
    )

    items = []
    awaiting_results = []
    for event in events:
        latest = _latest_prediction(db, event.id)
        if event.actual_attendance is None:
            awaiting_results.append(
                {
                    "event_id": event.id,
                    "event_name": event.event_name,
                    "event_date": event.event_date,
                    "predicted_attendance": latest.predicted_attendance if latest else None,
                    "predicted_revenue": latest.predicted_revenue if latest else None,
                }
            )
            continue
        if latest is None:
            continue
        items.append(
            {
                "event_id": event.id,
                "event_name": event.event_name,
                "event_date": event.event_date,
                "predicted_attendance": latest.predicted_attendance,
                "actual_attendance": event.actual_attendance,
                "attendance_error_pct": _percent_error(
                    latest.predicted_attendance, event.actual_attendance
                ),
                "predicted_revenue": latest.predicted_revenue,
                "actual_revenue": event.revenue,
                "revenue_error_pct": _percent_error(
                    latest.predicted_revenue, event.revenue
                ),
            }
        )

    def mean_abs(key: str) -> float | None:
        values = [abs(i[key]) for i in items if i[key] is not None]
        return round(sum(values) / len(values), 1) if values else None

    return {
        "events_compared": len(items),
        "mean_attendance_error_pct": mean_abs("attendance_error_pct"),
        "mean_revenue_error_pct": mean_abs("revenue_error_pct"),
        "items": items,
        "awaiting_results": awaiting_results,
    }
