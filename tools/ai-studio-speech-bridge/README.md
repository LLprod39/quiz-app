# Quiz speech bridge (MVP)

Локальный helper принимает только одну задачу, слушает `127.0.0.1:8766` и передаёт готовое аудио в Quiz API по одноразовому билету. На Windows по умолчанию используется установленный русский системный голос: без API key, Google, сети и billing.

## Необязательный браузерный режим

```powershell
npm i -g agent-browser
agent-browser install
```

На текущей машине обе команды уже выполнены (`agent-browser 0.33.2`). Повторять их нужно только после удаления global npm package или браузерного runtime.

Google email, пароль, API key, 2FA и CAPTCHA робот не вводит. Первый Google-вход выполняется вручную в отдельном Chrome profile `%LOCALAPPDATA%\QuizApp\ai-studio-profile`; затем Chrome сохраняет свою сессию. Helper не создаёт ключи и не включает billing.

## Обычный запуск MVP

API key не требуется. Из корня проекта:

```powershell
.\start-quiz-mvp.ps1
```

Если позднее понадобится Gemini TTS, добавьте API key в корневой `.env` (файл исключён из Git):

```dotenv
GEMINI_API_KEY=ваш_ключ_из_Google_AI_Studio
```

Launcher поднимает bridge в скрытом окне, запускает LAN Compose и открывает `/admin`. Без ключа bridge использует первый установленный русский системный голос (на этой машине — `Microsoft Irina Desktop`), применяет темп, громкость и паузу, создаёт WAV и загружает его в квиз. Chrome не нужен.

При наличии `GEMINI_API_KEY` bridge предпочитает `gemini-3.1-flash-tts-preview`. Старый browser runner доступен только если локальный Windows TTS явно отключён через `QUIZ_SPEECH_DISABLE_WINDOWS_TTS=1`; он может быть отклонён Google с HTTP 403.

## Диагностика

```powershell
Invoke-RestMethod http://127.0.0.1:8766/health
```

`provider: windows_tts` означает полностью локальную озвучку без ключа. `provider: gemini_api` означает официальный API, а `provider: ai_studio_browser` — запасной браузерный режим. Поле `stage` показывает текущий этап: `windows_tts`, `gemini_api`, `browser_automation`, проверка аудио или upload.

Актуальные доступные имена элементов и признаки готового/ошибочного результата записаны в [AI_STUDIO_UI_CONTRACT.md](AI_STUDIO_UI_CONTRACT.md). Runner обязан останавливаться, если текущий snapshot им не соответствует.

## Границы безопасности

- bridge и CDP привязаны к loopback;
- разрешён один активный task;
- голос, диапазоны и эффекты проверяются по allowlist;
- upload URL принимается только для Quiz API;
- organizer token, Google cookie и Chrome profile не передаются в Docker;
- временный каталог задачи удаляется после upload или ошибки.
