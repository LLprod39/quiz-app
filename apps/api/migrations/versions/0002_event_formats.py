"""Add event formats and quiz battle topics.

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op


revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("events")}
    if "event_format" not in columns:
        op.add_column(
            "events",
            sa.Column("event_format", sa.String(length=20), nullable=False, server_default="celebration"),
        )
    if "topic" not in columns:
        op.add_column(
            "events",
            sa.Column("topic", sa.String(length=160), nullable=False, server_default=""),
        )


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("events")}
    if "topic" in columns:
        op.drop_column("events", "topic")
    if "event_format" in columns:
        op.drop_column("events", "event_format")
