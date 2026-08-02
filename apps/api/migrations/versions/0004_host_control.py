"""Add organizer auto and manual control settings.

Revision ID: 0004
Revises: 0003
"""
import sqlalchemy as sa
from alembic import op


revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("events")}
    if "host_mode" not in columns:
        op.add_column("events", sa.Column("host_mode", sa.String(length=16), nullable=False, server_default="auto"))
    if "auto_advance_seconds" not in columns:
        op.add_column("events", sa.Column("auto_advance_seconds", sa.Integer(), nullable=False, server_default="5"))


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("events")}
    if "auto_advance_seconds" in columns:
        op.drop_column("events", "auto_advance_seconds")
    if "host_mode" in columns:
        op.drop_column("events", "host_mode")
