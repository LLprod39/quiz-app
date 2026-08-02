from collections import OrderedDict
from hashlib import sha256
from html import escape
import re

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from .config import settings
from .db import get_db
from .models import GameSession


router = APIRouter(prefix="/api/speech", tags=["speech"])

_SAFE_REGION = re.compile(r"^[a-z0-9]+$")
_SAFE_VOICE = re.compile(r"^[a-zA-Z0-9:-]+$")
_AUDIO_CACHE: OrderedDict[str, bytes] = OrderedDict()
_MAX_CACHE_ITEMS = 256


class MicrosoftSpeechError(Exception):
    def __init__(self, status_code: int, detail: str, retry_after: str | None = None):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.retry_after = retry_after


def microsoft_speech_configured() -> bool:
    return bool(settings.azure_speech_key.strip() and settings.azure_speech_region.strip())


def build_ssml(text: str, voice: str) -> str:
    language = "-".join(voice.split("-")[:2]) if "-" in voice else "ru-RU"
    return (
        f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="{escape(language)}">'
        f'<voice name="{escape(voice)}">{escape(text.strip())}</voice></speak>'
    )


async def synthesize_microsoft_speech(
    text: str,
    *,
    key: str | None = None,
    region: str | None = None,
    voice: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> tuple[bytes, str]:
    subscription_key = (key if key is not None else settings.azure_speech_key).strip()
    resource_region = (region if region is not None else settings.azure_speech_region).strip().lower()
    selected_voice = (voice if voice is not None else settings.azure_speech_voice).strip()
    clean_text = text.strip()
    if not subscription_key or not resource_region:
        raise MicrosoftSpeechError(503, "Microsoft Speech не настроен; используется локальная озвучка браузера")
    if not _SAFE_REGION.fullmatch(resource_region) or not _SAFE_VOICE.fullmatch(selected_voice):
        raise MicrosoftSpeechError(503, "Некорректная конфигурация Microsoft Speech")
    if not clean_text:
        raise MicrosoftSpeechError(400, "Текст вопроса пуст")
    if len(clean_text) > 3000:
        raise MicrosoftSpeechError(413, "Текст вопроса слишком длинный для озвучки")

    cache_key = sha256(f"{resource_region}\0{selected_voice}\0{clean_text}".encode("utf-8")).hexdigest()
    cached = _AUDIO_CACHE.get(cache_key)
    if cached is not None:
        _AUDIO_CACHE.move_to_end(cache_key)
        return cached, selected_voice

    endpoint = f"https://{resource_region}.tts.speech.microsoft.com/cognitiveservices/v1"
    headers = {
        "Ocp-Apim-Subscription-Key": subscription_key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "QuizApp",
    }
    owns_client = client is None
    request_client = client or httpx.AsyncClient(timeout=settings.azure_speech_timeout_seconds)
    try:
        response = await request_client.post(endpoint, headers=headers, content=build_ssml(clean_text, selected_voice).encode("utf-8"))
    except httpx.HTTPError as error:
        raise MicrosoftSpeechError(502, "Microsoft Speech временно недоступен") from error
    finally:
        if owns_client:
            await request_client.aclose()

    if response.status_code == 429:
        raise MicrosoftSpeechError(503, "Исчерпан временный лимит Microsoft Speech", response.headers.get("Retry-After"))
    if response.status_code in {401, 403}:
        raise MicrosoftSpeechError(503, "Microsoft Speech отклонил ключ или регион")
    if response.status_code != 200:
        raise MicrosoftSpeechError(502, "Microsoft Speech не смог создать аудио")
    if not response.content:
        raise MicrosoftSpeechError(502, "Microsoft Speech вернул пустое аудио")

    _AUDIO_CACHE[cache_key] = response.content
    _AUDIO_CACHE.move_to_end(cache_key)
    while len(_AUDIO_CACHE) > _MAX_CACHE_ITEMS:
        _AUDIO_CACHE.popitem(last=False)
    return response.content, selected_voice


@router.get("/sessions/{code}/questions/{question_id}")
async def current_question_speech(code: str, question_id: str, db: Session = Depends(get_db)):
    if not microsoft_speech_configured():
        raise HTTPException(503, "Microsoft Speech не настроен; используется локальная озвучка браузера")
    session = db.scalar(
        select(GameSession)
        .options(joinedload(GameSession.current_question))
        .where(GameSession.join_code == code.upper())
    )
    if not session:
        raise HTTPException(404, "Комната не найдена")
    if session.status != "answering" or not session.current_question or session.current_question.id != question_id:
        raise HTTPException(409, "Этот вопрос сейчас не показывается")
    try:
        audio, voice = await synthesize_microsoft_speech(session.current_question.text)
    except MicrosoftSpeechError as error:
        headers = {"Retry-After": error.retry_after} if error.retry_after else None
        raise HTTPException(error.status_code, error.detail, headers=headers) from error
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "private, no-store",
            "X-Speech-Provider": "microsoft",
            "X-Speech-Voice": voice,
        },
    )
