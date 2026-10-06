from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    event_name = Column(String, nullable=False)
    event_type = Column(String, nullable=False)
    event_date = Column(Date, nullable=False)
    venue = Column(String, nullable=False)
    city = Column(String, nullable=False)
    ticket_price = Column(Float, nullable=False)
    marketing_spend = Column(Float, nullable=False)
    capacity = Column(Integer, nullable=False)
    actual_attendance = Column(Integer, nullable=True)
    revenue = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    lineup = relationship(
        "EventArtist",
        back_populates="event",
        cascade="all, delete-orphan",
    )
    predictions = relationship(
        "Prediction",
        back_populates="event",
        cascade="all, delete-orphan",
    )
    sales_snapshots = relationship(
        "TicketSalesSnapshot",
        back_populates="event",
        cascade="all, delete-orphan",
    )
    tiers = relationship(
        "TicketTier",
        back_populates="event",
        cascade="all, delete-orphan",
    )

    # Read-only summaries of the ticket tiers, exposed as optional API fields.
    @property
    def tier_count(self) -> int:
        return len(self.tiers)

    @property
    def price_low(self) -> float | None:
        return min((t.price for t in self.tiers), default=None)

    @property
    def price_high(self) -> float | None:
        return max((t.price for t in self.tiers), default=None)


class Artist(Base):
    __tablename__ = "artists"

    id = Column(Integer, primary_key=True, index=True)
    artist_name = Column(String, nullable=False, unique=True, index=True)
    genre = Column(String, nullable=True)
    label = Column(String, nullable=True)
    spotify_monthly_streams = Column(Integer, nullable=True)
    youtube_subscribers = Column(Integer, nullable=True)
    instagram_followers = Column(Integer, nullable=True)
    engagement_score = Column(Float, nullable=True)
    headline_score = Column(Float, nullable=True)
    market_strength_score = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    event_links = relationship(
        "EventArtist",
        back_populates="artist",
        cascade="all, delete-orphan",
    )


class EventArtist(Base):
    __tablename__ = "event_artists"
    __table_args__ = (
        UniqueConstraint(
            "event_id",
            "artist_id",
            "performance_order",
            name="uq_event_artist_performance_order",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False, index=True)
    artist_id = Column(Integer, ForeignKey("artists.id"), nullable=False, index=True)
    role = Column(String, nullable=True)
    performance_order = Column(Integer, nullable=True)
    is_headliner = Column(Boolean, nullable=False, default=False)
    set_duration_minutes = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    event = relationship("Event", back_populates="lineup")
    artist = relationship("Artist", back_populates="event_links")


class Prediction(Base):
    __tablename__ = "predictions"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False, index=True)
    predicted_attendance = Column(Integer, nullable=False)
    predicted_revenue = Column(Float, nullable=False)
    confidence_score = Column(Float, nullable=False)
    model_version = Column(String, nullable=True)
    insight_summary = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    event = relationship("Event", back_populates="predictions")


class TicketSalesSnapshot(Base):
    """A timestamped, cumulative reading of ticket sales and attendance for an
    event. Several snapshots can be logged per day (e.g. at the gate)."""

    __tablename__ = "ticket_sales_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False, index=True)
    recorded_at = Column(DateTime(timezone=True), nullable=False)
    tickets_sold_total = Column(Integer, nullable=False)
    gate_tickets_sold = Column(Integer, nullable=False, default=0)
    attendance_checked_in = Column(Integer, nullable=True)
    revenue_to_date = Column(Float, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    event = relationship("Event", back_populates="sales_snapshots")
    tier_sales_rows = relationship(
        "SnapshotTierSales",
        back_populates="snapshot",
        cascade="all, delete-orphan",
    )

    @property
    def tier_sales(self):
        """Per-tier sales for this snapshot, or None for legacy snapshots."""
        return self.tier_sales_rows or None


class TicketTier(Base):
    """A kind of ticket sold for an event (early bird, VIP, gate, ...)."""

    __tablename__ = "ticket_tiers"
    __table_args__ = (
        UniqueConstraint("event_id", "name", name="uq_ticket_tier_event_name"),
    )

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    price = Column(Float, nullable=False)
    quantity_available = Column(Integer, nullable=True)
    sale_phase = Column(String, nullable=False, default="standard")
    is_premium = Column(Boolean, nullable=False, default=False)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    event = relationship("Event", back_populates="tiers")
    sales = relationship("SnapshotTierSales", back_populates="tier")


class SnapshotTierSales(Base):
    """Cumulative tickets sold for one tier at the time of one snapshot."""

    __tablename__ = "snapshot_tier_sales"
    __table_args__ = (
        UniqueConstraint("snapshot_id", "tier_id", name="uq_snapshot_tier"),
    )

    id = Column(Integer, primary_key=True, index=True)
    snapshot_id = Column(
        Integer,
        ForeignKey("ticket_sales_snapshots.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tier_id = Column(Integer, ForeignKey("ticket_tiers.id"), nullable=False, index=True)
    tickets_sold = Column(Integer, nullable=False)

    snapshot = relationship("TicketSalesSnapshot", back_populates="tier_sales_rows")
    tier = relationship("TicketTier", back_populates="sales")

    @property
    def tier_name(self) -> str:
        return self.tier.name

    @property
    def tier_price(self) -> float:
        return self.tier.price
