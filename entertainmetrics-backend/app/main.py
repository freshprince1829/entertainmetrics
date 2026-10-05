from datetime import date

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from .database import Base, engine, get_db
from . import crud, models, schemas

Base.metadata.create_all(bind=engine)

app = FastAPI(title="EntertainMetrics API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _get_linked_artists(event: models.Event) -> list[models.Artist]:
    return [
        lineup_entry.artist
        for lineup_entry in event.lineup
        if lineup_entry.artist is not None
    ]


def _calculate_artist_metric_completeness(artists: list[models.Artist]) -> float:
    if not artists:
        return 0.0

    total_possible_fields = len(artists) * 3
    total_filled_fields = 0

    for artist in artists:
        for metric in (
            artist.engagement_score,
            artist.headline_score,
            artist.market_strength_score,
        ):
            if metric is not None:
                total_filled_fields += 1

    return total_filled_fields / total_possible_fields


def _calculate_confidence_score(
    ticket_price: float,
    marketing_spend: float,
    capacity: int,
    linked_artist_count: int,
    completeness_ratio: float,
) -> float:

    score = 0.5  # base confidence

    # Artist presence boost
    if linked_artist_count > 0:
        score += min(linked_artist_count * 0.05, 0.2)

    # Data completeness boost
    score += completeness_ratio * 0.2

    # Marketing signal
    if marketing_spend > 0:
        score += 0.05

    # Ticket price sanity
    if 500 <= ticket_price <= 10000:
        score += 0.05

    # Capacity sanity
    if capacity > 0:
        score += 0.05

    # Clamp between 0.3 and 0.95
    return max(0.3, min(score, 0.95))


def _run_prediction_math(
    ticket_price: float,
    marketing_spend: float,
    capacity: int,
    linked_artists: list["models.Artist"],
) -> dict:
    """Shared rule-based prediction math used by /predict and the
    recommendation endpoints, so all three stay numerically consistent."""

    linked_artist_count = len(linked_artists)

    artist_strength_total = 0.0
    for artist in linked_artists:
        artist_strength_total += (
            float(artist.engagement_score or 0)
            + float(artist.headline_score or 0)
            + float(artist.market_strength_score or 0)
        )

    completeness_ratio = _calculate_artist_metric_completeness(linked_artists)
    confidence_score = _calculate_confidence_score(
        ticket_price=ticket_price,
        marketing_spend=marketing_spend,
        capacity=capacity,
        linked_artist_count=linked_artist_count,
        completeness_ratio=completeness_ratio,
    )

    attendance_estimate = (
        (capacity * 0.4)
        + (marketing_spend / 50)
        - (ticket_price / 20)
    )
    if linked_artist_count > 0:
        attendance_estimate += artist_strength_total * 10

    predicted_attendance = int(min(capacity, attendance_estimate))
    predicted_attendance = max(predicted_attendance, 0)
    predicted_revenue = round(predicted_attendance * ticket_price, 2)

    return {
        "predicted_attendance": predicted_attendance,
        "predicted_revenue": predicted_revenue,
        "confidence_score": confidence_score,
        "artist_strength_total": artist_strength_total,
        "completeness_ratio": completeness_ratio,
        "linked_artist_count": linked_artist_count,
    }


def _load_event_with_lineup(db: Session, event_id: int):
    return (
        db.query(models.Event)
        .options(
            selectinload(models.Event.lineup).selectinload(models.EventArtist.artist)
        )
        .filter(models.Event.id == event_id)
        .first()
    )


def _constraint_name(error: IntegrityError) -> str | None:
    diag = getattr(getattr(error, "orig", None), "diag", None)
    return getattr(diag, "constraint_name", None)


def _rollback_and_raise(
    db: Session,
    status_code: int,
    detail: str,
    error: Exception,
) -> None:
    db.rollback()
    raise HTTPException(status_code=status_code, detail=detail) from error


def _handle_artist_creation_error(db: Session, error: IntegrityError) -> None:
    constraint_name = _constraint_name(error)
    error_message = str(getattr(error, "orig", error)).lower()

    if constraint_name == "artists_artist_name_key" or (
        "artist_name" in error_message and "unique" in error_message
    ):
        _rollback_and_raise(db, 400, "Artist already exists", error)

    _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


def _handle_event_artist_creation_error(db: Session, error: IntegrityError) -> None:
    constraint_name = _constraint_name(error)
    error_message = str(getattr(error, "orig", error)).lower()

    if constraint_name == "uq_event_artist_performance_order":
        _rollback_and_raise(
            db,
            400,
            "This artist is already assigned to this event slot",
            error,
        )

    if "foreign key" in error_message:
        _rollback_and_raise(db, 404, "Referenced event or artist does not exist", error)

    _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.get("/")
def root():
    return {"message": "EntertainMetrics backend is running"}


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "EntertainMetrics API"}


