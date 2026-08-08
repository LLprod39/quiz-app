from dataclasses import dataclass
from typing import Any, Literal


ContentMode = Literal["quiz", "test", "survey"]


@dataclass(frozen=True)
class ContentModePolicy:
    scores_answers: bool
    shows_public_leaderboard: bool
    reveals_correct_answers: bool


CONTENT_MODE_POLICIES: dict[str, ContentModePolicy] = {
    "quiz": ContentModePolicy(scores_answers=True, shows_public_leaderboard=True, reveals_correct_answers=True),
    "test": ContentModePolicy(scores_answers=True, shows_public_leaderboard=False, reveals_correct_answers=True),
    "survey": ContentModePolicy(scores_answers=False, shows_public_leaderboard=False, reveals_correct_answers=False),
}


def content_mode_policy(mode: str | None) -> ContentModePolicy:
    """Return quiz semantics for legacy rows that predate content modes."""
    return CONTENT_MODE_POLICIES.get(mode or "quiz", CONTENT_MODE_POLICIES["quiz"])


def validate_question_for_mode(
    mode: str,
    question_type: str,
    correct_answer: Any,
    accepted_answers: list[Any] | None,
    options: list[Any],
) -> None:
    """Keep survey questions free of hidden scoring metadata."""
    if mode != "survey":
        return
    if question_type not in {"single", "multiple", "text", "number"}:
        raise ValueError("Для опроса доступны выбор одного, нескольких вариантов, текст или число")
    if correct_answer not in (None, "", []):
        raise ValueError("В опросе не должно быть правильного ответа")
    if accepted_answers:
        raise ValueError("В опросе не должно быть вариантов правильного текстового ответа")
    if any(bool(option.get("is_correct")) if isinstance(option, dict) else bool(getattr(option, "is_correct", False)) for option in options):
        raise ValueError("В опросе варианты ответа не могут быть отмечены как правильные")
