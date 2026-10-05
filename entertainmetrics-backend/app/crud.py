from collections.abc import Mapping

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models, schemas


def create_event(db: Session, event: schemas.EventCreate):
    db_event = models.Event(**event.model_dump())
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    return db_event


def get_events(db: Session):
    return (
        db.query(models.Event)
        .order_by(models.Event.event_date.desc(), models.Event.id.desc())
        .all()
    )


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


def get_predicted_vs_actual(db: Session):
    """Compare each event's latest prediction with its recorded actuals."""
    events = (
        db.query(models.Event)
        .filter(models.Event.actual_attendance.isnot(None))
        .order_by(models.Event.event_date.asc(), models.Event.id.asc())
        .all()
    )

    items = []
    for event in events:
        latest = (
            db.query(models.Prediction)
            .filter(models.Prediction.event_id == event.id)
            .order_by(models.Prediction.created_at.desc(), models.Prediction.id.desc())
            .first()
        )
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
    }
