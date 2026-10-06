from datetime import date, datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


class EventActualsUpdate(BaseModel):
    actual_attendance: int = Field(ge=0)
    revenue: float | None = Field(default=None, ge=0)


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
    # Optional, computed from ticket tiers (null / 0 when none are defined).
    tier_count: int = 0
    price_low: float | None = None
    price_high: float | None = None

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


class ArtistDeleteResponse(BaseModel):
    deleted_artist_id: int
    artist_name: str
    lineup_entries_removed: int


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
    # Optional prediction range (null for predictions made before ranges).
    attendance_low: int | None = None
    attendance_high: int | None = None
    revenue_low: float | None = None
    revenue_high: float | None = None
    range_note: str | None = None

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
    # Optional, computed from ticket tiers (null / 0 when none are defined).
    tier_count: int = 0
    price_low: float | None = None
    price_high: float | None = None


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
    # Optional prediction range (null for predictions made before ranges).
    attendance_low: int | None = None
    attendance_high: int | None = None
    revenue_low: float | None = None
    revenue_high: float | None = None
    range_note: str | None = None

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
    # Optional range comparison (null when the prediction has no band).
    attendance_low: int | None = None
    attendance_high: int | None = None
    revenue_low: float | None = None
    revenue_high: float | None = None
    attendance_in_range: bool | None = None
    revenue_in_range: bool | None = None


class AwaitingResultsItem(BaseModel):
    event_id: int
    event_name: str
    event_date: date
    predicted_attendance: int | None = None
    predicted_revenue: float | None = None


class PredictedVsActualResponse(BaseModel):
    events_compared: int
    mean_attendance_error_pct: float | None = None
    mean_revenue_error_pct: float | None = None
    items: list[PredictedVsActualItem]
    awaiting_results: list[AwaitingResultsItem] = []
    # Optional: share of compared events (with a band) whose actual
    # attendance fell inside the predicted range.
    events_with_range: int = 0
    events_in_range: int = 0
    range_coverage_pct: float | None = None


class TierSaleInput(BaseModel):
    tier_id: int
    tickets_sold: int = Field(ge=0)
    # Optional cumulative people scanned in for this tier.
    checked_in: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def check_checked_in(self):
        if self.checked_in is not None and self.checked_in > self.tickets_sold:
            raise ValueError("checked_in cannot exceed tickets_sold for a tier")
        return self


class SalesSnapshotCreate(BaseModel):
    recorded_at: datetime
    # Required for legacy snapshots; computed by the server when tier_sales
    # is provided.
    tickets_sold_total: int | None = Field(default=None, ge=0)
    gate_tickets_sold: int = Field(default=0, ge=0)
    attendance_checked_in: int | None = Field(default=None, ge=0)
    revenue_to_date: float | None = Field(default=None, ge=0)
    notes: str | None = None
    tier_sales: list[TierSaleInput] | None = None

    @model_validator(mode="after")
    def check_consistency(self):
        if self.tier_sales is not None:
            if not self.tier_sales:
                raise ValueError("tier_sales cannot be empty; omit it for a legacy snapshot")
            tier_ids = [sale.tier_id for sale in self.tier_sales]
            if len(tier_ids) != len(set(tier_ids)):
                raise ValueError("each tier can only appear once in tier_sales")
            # Totals are computed (and cross-checked) by the server.
            return self
        if self.tickets_sold_total is None:
            raise ValueError("tickets_sold_total is required unless tier_sales is provided")
        if self.gate_tickets_sold > self.tickets_sold_total:
            raise ValueError("gate_tickets_sold cannot exceed tickets_sold_total")
        if (
            self.attendance_checked_in is not None
            and self.attendance_checked_in > self.tickets_sold_total
        ):
            raise ValueError("attendance_checked_in cannot exceed tickets_sold_total")
        return self


class TierSaleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tier_id: int
    tier_name: str
    tier_price: float
    tickets_sold: int
    checked_in: int | None = None


class SalesSnapshotResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    recorded_at: datetime
    tickets_sold_total: int
    gate_tickets_sold: int
    attendance_checked_in: int | None = None
    revenue_to_date: float | None = None
    notes: str | None = None
    created_at: datetime | None = None
    tier_sales: list[TierSaleResponse] | None = None

    @field_validator("recorded_at")
    @classmethod
    def recorded_at_as_utc(cls, value: datetime) -> datetime:
        # SQLite returns naive datetimes; they are stored as UTC.
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value


class FinalizePreview(BaseModel):
    snapshot_id: int
    recorded_at: datetime
    actual_attendance: int
    attendance_source: str
    revenue: float | None = None
    revenue_source: str


class SalesProgressResponse(BaseModel):
    event_id: int
    capacity: int
    phase: str
    days_until_event: int
    snapshot_count: int
    latest_recorded_at: datetime | None = None
    tickets_sold_total: int | None = None
    gate_tickets_sold: int | None = None
    attendance_checked_in: int | None = None
    revenue_to_date: float | None = None
    sell_through_pct: float | None = None
    velocity_tickets_per_day: float | None = None
    gate_share_pct: float | None = None
    show_rate_pct: float | None = None
    projected_final_sales: int | None = None
    finalize_preview: FinalizePreview | None = None
    explanation: str


