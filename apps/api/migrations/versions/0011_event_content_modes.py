"""Add quiz, test and survey content modes.

Revision ID: 0011
Revises: 0010
"""

import sqlalchemy as sa
from alembic import op


revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("events")}
    if "content_mode" not in columns:
        op.add_column(
            "events",
            sa.Column("content_mode", sa.String(length=16), nullable=False, server_default="quiz"),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("events")}
    if "content_mode" in columns:
        op.drop_column("events", "content_mode")
