import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .models import Question, QuestionSpeechVersion


PROMPT_VERSION = 1
BRIDGE_URL = "http://127.0.0.1:8766"

VOICE_CATALOG = [
    {"id": "Kore", "label": "Женский · уверенный", "presentation": "female", "description": "Ровная уверенная подача ведущей"},
    {"id": "Aoede", "label": "Женский · мягкий", "presentation": "female", "description": "Тёплая и лёгкая семейная подача"},
    {"id": "Leda", "label": "Женский · живой", "presentation": "female", "description": "Яркая подача для динамичных раундов"},
    {"id": "Zephyr", "label": "Женский · светлый", "presentation": "female", "description": "Дружелюбный голос с лёгким тембром"},
    {"id": "Puck", "label": "Мужской · энергичный", "presentation": "male", "description": "Азартный голос ведущего квиз-баттла"},
    {"id": "Charon", "label": "Мужской · информативный", "presentation": "male", "description": "Спокойная и собранная подача"},
    {"id": "Fenrir", "label": "Мужской · выразительный", "presentation": "male", "description": "Эмоциональная подача для шоу"},
    {"id": "Orus", "label": "Мужской · глубокий", "presentation": "male", "description": "Уверенный низкий голос для финалов"},
]
VOICE_BY_ID = {item["id"]: item for item in VOICE_CATALOG}


def iso_utc(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

PRESETS = {
    "classic-host": {
        "label": "Классический ведущий",
        "voice_id": "Kore",
        "pace": 50,
        "energy": 70,
        "pitch": 50,
        "expression": 60,
        "clarity": 90,
        "pause_ms": 300,
        "effects": ["warm-smile"],
    },
    "energetic-battle": {
        "label": "Энергичный баттл",
        "voice_id": "Puck",
        "pace": 68,
        "energy": 92,
        "pitch": 58,
        "expression": 78,
        "clarity": 88,
        "pause_ms": 180,
        "effects": ["quiz-host", "emphasize"],
    },
    "calm-family": {
        "label": "Спокойный семейный",
        "voice_id": "Aoede",
        "pace": 42,
        "energy": 38,
        "pitch": 50,
        "expression": 42,
        "clarity": 92,
        "pause_ms": 260,
        "effects": ["warm-smile"],
    },
    "mystery-round": {
        "label": "Таинственный раунд",
        "voice_id": "Orus",
        "pace": 35,
        "energy": 42,
        "pitch": 42,
        "expression": 72,
        "clarity": 85,
        "pause_ms": 700,
        "effects": ["suspense", "mysterious"],
    },
    "final-question": {
        "label": "Финальный вопрос",
        "voice_id": "Fenrir",
        "pace": 44,
        "energy": 78,
        "pitch": 48,
        "expression": 86,
        "clarity": 95,
        "pause_ms": 950,
        "effects": ["quiz-host", "dramatic-pause", "final-question"],
    },
    "custom": {"label": "Свои настройки"},
}

ALLOWED_EFFECTS = {
    "quiz-host",
    "warm-smile",
    "suspense",
    "dramatic-pause",
    "emphasize",
    "mysterious",
    "final-question",
}


class SpeechStyleSettings(BaseModel):
    preset: Literal[
        "classic-host", "energetic-battle", "calm-family", "mystery-round", "final-question", "custom"
    ] = "classic-host"
    pace: int = Field(default=50, ge=0, le=100)
    energy: int = Field(default=70, ge=0, le=100)
    pitch: int = Field(default=50, ge=0, le=100)
    expression: int = Field(default=60, ge=0, le=100)
    clarity: int = Field(default=90, ge=0, le=100)
    pause_ms: int = Field(default=300, ge=0, le=1500)
    effects: list[str] = Field(default_factory=lambda: ["warm-smile"], max_length=7)

    @field_validator("effects")
    @classmethod
    def validate_effects(cls, value: list[str]) -> list[str]:
        unique = list(dict.fromkeys(value))
        unknown = set(unique) - ALLOWED_EFFECTS
        if unknown:
            raise ValueError(f"Неизвестные эффекты: {', '.join(sorted(unknown))}")
        return unique


DEFAULT_SPEECH_SETTINGS = {
    "voice_id": "Kore",
    "settings": SpeechStyleSettings().model_dump(),
}


class SpeechDefaultsBody(BaseModel):
    voice_id: str = "Kore"
    settings: SpeechStyleSettings = Field(default_factory=SpeechStyleSettings)

    @model_validator(mode="after")
    def validate_voice(self):
        if self.voice_id not in VOICE_BY_ID:
            raise ValueError("Выбранный голос недоступен")
        return self


class SpeechGenerationBody(SpeechDefaultsBody):
    force: bool = False


class QuestionSpeechSettingsBody(SpeechDefaultsBody):
    use_event_defaults: bool = True


def normalized_question_text(value: str) -> str:
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value or "")
    cleaned = cleaned.replace("\r\n", "\n").replace("\r", "\n").strip()
    return re.sub(r"\n{3,}", "\n\n", cleaned)


def normalized_event_speech_settings(value: dict | None) -> dict:
    raw = value or DEFAULT_SPEECH_SETTINGS
    voice_id = raw.get("voice_id", DEFAULT_SPEECH_SETTINGS["voice_id"])
    if voice_id not in VOICE_BY_ID:
        voice_id = DEFAULT_SPEECH_SETTINGS["voice_id"]
    try:
        style = SpeechStyleSettings(**(raw.get("settings") or {}))
    except Exception:
        style = SpeechStyleSettings()
    return {"voice_id": voice_id, "settings": style.model_dump()}


