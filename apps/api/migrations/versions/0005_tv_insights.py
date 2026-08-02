"""Add informative TV display settings.

Revision ID: 0005
Revises: 0004
"""
import sqlalchemy as sa
from alembic import op


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("events")}
    if "tv_display_mode" not in columns:
        op.add_column("events", sa.Column("tv_display_mode", sa.String(length=16), nullable=False, server_default="classic"))
    if "tv_chart_style" not in columns:
        op.add_column("events", sa.Column("tv_chart_style", sa.String(length=16), nullable=False, server_default="both"))


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("events")}
    if "tv_chart_style" in columns:
        op.drop_column("events", "tv_chart_style")
    if "tv_display_mode" in columns:
        op.drop_column("events", "tv_display_mode")
