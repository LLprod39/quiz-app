# Google AI Studio speech bridge (MVP)

Локальный helper принимает только одну задачу, слушает `127.0.0.1:8766`, запускает отдельный Chrome profile и передаёт скачанное аудио в Quiz API по одноразовому билету.

## Первичная установка

```powershell
npm i -g agent-browser
agent-browser install
```

На текущей машине обе команды уже выполнены (`agent-browser 0.33.2`). Повторять их нужно только после удаления global npm package или браузерного runtime.

Google email, пароль, API key, 2FA и CAPTCHA робот не вводит. Первый Google-вход выполняется вручную в отдельном Chrome profile `%LOCALAPPDATA%\QuizApp\ai-studio-profile`; затем Chrome сохраняет свою сессию. Helper не создаёт ключи и не включает billing.

## Обычный запуск MVP

Из корня проекта:

```powershell
.\start-quiz-mvp.ps1
```

Launcher поднимает bridge в скрытом окне, запускает LAN Compose и открывает `/admin`. Chrome для AI Studio запускается лениво при первой задаче с отдельным profile и CDP только на `127.0.0.1:9223`.

Реализованный runner автоматически открывает Speech Composer, очищает `Sample Context`, вставляет точный текст вопроса, выбирает голос, Style, Pace и Accent и нажимает `Run`. Для `Run` используется не DOM `element.click()`, а координатный цикл мыши по центру актуального bounding box кнопки: Google формирует корректный защитный токен именно при pointer input. При временном HTTP 403 runner делает один повторный координатный запуск через 20 секунд. Затем он ждёт до четырёх минут и принимает только новый аудиоисточник `data:`/`blob:`, для которого доступны `Download`, ненулевая длительность и `readyState = 4`; состояние должно быть стабильным в двух последовательных проверках. Только после этого WAV/MP3/M4A/OGG сохраняется в каталог задачи. Прямых вызовов Gemini API в runner и bridge нет.

## Диагностика

```powershell
Invoke-RestMethod http://127.0.0.1:8766/health
```

`agent_browser: missing` означает, что нужно выполнить две команды первичной установки выше. Поле `stage` показывает реальный текущий этап: проверка запроса, browser automation, ожидание полного аудио или upload. `login_required`, фактически открывшийся после `Run` dialog настройки ключа или Google security screen требуют ручного действия пользователя; автоматического обхода нет. Надпись `No API key selected` сама по себе не является блокировкой: на проверенной странице при ней несколько запусков успешно создали WAV. При временном HTTP 403 runner повторяет pointer-click один раз и никогда не сохраняет служебный `trivia.wav` как результат.

Актуальные доступные имена элементов и признаки готового/ошибочного результата записаны в [AI_STUDIO_UI_CONTRACT.md](AI_STUDIO_UI_CONTRACT.md). Runner обязан останавливаться, если текущий snapshot им не соответствует.

## Границы безопасности

- bridge и CDP привязаны к loopback;
- разрешён один активный task;
- голос, диапазоны и эффекты проверяются по allowlist;
- upload URL принимается только для Quiz API;
- organizer token, Google cookie и Chrome profile не передаются в Docker;
- временный каталог задачи удаляется после upload или ошибки.
