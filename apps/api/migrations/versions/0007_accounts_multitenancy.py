"""Add accounts, ownership, plans and device identities.

Revision ID: 0007
Revises: 0006
"""
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

from app.db import Base
from app import models  # noqa: F401


revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


NEW_TABLES = (
    "accounts",
    "plans",
    "auth_sessions",
    "password_reset_tokens",
    "subscriptions",
    "guest_devices",
    "screen_accesses",
    "screen_devices",
    "media_assets",
)


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _add(table: str, column: sa.Column) -> None:
    if column.name not in _columns(table):
        op.add_column(table, column)


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.tables["accounts"].create(bind, checkfirst=True)
    Base.metadata.tables["plans"].create(bind, checkfirst=True)
    Base.metadata.tables["guest_devices"].create(bind, checkfirst=True)

    _add("events", sa.Column("owner_id", sa.String(length=36), nullable=True))
    _add("quiz_pack_templates", sa.Column("owner_id", sa.String(length=36), nullable=True))
    _add("quiz_pack_templates", sa.Column("visibility", sa.String(length=16), nullable=False, server_default="private"))
    _add("quiz_pack_templates", sa.Column("published_from_id", sa.String(length=36), nullable=True))
    _add("game_sessions", sa.Column("created_at", sa.DateTime(timezone=True), nullable=True))
    _add("participants", sa.Column("account_id", sa.String(length=36), nullable=True))
    _add("participants", sa.Column("guest_device_id", sa.String(length=36), nullable=True))
    _add("audit_logs", sa.Column("actor_account_id", sa.String(length=36), nullable=True))
    _add("audit_logs", sa.Column("target_account_id", sa.String(length=36), nullable=True))
    bind.execute(sa.text("UPDATE game_sessions SET created_at = COALESCE(created_at, started_at, :now)"), {"now": datetime.now(timezone.utc)})

    for table in NEW_TABLES[2:]:
        Base.metadata.tables[table].create(bind, checkfirst=True)

    for table, columns in {
        "events": ("owner_id",),
        "quiz_pack_templates": ("owner_id", "visibility"),
        "participants": ("account_id", "guest_device_id"),
        "audit_logs": ("actor_account_id", "target_account_id"),
    }.items():
        existing = {index["name"] for index in sa.inspect(bind).get_indexes(table)}
        for column in columns:
            name = f"ix_{table}_{column}"
            if name not in existing:
                op.create_index(name, table, [column], unique=False)


def downgrade() -> None:
    for table in reversed(NEW_TABLES):
        Base.metadata.tables[table].drop(op.get_bind(), checkfirst=True)