@app.post("/events", response_model=schemas.EventResponse)
def create_event(event: schemas.EventCreate, db: Session = Depends(get_db)):
    if event.event_date > date.today() and (
        event.actual_attendance is not None or event.revenue is not None
    ):
        raise HTTPException(
            status_code=400,
            detail="Actual results can only be recorded once the event date has passed",
        )
    try:
        return crud.create_event(db, event)
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.get("/events", response_model=list[schemas.EventResponse])
def list_events(db: Session = Depends(get_db)):
    try:
        return crud.get_events(db)
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.patch("/events/{event_id}/actuals", response_model=schemas.EventResponse)
def update_event_actuals(
    event_id: int, actuals: schemas.EventActualsUpdate, db: Session = Depends(get_db)
):
    try:
        event = db.get(models.Event, event_id)
        if event is None:
            raise HTTPException(status_code=404, detail="Event not found")
        if event.event_date > date.today():
            raise HTTPException(
                status_code=400,
                detail="Actual results can only be recorded once the event date has passed",
            )
        if actuals.actual_attendance > event.capacity:
            raise HTTPException(
                status_code=400,
                detail=f"Actual attendance cannot exceed event capacity ({event.capacity})",
            )
        return crud.update_event_actuals(db, event, actuals)
    except HTTPException:
        raise
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.post("/artists", response_model=schemas.ArtistResponse)
def create_artist(artist: schemas.ArtistCreate, db: Session = Depends(get_db)):
    try:
        return crud.create_artist(db, artist)
    except IntegrityError as error:
        _handle_artist_creation_error(db, error)
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.get("/artists", response_model=list[schemas.ArtistResponse])
def list_artists(db: Session = Depends(get_db)):
    try:
        return crud.get_artists(db)
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.post("/event-artists", response_model=schemas.EventArtistResponse)
def create_event_artist(
    event_artist: schemas.EventArtistCreate,
    db: Session = Depends(get_db),
):
    try:
        return crud.create_event_artist(db, event_artist)
    except IntegrityError as error:
        _handle_event_artist_creation_error(db, error)
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.get("/events/{event_id}/lineup", response_model=list[schemas.EventArtistResponse])
def get_event_lineup(event_id: int, db: Session = Depends(get_db)):
    try:
        return crud.get_event_lineup(db, event_id)
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.post("/predict", response_model=schemas.PredictionResponse)
def predict_event(data: schemas.PredictionRequest, db: Session = Depends(get_db)):
    try:
        event = _load_event_with_lineup(db, data.event_id)
        if event is None:
            raise HTTPException(status_code=404, detail="Event not found")

        linked_artists = _get_linked_artists(event)
        result = _run_prediction_math(
            ticket_price=data.ticket_price,
            marketing_spend=data.marketing_spend,
            capacity=data.capacity,
            linked_artists=linked_artists,
        )

        model_version = "v1-rule-based"
        if result["linked_artist_count"] > 0:
            insight_summary = (
                f"Rule-based estimate using {result['linked_artist_count']} linked artists "
                f"with an artist strength total of {result['artist_strength_total']:.2f}. "
                f"Dynamic confidence score is {result['confidence_score']:.2f}."
            )
        else:
            insight_summary = (
                "Lineup data was not linked, so artist influence was excluded from the "
                f"prediction. Dynamic confidence score is {result['confidence_score']:.2f}, "
                "and confidence is lower because lineup data is missing."
            )

        prediction_record = {
            "event_id": data.event_id,
            "predicted_attendance": result["predicted_attendance"],
            "predicted_revenue": result["predicted_revenue"],
            "confidence_score": result["confidence_score"],
            "model_version": model_version,
            "insight_summary": insight_summary,
        }

        return crud.create_prediction(db, prediction_record)
    except HTTPException:
        raise
    except IntegrityError as error:
        error_message = str(getattr(error, "orig", error)).lower()
        if "foreign key" in error_message:
            _rollback_and_raise(db, 404, "Referenced event or artist does not exist", error)
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.get("/predictions", response_model=list[schemas.PredictionResponse])
def list_predictions(db: Session = Depends(get_db)):
    try:
        return crud.get_predictions(db)
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.get("/dashboard/summary", response_model=schemas.DashboardSummaryResponse)
def get_dashboard_summary(db: Session = Depends(get_db)):
    try:
        return crud.get_dashboard_summary(db)
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.get("/dashboard/recent-events", response_model=list[schemas.RecentEventResponse])
def get_recent_events(limit: int = 5, db: Session = Depends(get_db)):
    try:
        return crud.get_recent_events(db, limit=limit)
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.get(
    "/dashboard/recent-predictions",
    response_model=list[schemas.RecentPredictionResponse],
)
def get_recent_predictions(limit: int = 5, db: Session = Depends(get_db)):
    try:
        return crud.get_recent_predictions(db, limit=limit)
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)



