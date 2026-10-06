from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv
import os

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Columns added to tables that already exist. create_all only creates missing
# tables, so these are added by ensure_added_columns() at startup. Each entry:
# (table, column, column DDL, optional backfill SQL run once when added).
ADDED_COLUMNS = (
    (
        "ticket_tiers",
        "access_level",
        "VARCHAR NOT NULL DEFAULT 'general'",
        # Tiers marked premium before access levels existed become "premium".
        "UPDATE ticket_tiers SET access_level = 'premium' WHERE is_premium",
    ),
    ("ticket_tiers", "audience", "VARCHAR NOT NULL DEFAULT 'public'", None),
    ("ticket_tiers", "partner_name", "VARCHAR", None),
    ("snapshot_tier_sales", "checked_in", "INTEGER", None),
)


def ensure_added_columns(bind) -> list[str]:
    """Idempotently add the columns in ADDED_COLUMNS when they are missing.

    Safe to run on every startup: existing columns are detected first and
    skipped. PostgreSQL also gets ADD COLUMN IF NOT EXISTS; SQLite (tests)
    relies on the column check because it does not support that clause.
    Returns the "table.column" names that were added.
    """
    from sqlalchemy import inspect, text

    inspector = inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if_not_exists = "IF NOT EXISTS " if bind.dialect.name == "postgresql" else ""
    added = []
    with bind.begin() as connection:
        for table, column, ddl, backfill in ADDED_COLUMNS:
            if table not in existing_tables:
                continue  # create_all will build it with every column
            columns = {c["name"] for c in inspect(connection).get_columns(table)}
            if column in columns:
                continue
            connection.execute(
                text(f"ALTER TABLE {table} ADD COLUMN {if_not_exists}{column} {ddl}")
            )
            if backfill:
                connection.execute(text(backfill))
            added.append(f"{table}.{column}")
    return added