class LiveVsPredictedResponse(BaseModel):
    event_id: int
    phase: str
    recorded_at: datetime | None = None
    predicted_attendance: int | None = None
    tickets_sold_so_far: int | None = None
    attendance_so_far: int | None = None
    tickets_percent_of_prediction: float | None = None
    attendance_percent_of_prediction: float | None = None
    status: str | None = None
    status_basis: str
    tolerance_pct: float
    is_final: bool
    explanation: str
    # Optional: position of tickets sold so far within the prediction band.
    attendance_low: int | None = None
    attendance_high: int | None = None
    range_status: str | None = None
    status_label: str | None = None


class EventDayPatternsResponse(BaseModel):
    avg_gate_share_pct: float | None = None
    avg_show_rate_pct: float | None = None
    events_used: int
    min_events_required: int
    sufficient_history: bool
    explanation: str
    # Optional tier patterns (from completed events with tier-level sales).
    avg_premium_revenue_share_pct: float | None = None
    avg_early_bird_ticket_share_pct: float | None = None
    tier_events_used: int = 0
    tier_sufficient_history: bool = False


class FinalizeActualsResponse(FinalizePreview):
    event_id: int


# "premium" is for VIP / VVIP tiers; a tier is premium exactly when its
# sale_phase is "premium" (is_premium in responses is derived from it).
SalePhase = Literal["early_bird", "advance", "standard", "last_minute", "gate", "premium"]
AccessLevel = Literal["general", "premium", "vip", "vvip", "all_access", "group"]
Audience = Literal["public", "partner", "group", "complimentary"]


class TicketTierCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    price: float = Field(ge=0)
    quantity_available: int | None = Field(default=None, ge=0)
    sale_phase: SalePhase = "standard"
    sort_order: int = 0
    access_level: AccessLevel = "general"
    audience: Audience = "public"
    partner_name: str | None = Field(default=None, max_length=80)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name cannot be blank")
        return value


class TicketTierUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    price: float | None = Field(default=None, ge=0)
    quantity_available: int | None = Field(default=None, ge=0)
    sale_phase: SalePhase | None = None
    sort_order: int | None = None
    access_level: AccessLevel | None = None
    audience: Audience | None = None
    partner_name: str | None = Field(default=None, max_length=80)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("name cannot be blank")
        return value


class TicketTierResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    name: str
    price: float
    quantity_available: int | None = None
    sale_phase: str
    is_premium: bool
    sort_order: int
    created_at: datetime | None = None
    # Optional fields added with access levels / audiences.
    access_level: str = "general"
    audience: str = "public"
    partner_name: str | None = None
    price_multiplier: float | None = None
    price_band: str | None = None
    sales_snapshot_count: int = 0
    warnings: list[str] = []


class PriceRangeResponse(BaseModel):
    event_id: int
    tier_count: int
    price_low: float | None = None
    price_high: float | None = None
    average_price_by_quantity: float | None = None
    weighting: str | None = None
    base_price: float
    base_price_source: str


class TierBreakdownItem(BaseModel):
    tier_id: int
    name: str
    price: float
    sale_phase: str
    is_premium: bool
    quantity_available: int | None = None
    tickets_sold: int
    revenue: float
    share_of_tickets_pct: float | None = None
    share_of_revenue_pct: float | None = None
    sell_through_pct: float | None = None
    sold_out: bool


class RevenueBreakdownResponse(BaseModel):
    event_id: int
    has_tier_data: bool
    snapshot_id: int | None = None
    recorded_at: datetime | None = None
    tickets_sold_total: int | None = None
    revenue_total: float | None = None
    realized_average_price: float | None = None
    base_price: float
    tiers: list[TierBreakdownItem]
    explanation: str


class TierAnalyticsItem(BaseModel):
    tier_id: int
    name: str
    price: float
    sale_phase: str
    access_level: str
    audience: str
    partner_name: str | None = None
    price_band: str
    is_premium: bool
    quantity_available: int | None = None
    tickets_sold: int
    revenue: float
    share_of_tickets_pct: float | None = None
    share_of_revenue_pct: float | None = None
    sell_through_pct: float | None = None
    days_to_sell_out: float | None = None
    realized_average_price: float | None = None
    revenue_per_ticket: float | None = None
    checked_in: int | None = None
    show_rate_pct: float | None = None


class TierGroupShare(BaseModel):
    key: str
    tickets: int
    revenue: float
    share_of_tickets_pct: float | None = None
    share_of_revenue_pct: float | None = None


class TierAnalyticsResponse(BaseModel):
    event_id: int
    has_tier_data: bool
    message: str | None = None
    snapshot_id: int | None = None
    recorded_at: datetime | None = None
    tickets_sold_total: int | None = None
    revenue_total: float | None = None
    realized_average_price: float | None = None
    partner_discount_share_pct: float | None = None
    partner_average_price: float | None = None
    tiers: list[TierAnalyticsItem]
    by_sale_phase: list[TierGroupShare]
    by_access_level: list[TierGroupShare]
    by_audience: list[TierGroupShare]
    affordability_profile: list[TierGroupShare]
    insights: list[str]
    note: str


class TierPatternGroup(BaseModel):
    key: str
    avg_share_of_tickets_pct: float
    avg_share_of_revenue_pct: float
    events_with_key: int


class TierPatternsResponse(BaseModel):
    events_used: int
    min_events_required: int
    sufficient_history: bool
    by_access_level: list[TierPatternGroup]
    by_sale_phase: list[TierPatternGroup]
    by_audience: list[TierPatternGroup]
    avg_early_bird_days_to_sell_out: float | None = None
    early_bird_tiers_sold_out: int
    explanation: str
    note: str
