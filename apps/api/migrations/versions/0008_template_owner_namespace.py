"""Scope private template slugs to their owner.

Revision ID: 0008
Revises: 0007
"""
import sqlalchemy as sa
from alembic import op


revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def _slug_indexes() -> list[dict]:
    return [
        index for index in sa.inspect(op.get_bind()).get_indexes("quiz_pack_templates")
        if index.get("column_names") == ["slug"]
    ]


def upgrade() -> None:
    indexes = _slug_indexes()
    constraints = [
        constraint for constraint in sa.inspect(op.get_bind()).get_unique_constraints("quiz_pack_templates")
        if constraint.get("column_names") == ["slug"] and constraint.get("name")
    ]
    with op.batch_alter_table("quiz_pack_templates", recreate="always") as batch:
        for index in indexes:
            batch.drop_index(index["name"])
        for constraint in constraints:
            batch.drop_constraint(constraint["name"], type_="unique")
        batch.create_index("ix_quiz_pack_templates_slug", ["slug"], unique=False)
        batch.create_unique_constraint("uq_quiz_pack_owner_slug", ["owner_id", "slug"])


def downgrade() -> None:
    with op.batch_alter_table("quiz_pack_templates", recreate="always") as batch:
        batch.drop_constraint("uq_quiz_pack_owner_slug", type_="unique")
        for index in _slug_indexes():
            batch.drop_index(index["name"])
        batch.create_index("ix_quiz_pack_templates_slug", ["slug"], unique=True)
