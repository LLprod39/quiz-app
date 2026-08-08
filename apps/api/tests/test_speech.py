import asyncio
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

from app import speech


def test_microsoft_speech_request_uses_server_key_and_escapes_question_text():
    captured = {}

    async def handler(request: httpx.Request):
        captured["url"] = str(request.url)
        captured["key"] = request.headers.get("Ocp-Apim-Subscription-Key")
        captured["format"] = request.headers.get("X-Microsoft-OutputFormat")
        captured["body"] = request.content.decode("utf-8")
        return httpx.Response(200, content=b"mp3-audio")

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await speech.synthesize_microsoft_speech(
                "Кто быстрее: Том & Джерри?",
                key="server-secret",
                region="westeurope",
                voice="ru-RU-SvetlanaNeural",
                client=client,
            )

    audio, voice = asyncio.run(run())
    assert audio == b"mp3-audio"
    assert voice == "ru-RU-SvetlanaNeural"
    assert captured["url"] == "https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1"
    assert captured["key"] == "server-secret"
    assert captured["format"] == "audio-24khz-48kbitrate-mono-mp3"
    assert "Кто быстрее: Том &amp; Джерри?" in captured["body"]


def test_microsoft_speech_requires_key_and_region():
    with pytest.raises(speech.MicrosoftSpeechError) as error:
        asyncio.run(speech.synthesize_microsoft_speech("Вопрос", key="", region="", voice="ru-RU-SvetlanaNeural"))
    assert error.value.status_code == 503


def test_endpoint_sends_only_current_question_text(monkeypatch):
    question = SimpleNamespace(id="question-1", text="Только текст вопроса", options=[SimpleNamespace(text="Секретный вариант")])
    session = SimpleNamespace(status="answering", current_question=question)
    access = SimpleNamespace(session_id="session-1")
    rows = iter([access, session])
    db = SimpleNamespace(scalar=lambda _: next(rows))
    received = []

    async def fake_synthesis(text: str):
        received.append(text)
        return b"audio", "ru-RU-SvetlanaNeural"

    monkeypatch.setattr(speech.settings, "azure_speech_key", "configured")
    monkeypatch.setattr(speech.settings, "azure_speech_region", "westeurope")
    monkeypatch.setattr(speech, "synthesize_microsoft_speech", fake_synthesis)
    response = asyncio.run(speech.current_question_speech("ABC123", "question-1", db))

    assert response.body == b"audio"
    assert received == ["Только текст вопроса"]
    assert "Секретный вариант" not in received[0]


def test_endpoint_rejects_a_question_that_is_not_on_screen(monkeypatch):
    question = SimpleNamespace(id="question-1", text="Текущий вопрос")
    session = SimpleNamespace(status="answering", current_question=question)
    access = SimpleNamespace(session_id="session-1")
    rows = iter([access, session])
    db = SimpleNamespace(scalar=lambda _: next(rows))
    monkeypatch.setattr(speech.settings, "azure_speech_key", "configured")
    monkeypatch.setattr(speech.settings, "azure_speech_region", "westeurope")

    with pytest.raises(HTTPException) as error:
        asyncio.run(speech.current_question_speech("ABC123", "another-question", db))
    assert error.value.status_code == 409