def _level(value: int, low: str, medium: str, high: str) -> str:
    if value <= 33:
        return low
    if value >= 67:
        return high
    return medium


def build_speech_prompt(text: str, style: SpeechStyleSettings) -> str:
    transcript = normalized_question_text(text)
    if not transcript:
        raise ValueError("Текст вопроса пуст")
    if len(transcript) > 1000:
        raise ValueError("Текст вопроса длиннее 1000 символов")

    delivery = [
        _level(style.energy, "спокойная", "уверенная", "очень энергичная"),
        "подача ведущего телевизионной викторины",
    ]
    notes = [
        f"Темп {_level(style.pace, 'медленный', 'средний', 'быстрый')}.",
        f"Регистр голоса {_level(style.pitch, 'более низкий', 'естественный', 'более высокий')}.",
        f"Выразительность {_level(style.expression, 'сдержанная', 'умеренная', 'театральная')}.",
        f"Дикция {_level(style.clarity, 'естественная', 'чёткая', 'максимально чёткая')}.",
    ]
    if style.pause_ms >= 800 or "dramatic-pause" in style.effects:
        notes.append("Добавь драматическую паузу перед самим вопросом.")
    elif style.pause_ms >= 250:
        notes.append("Добавь короткую паузу перед самим вопросом.")
    if "warm-smile" in style.effects:
        notes.append("Говори тепло, с лёгкой улыбкой.")
    if "suspense" in style.effects:
        notes.append("Создай ощущение интриги, не замедляя речь чрезмерно.")
    if "mysterious" in style.effects:
        notes.append("Используй слегка таинственный тон.")
    if "emphasize" in style.effects:
        notes.append("Умеренно подчеркни смысловые слова.")
    if "final-question" in style.effects:
        notes.append("Подай вопрос как важный финальный, но не кричи.")

    return "\n".join([
        "Создай озвучку на русском языке.",
        f"Манера: {' '.join(delivery)}.",
        " ".join(notes),
        "Не добавляй вступление, пояснения, комментарии или новые слова.",
        "Произнеси только текст между маркерами.",
        "",
        "ТЕКСТ ВОПРОСА:",
        "<<<",
        transcript,
        ">>>",
    ])


def speech_source_hash(text: str, voice_id: str, style: SpeechStyleSettings | dict) -> str:
    settings = style.model_dump() if isinstance(style, SpeechStyleSettings) else SpeechStyleSettings(**style).model_dump()
    canonical = json.dumps({
        "text": normalized_question_text(text),
        "voice_id": voice_id,
        "settings": settings,
        "prompt_version": PROMPT_VERSION,
    }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def speech_settings_context_hash(value: dict | None) -> str:
    normalized = normalized_event_speech_settings(value)
    canonical = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def voice_presentation(voice_id: str) -> str:
    return str(VOICE_BY_ID[voice_id]["presentation"])


def active_speech_version(question: Question) -> QuestionSpeechVersion | None:
    return next((version for version in question.speech_versions if version.status == "active"), None)


def serialize_speech_version(version: QuestionSpeechVersion) -> dict:
    return {
        "id": version.id,
        "question_id": version.question_id,
        "version_number": version.version_number,
        "status": version.status,
        "file_url": version.file_url,
        "mime_type": version.mime_type,
        "source_text": version.source_text,
        "source_hash": version.source_hash,
        "voice_id": version.voice_id,
        "voice_presentation": version.voice_presentation,
        "settings": version.settings_json or {},
        "prompt_version": version.prompt_version,
        "source": version.source,
        "created_at": iso_utc(version.created_at),
        "activated_at": iso_utc(version.activated_at),
    }


def serialize_question_speech(question: Question) -> dict:
    versions = sorted(question.speech_versions, key=lambda item: item.version_number, reverse=True)
    active = next((item for item in versions if item.status == "active"), None)
    candidate = next((item for item in versions if item.status == "candidate"), None)
    previous = next((item for item in versions if item.status == "previous"), None)
    event_settings = normalized_event_speech_settings(question.round.event.speech_settings)
    effective_settings = normalized_event_speech_settings(question.speech_settings_override or event_settings)
    expected_hash = speech_source_hash(question.text, effective_settings["voice_id"], effective_settings["settings"])
    return {
        "active": serialize_speech_version(active) if active else None,
        "candidate": serialize_speech_version(candidate) if candidate else None,
        "previous": serialize_speech_version(previous) if previous else None,
        "versions": [serialize_speech_version(item) for item in versions if item.status != "discarded"],
        "stale": bool(active and active.source_hash != expected_hash),
        "uses_event_defaults": question.speech_settings_override is None,
        "effective_settings": effective_settings,
    }


def sniff_audio(content: bytes) -> tuple[str, str] | None:
    if len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WAVE":
        return "audio/wav", ".wav"
    if content.startswith(b"ID3") or (len(content) >= 2 and content[0] == 0xFF and content[1] & 0xE0 == 0xE0):
        return "audio/mpeg", ".mp3"
    if len(content) >= 12 and content[4:8] == b"ftyp":
        return "audio/mp4", ".m4a"
    if content.startswith(b"OggS"):
        return "audio/ogg", ".ogg"
    return None
