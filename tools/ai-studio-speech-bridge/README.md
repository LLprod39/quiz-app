# Google AI Studio speech bridge (MVP)

Локальный helper принимает только одну задачу, слушает `127.0.0.1:8766` и передаёт готовое аудио в Quiz API по одноразовому билету. Предпочтительный провайдер — официальный Gemini TTS API; автоматизация AI Studio в Chrome оставлена как запасной MVP-режим.

## Первичная установка

```powershell
npm i -g agent-browser
agent-browser install
```

На текущей машине обе команды уже выполнены (`agent-browser 0.33.2`). Повторять их нужно только после удаления global npm package или браузерного runtime.

Google email, пароль, API key, 2FA и CAPTCHA робот не вводит. Первый Google-вход выполняется вручную в отдельном Chrome profile `%LOCALAPPDATA%\QuizApp\ai-studio-profile`; затем Chrome сохраняет свою сессию. Helper не создаёт ключи и не включает billing.

## Обычный запуск MVP

Добавьте API key в корневой `.env` (файл исключён из Git):

```dotenv
GEMINI_API_KEY=ваш_ключ_из_Google_AI_Studio
```

Из корня проекта:

```powershell
.\start-quiz-mvp.ps1
```

Launcher поднимает bridge в скрытом окне, запускает LAN Compose и открывает `/admin`. При наличии `GEMINI_API_KEY` bridge вызывает `gemini-3.1-flash-tts-preview`, оборачивает возвращённый 24 kHz mono PCM в WAV и загружает его в квиз. Chrome не нужен.

Без ключа bridge использует старый browser runner: открывает Speech Composer, вставляет вопрос, выбирает голос и настройки и нажимает `Run`. Этот режим зависит от защитных механизмов Google AI Studio и может быть отклонён HTTP 403.

## Диагностика

```powershell
Invoke-RestMethod http://127.0.0.1:8766/health
```

`provider: gemini_api` и `gemini_api: configured` означают, что используется официальный API. `provider: ai_studio_browser` означает запасной браузерный режим. Поле `stage` показывает текущий этап: `gemini_api`, `browser_automation`, проверка аудио или upload. `login_required`, dialog ключа, HTTP 403 или Google security screen требуют перехода на API key; автоматического обхода защиты нет.

Актуальные доступные имена элементов и признаки готового/ошибочного результата записаны в [AI_STUDIO_UI_CONTRACT.md](AI_STUDIO_UI_CONTRACT.md). Runner обязан останавливаться, если текущий snapshot им не соответствует.

## Границы безопасности

- bridge и CDP привязаны к loopback;
- разрешён один активный task;
- голос, диапазоны и эффекты проверяются по allowlist;
- upload URL принимается только для Quiz API;
- organizer token, Google cookie и Chrome profile не передаются в Docker;
- временный каталог задачи удаляется после upload или ошибки.
