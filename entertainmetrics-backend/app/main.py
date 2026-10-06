from datetime import date

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from .database import Base, engine, get_db
from . import crud, models, pricing, ranges, sales, schemas

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


def _get_event_or_404(db: Session, event_id: int) -> models.Event:
    event = db.get(models.Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@app.post(
    "/events/{event_id}/sales-snapshots",
    response_model=schemas.SalesSnapshotResponse,
    status_code=201,
)
def create_sales_snapshot(
    event_id: int,
    snapshot: schemas.SalesSnapshotCreate,
    db: Session = Depends(get_db),
):
    try:
        event = _get_event_or_404(db, event_id)
        existing = crud.get_sales_snapshots(db, event_id)
        if snapshot.tier_sales is not None:
            tiers_by_id = {t.id: t for t in crud.get_event_tiers(db, event_id)}
            try:
                snapshot = sales.resolve_tier_sales(snapshot, tiers_by_id, existing)
            except sales.SnapshotRejected as rejection:
                raise HTTPException(
                    status_code=rejection.status_code, detail=rejection.message
                ) from rejection
        error_message = sales.validate_new_snapshot(event, existing, snapshot)
        if error_message:
            raise HTTPException(status_code=400, detail=error_message)
        return crud.create_sales_snapshot(db, event_id, snapshot)
    except HTTPException:
        raise
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.get(
    "/events/{event_id}/sales-snapshots",
    response_model=list[schemas.SalesSnapshotResponse],
)
def list_sales_snapshots(event_id: int, db: Session = Depends(get_db)):
    try:
        _get_event_or_404(db, event_id)
        return crud.get_sales_snapshots(db, event_id)
    except HTTPException:
        raise
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.delete("/events/{event_id}/sales-snapshots/{snapshot_id}", status_code=204)
def delete_sales_snapshot(event_id: int, snapshot_id: int, db: Session = Depends(get_db)):
    try:
        _get_event_or_404(db, event_id)
        snapshot = db.get(models.TicketSalesSnapshot, snapshot_id)
        if snapshot is None or snapshot.event_id != event_id:
            raise HTTPException(status_code=404, detail="Snapshot not found")
        crud.delete_sales_snapshot(db, snapshot)
        return Response(status_code=204)
    except HTTPException:
        raise
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.get(
    "/events/{event_id}/sales-progress",
    response_model=schemas.SalesProgressResponse,
)
def get_sales_progress(event_id: int, db: Session = Depends(get_db)):
    try:
        event = _get_event_or_404(db, event_id)
        snapshots = crud.get_sales_snapshots(db, event_id)
        return sales.compute_progress(event, snapshots, date.today())
    except HTTPException:
        raise
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.get(
    "/events/{event_id}/revenue-breakdown",
    response_model=schemas.RevenueBreakdownResponse,
)
def get_revenue_breakdown(event_id: int, db: Session = Depends(get_db)):
    try:
        event = _get_event_or_404(db, event_id)
        tiers = crud.get_event_tiers(db, event_id)
        snapshots = crud.get_sales_snapshots(db, event_id)
        return pricing.compute_revenue_breakdown(event, tiers, snapshots)
    except HTTPException:
        raise
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.get(
    "/events/{event_id}/live-vs-predicted",
    response_model=schemas.LiveVsPredictedResponse,
)
def get_live_vs_predicted(event_id: int, db: Session = Depends(get_db)):
    try:
        event = _get_event_or_404(db, event_id)
        snapshots = crud.get_sales_snapshots(db, event_id)
        latest_prediction = crud.get_latest_prediction(db, event_id)
        return sales.compute_live_vs_predicted(
            event, snapshots, latest_prediction, date.today()
        )
    except HTTPException:
        raise
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.get(
    "/analytics/event-day-patterns",
    response_model=schemas.EventDayPatternsResponse,
)
def get_event_day_patterns(db: Session = Depends(get_db)):
    try:
        events = crud.get_events_with_snapshots(db)
        return {
            **sales.compute_event_day_patterns(events, date.today()),
            **pricing.compute_tier_patterns(events, date.today()),
        }
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.post(
    "/events/{event_id}/finalize-actuals",
    response_model=schemas.FinalizeActualsResponse,
)
def finalize_actuals(event_id: int, db: Session = Depends(get_db)):
    """Explicit close-out: copy the latest snapshot into the event's final
    actuals. Snapshots never change actuals on their own."""
    try:
        event = _get_event_or_404(db, event_id)
        if event.event_date > date.today():
            raise HTTPException(
                status_code=400,
                detail="An event can only be closed out on or after its event date",
            )
        snapshots = sales.sort_snapshots(crud.get_sales_snapshots(db, event_id))
        if not snapshots:
            raise HTTPException(
                status_code=400,
                detail="No sales snapshots recorded; record actuals manually instead",
            )
        preview = sales.final_actuals_preview(event, snapshots[-1])
        crud.finalize_event_actuals(
            db, event, preview["actual_attendance"], preview["revenue"]
        )
        return {"event_id": event.id, **preview}
    except HTTPException:
        raise
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


def _get_tier_or_404(db: Session, event_id: int, tier_id: int) -> models.TicketTier:
    tier = db.get(models.TicketTier, tier_id)
    if tier is None or tier.event_id != event_id:
        raise HTTPException(status_code=404, detail="Ticket tier not found")
    return tier


def _handle_tier_integrity_error(db: Session, error: IntegrityError) -> None:
    error_message = str(getattr(error, "orig", error)).lower()
    if _constraint_name(error) == "uq_ticket_tier_event_name" or "unique" in error_message:
        _rollback_and_raise(
            db, 409, "A ticket tier with this name already exists for this event", error
        )
    _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.post(
    "/events/{event_id}/tiers",
    response_model=schemas.TicketTierResponse,
    status_code=201,
)
def create_ticket_tier(
    event_id: int, tier: schemas.TicketTierCreate, db: Session = Depends(get_db)
):
    try:
        _get_event_or_404(db, event_id)
        return crud.create_tier(db, event_id, tier)
    except HTTPException:
        raise
    except IntegrityError as error:
        _handle_tier_integrity_error(db, error)
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.get("/events/{event_id}/tiers", response_model=list[schemas.TicketTierResponse])
def list_ticket_tiers(event_id: int, db: Session = Depends(get_db)):
    try:
        _get_event_or_404(db, event_id)
        return crud.get_event_tiers(db, event_id)
    except HTTPException:
        raise
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.patch(
    "/events/{event_id}/tiers/{tier_id}",
    response_model=schemas.TicketTierResponse,
)
def update_ticket_tier(
    event_id: int,
    tier_id: int,
    changes: schemas.TicketTierUpdate,
    db: Session = Depends(get_db),
):
    try:
        _get_event_or_404(db, event_id)
        tier = _get_tier_or_404(db, event_id, tier_id)
        updates = changes.model_dump(exclude_unset=True)
        # name, price, sale_phase, is_premium and sort_order cannot be null.
        for field in ("name", "price", "sale_phase", "is_premium", "sort_order"):
            if field in updates and updates[field] is None:
                raise HTTPException(status_code=422, detail=f"{field} cannot be null")
        new_quantity = updates.get("quantity_available")
        if new_quantity is not None:
            _, max_sold = crud.tier_sales_summary(db, tier_id)
            if new_quantity < max_sold:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"quantity_available ({new_quantity}) is below the {max_sold} "
                        "tickets already recorded as sold for this tier"
                    ),
                )
        return crud.update_tier(db, tier, updates)
    except HTTPException:
        raise
    except IntegrityError as error:
        _handle_tier_integrity_error(db, error)
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.delete("/events/{event_id}/tiers/{tier_id}", status_code=204)
def delete_ticket_tier(event_id: int, tier_id: int, db: Session = Depends(get_db)):
    try:
        _get_event_or_404(db, event_id)
        tier = _get_tier_or_404(db, event_id, tier_id)
        snapshot_count, _ = crud.tier_sales_summary(db, tier_id)
        if snapshot_count:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"This tier has recorded sales in {snapshot_count} snapshot(s) and "
                    "cannot be deleted; delete those snapshots first"
                ),
            )
        crud.delete_tier(db, tier)
        return Response(status_code=204)
    except HTTPException:
        raise
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.get("/events/{event_id}/price-range", response_model=schemas.PriceRangeResponse)
def get_price_range(event_id: int, db: Session = Depends(get_db)):
    try:
        event = _get_event_or_404(db, event_id)
        tiers = crud.get_event_tiers(db, event_id)
        base, source = pricing.base_price(event, tiers)
        return {
            "event_id": event_id,
            **pricing.price_range(tiers),
            "base_price": base,
            "base_price_source": source,
        }
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


