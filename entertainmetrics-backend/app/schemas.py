from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class EventCreate(BaseModel):
    event_name: str
    event_type: str
    event_date: date
    venue: str
    city: str
    ticket_price: float
    marketing_spend: float
    capacity: int
    actual_attendance: int | None = None
    revenue: float | None = None


class EventArtistResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    artist_id: int
    role: str | None = None
    performance_order: int | None = None
    is_headliner: bool
    set_duration_minutes: int | None = None
    created_at: datetime

class EventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_name: str
    event_type: str
    event_date: date
    venue: str
    city: str
    ticket_price: float
    marketing_spend: float
    capacity: int
    actual_attendance: int | None = None
    revenue: float | None = None
    created_at: datetime

class ArtistCreate(BaseModel):
    artist_name: str
    genre: str | None = None
    label: str | None = None
    spotify_monthly_streams: int | None = None
    youtube_subscribers: int | None = None
    instagram_followers: int | None = None
    engagement_score: float | None = None
    headline_score: float | None = None
    market_strength_score: float | None = None


class ArtistResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    artist_name: str
    genre: str | None = None
    label: str | None = None
    spotify_monthly_streams: int | None = None
    youtube_subscribers: int | None = None
    instagram_followers: int | None = None
    engagement_score: float | None = None
    headline_score: float | None = None
    market_strength_score: float | None = None
    created_at: datetime


class EventArtistCreate(BaseModel):
    event_id: int
    artist_id: int
    role: str | None = None
    performance_order: int | None = None
    is_headliner: bool = False
    set_duration_minutes: int | None = None


class PredictionRequest(BaseModel):
    event_id: int
    ticket_price: float
    marketing_spend: float
    capacity: int


class PredictionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    predicted_attendance: int
    predicted_revenue: float
    confidence_score: float
    model_version: str | None = None
    insight_summary: str | None = None
    created_at: datetime

class DashboardSummaryResponse(BaseModel):
    total_events: int
    total_artists: int
    total_predictions: int
    average_predicted_attendance: float
    average_predicted_revenue: float


class RecentEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_name: str
    event_type: str
    event_date: date
    venue: str
    city: str
    ticket_price: float
    marketing_spend: float
    capacity: int
    actual_attendance: int | None = None
    revenue: float | None = None
    created_at: datetime


class RecentPredictionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    predicted_attendance: int
    predicted_revenue: float
    confidence_score: float
    model_version: str | None = None
    insight_summary: str | None = None
    created_at: datetime

class ArtistRecommendationResponse(BaseModel):
    artist_id: int
    artist_name: str
    genre: str | None = None
    recommendation_score: float
    projected_attendance_uplift: int
    projected_revenue_uplift: float
    reason: str


class PricingCandidate(BaseModel):
    ticket_price: float
    predicted_attendance: int
    predicted_revenue: float


class PricingRecommendationResponse(BaseModel):
    event_id: int
    recommended_ticket_price: float
    predicted_attendance: int
    predicted_revenue: float
    confidence_score: float
    candidates: list[PricingCandidate]
    insight_summary: str


class PredictedVsActualItem(BaseModel):
    event_id: int
    event_name: str
    event_date: date
    predicted_attendance: int
    actual_attendance: int
    attendance_error_pct: float | None = None
    predicted_revenue: float
    actual_revenue: float | None = None
    revenue_error_pct: float | None = None


class PredictedVsActualResponse(BaseModel):
    events_compared: int
    mean_attendance_error_pct: float | None = None
    mean_revenue_error_pct: float | None = None
    items: list[PredictedVsActualItem]
