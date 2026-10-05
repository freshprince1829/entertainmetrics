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