@app.delete("/event-artists/{event_artist_id}", status_code=204)
def delete_event_artist(event_artist_id: int, db: Session = Depends(get_db)):
    """Remove one artist from one event's lineup (e.g. they pulled out).
    The artist stays in the system."""
    try:
        event_artist = db.get(models.EventArtist, event_artist_id)
        if event_artist is None:
            raise HTTPException(status_code=404, detail="Lineup entry not found")
        crud.delete_event_artist(db, event_artist)
        return Response(status_code=204)
    except HTTPException:
        raise
    except SQLAlchemyError as error:
        _rollback_and_raise(db, 500, "An unexpected database error occurred", error)


@app.delete("/artists/{artist_id}", response_model=schemas.ArtistDeleteResponse)
def delete_artist(artist_id: int, db: Session = Depends(get_db)):
    """Delete an artist from the system, including all their lineup slots.
    Saved predictions are historical records and are not changed."""
    try:
        artist = db.get(models.Artist, artist_id)
        if artist is None:
            raise HTTPException(status_code=404, detail="Artist not found")
        artist_name = artist.artist_name
        removed = crud.delete_artist(db, artist)
        return {
            "deleted_artist_id": artist_id,
            "artist_name": artist_name,
            "lineup_entries_removed": removed,
        }
    except HTTPException:
        raise
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
        snapshots = crud.get_sales_snapshots(db, event.id)
        prices = pricing.prediction_prices(
            event, crud.get_event_tiers(db, event.id), snapshots, data.ticket_price
        )
        result = _run_prediction_math(
            ticket_price=prices["attendance_price"],
            marketing_spend=data.marketing_spend,
            capacity=data.capacity,
            linked_artists=linked_artists,
        )

        model_version = "v1-rule-based"
        sales_signal = None
        if len(snapshots) >= sales.MIN_SNAPSHOTS_FOR_SALES_SIGNAL:
            patterns = sales.compute_event_day_patterns(
                crud.get_events_with_snapshots(db), date.today(), exclude_event_id=event.id
            )
            sales_signal = sales.apply_sales_signals(
                base_attendance=result["predicted_attendance"],
                base_confidence=result["confidence_score"],
                capacity=data.capacity,
                event=event,
                snapshots=snapshots,
                patterns=patterns,
                today=date.today(),
            )
        if sales_signal is not None:
            model_version = "v1-rule-based+sales"
            result["predicted_attendance"] = sales_signal["predicted_attendance"]
            result["confidence_score"] = sales_signal["confidence_score"]
        if sales_signal is not None or prices["uses_tiers"]:
            # Revenue always follows the final attendance and effective price.
            result["predicted_revenue"] = round(
                result["predicted_attendance"] * prices["effective_price"], 2
            )
        if prices["uses_tiers"]:
            model_version += "+tiers"
            result["confidence_score"] = round(
                max(0.3, min(result["confidence_score"] + prices["confidence_boost"], 0.95)),
                2,
            )

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
        if sales_signal is not None:
            insight_summary += " " + sales_signal["insight"]
        if prices["note"]:
            insight_summary += " " + prices["note"]

        prediction_record = {
            "event_id": data.event_id,
            "predicted_attendance": result["predicted_attendance"],
            "predicted_revenue": result["predicted_revenue"],
            "confidence_score": result["confidence_score"],
            "model_version": model_version,
            "insight_summary": insight_summary,
        }

        band = ranges.compute_band(
            expected_attendance=result["predicted_attendance"],
            confidence=result["confidence_score"],
            capacity=data.capacity,
            event=event,
            snapshots=snapshots,
            today=date.today(),
            effective_price=prices["effective_price"],
            attendance_price=prices["attendance_price"],
            price_high=prices["price_high"],
        )

        return crud.create_prediction(db, prediction_record, band=band)
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