@app.get(
    "/dashboard/predicted-vs-actual",
    response_model=schemas.PredictedVsActualResponse,
)
def get_predicted_vs_actual(db: Session = Depends(get_db)):
    try:
        return crud.get_predicted_vs_actual(db)
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.get(
    "/events/{event_id}/recommend/artists",
    response_model=list[schemas.ArtistRecommendationResponse],
)
def recommend_artists(event_id: int, limit: int = 5, db: Session = Depends(get_db)):
    try:
        event = _load_event_with_lineup(db, event_id)
        if event is None:
            raise HTTPException(status_code=404, detail="Event not found")

        linked_artists = _get_linked_artists(event)
        linked_artist_ids = {artist.id for artist in linked_artists}

        candidate_artists = [
            artist for artist in crud.get_artists(db) if artist.id not in linked_artist_ids
        ]

        baseline = _run_prediction_math(
            ticket_price=event.ticket_price,
            marketing_spend=event.marketing_spend,
            capacity=event.capacity,
            linked_artists=linked_artists,
        )

        recommendations = []
        for artist in candidate_artists:
            projected = _run_prediction_math(
                ticket_price=event.ticket_price,
                marketing_spend=event.marketing_spend,
                capacity=event.capacity,
                linked_artists=linked_artists + [artist],
            )

            attendance_uplift = (
                projected["predicted_attendance"] - baseline["predicted_attendance"]
            )
            revenue_uplift = round(
                projected["predicted_revenue"] - baseline["predicted_revenue"], 2
            )
            recommendation_score = round(
                float(artist.engagement_score or 0)
                + float(artist.headline_score or 0)
                + float(artist.market_strength_score or 0),
                2,
            )

            if attendance_uplift > 0:
                reason = (
                    f"Adding {artist.artist_name} is projected to raise attendance by "
                    f"{attendance_uplift} and revenue by KES {revenue_uplift:,.2f}, driven "
                    f"by a combined engagement/headline/market-strength score of "
                    f"{recommendation_score:.2f}."
                )
            else:
                reason = (
                    f"{artist.artist_name} has a combined engagement/headline/market-strength "
                    f"score of {recommendation_score:.2f}, but the event is already near "
                    "capacity, so the projected attendance uplift is limited."
                )

            recommendations.append(
                schemas.ArtistRecommendationResponse(
                    artist_id=artist.id,
                    artist_name=artist.artist_name,
                    genre=artist.genre,
                    recommendation_score=recommendation_score,
                    projected_attendance_uplift=attendance_uplift,
                    projected_revenue_uplift=revenue_uplift,
                    reason=reason,
                )
            )

        recommendations.sort(key=lambda item: item.projected_revenue_uplift, reverse=True)

        return recommendations[:limit]
    except HTTPException:
        raise
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.get(
    "/events/{event_id}/recommend/pricing",
    response_model=schemas.PricingRecommendationResponse,
)
def recommend_pricing(
    event_id: int,
    price_min: float | None = None,
    price_max: float | None = None,
    steps: int = 15,
    db: Session = Depends(get_db),
):
    try:
        event = _load_event_with_lineup(db, event_id)
        if event is None:
            raise HTTPException(status_code=404, detail="Event not found")

        if steps < 2 or steps > 100:
            raise HTTPException(status_code=400, detail="steps must be between 2 and 100")
        if (price_min is not None and price_min <= 0) or (
            price_max is not None and price_max <= 0
        ):
            raise HTTPException(
                status_code=400, detail="price_min and price_max must be greater than 0"
            )

        linked_artists = _get_linked_artists(event)

        base_price = event.ticket_price
        low = price_min if price_min is not None else max(base_price * 0.5, 50)
        high = price_max if price_max is not None else base_price * 1.5
        if high <= low:
            high = low + 100

        step_size = (high - low) / (steps - 1)
        candidates = []
        best = None

        for i in range(steps):
            candidate_price = round(low + step_size * i, 2)
            result = _run_prediction_math(
                ticket_price=candidate_price,
                marketing_spend=event.marketing_spend,
                capacity=event.capacity,
                linked_artists=linked_artists,
            )
            candidate = schemas.PricingCandidate(
                ticket_price=candidate_price,
                predicted_attendance=result["predicted_attendance"],
                predicted_revenue=result["predicted_revenue"],
            )
            candidates.append(candidate)

            if best is None or candidate.predicted_revenue > best["candidate"].predicted_revenue:
                best = {"candidate": candidate, "result": result}

        insight_summary = (
            f"Swept {steps} candidate ticket prices between KES {low:,.2f} and "
            f"KES {high:,.2f}, holding marketing spend (KES {event.marketing_spend:,.2f}) "
            f"and capacity ({event.capacity}) fixed. KES {best['candidate'].ticket_price:,.2f} "
            "maximized projected revenue among the candidates tested. This is a rule-based "
            "estimate, not a guaranteed outcome, and assumes demand responds to price the "
            "same way the core prediction model does within the tested range."
        )
        if best["candidate"].predicted_attendance >= event.capacity:
            insight_summary += (
                " Note: projected attendance reaches capacity at this price, so the "
                "model cannot capture further demand loss from higher prices; the "
                "recommendation is effectively the highest price tested."
            )

        return schemas.PricingRecommendationResponse(
            event_id=event_id,
            recommended_ticket_price=best["candidate"].ticket_price,
            predicted_attendance=best["candidate"].predicted_attendance,
            predicted_revenue=best["candidate"].predicted_revenue,
            confidence_score=best["result"]["confidence_score"],
            candidates=candidates,
            insight_summary=insight_summary,
        )
    except HTTPException:
        raise
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)
