# Google AI Studio Speech UI contract

Проверено вручную через авторизованную вкладку Chrome 2026-08-03 на `https://aistudio.google.com/generate-speech`.

Этот файл описывает признаки, которые runner должен находить в каждом новом accessibility snapshot. Это не постоянные CSS-селекторы: после любого изменения состояния runner обязан получать новый snapshot и заново искать актуальные refs.

## Начальный экран

- URL host: `aistudio.google.com`.
- Заголовок страницы: `Google AI Studio`.
- Авторизованное состояние подтверждается кнопкой аккаунта и отсутствием формы входа.
- Переход в редактор: quickstart-кнопка `The Game Show Host - A vibrant and theatrical host.`; fallback — `Turn text into natural-sounding speech...`.
- После перехода должен быть выбран radio `Composer`.

## Поля одного вопроса

- `textbox "Scene"` — только инструкция о манере подачи. Сюда нельзя вставлять browser-команды или HTML с frontend.
- `textbox "Sample Context"` — для MVP остаётся пустым.
- `textbox "Speech block text"` — только точный текст одного вопроса.
- `button "Speaker 1 - <voice_id>"` — открывает параметры спикера.
- `button "Run Ctrl"` — запускает одну генерацию.

После заполнения runner должен повторно прочитать snapshot и проверить, что `Scene`, `Speech block text` и `Speaker 1 - <voice_id>` отражают ожидаемые значения.

## Speaker settings

- Панель: `generic "Speaker settings Close panel"`.
- Свободное описание: `textbox "Describe the voice persona (e.g., warm, energetic, professional)"`.
- `button "Style"` со значениями:
  - `Vocal Smile`;
  - `Newscaster`;
  - `Whisper`;
  - `Empathetic`;
  - `Promo/Hype`;
  - `Deadpan`.
- `button "Pace"` со значениями:
  - `Natural`;
  - `Rapid Fire`;
  - `The Drift`;
  - `Staccato`.
- `button "Accent"`; для русского MVP использовать `Neutral`.
- Поиск голоса: `textbox "Search voices"`.
- Точное совпадение: `button "<voice_id>"`, после выбора — `button "<voice_id> (Current)"`.
- Preview: `button "Play/Pause voice sample"`.
- Закрытие: `button "Close panel"`.

В текущем UI подтверждено наличие всего curated allowlist: `Kore`, `Aoede`, `Leda`, `Zephyr`, `Puck`, `Charon`, `Fenrir`, `Orus`. Видимые признаки включают `Kore — Firm, Middle pitch`, `Aoede — Breezy, Middle pitch`, `Charon — Informative, Lower pitch`, `Fenrir — Excitable, Lower middle pitch`, `Zephyr — Bright, Higher pitch`. AI Studio не показывает пол голоса; `male/female` в Quiz App остаётся только ручной презентационной категорией.

## Надпись API key

`No API key selected` не является надёжным признаком блокировки. На проверенной странице эта надпись одновременно отображалась с активными `Play` и `Download`, а ручной `Run` успешно создал WAV. Поэтому runner не останавливается по одной этой надписи.

Если после нажатия `Run` действительно открылся dialog настройки, его можно распознать по элементам:

- step `Choose project and API key`;
- combobox `Project`;
- input `Name your key`;
- button `Create key and link`;
- step `Set up billing`;
- step `Link API key`.

Runner не создаёт ключ, не включает billing и не читает значение ключа. `api_key_required` возвращается только если dialog с этими элементами реально открылся после `Run`.

## Результат и Download

В Composer подтверждены `button "Play"` и `button "Download"`; до генерации оба имеют состояние `disabled`. Успешная ручная генерация создала `<audio>` с `data:audio/wav;base64,...`, длительностью 4,08 секунды, `readyState = 4` и активной кнопкой `Download`.

Runner после `Run` ждёт до четырёх минут. Результат считается полным только при одновременном выполнении условий: источник новый относительно исходного, имеет тип `data:` или `blob:`, длительность больше нуля, `readyState = 4`, кнопка `Download` активна, а сигнатура источника стабильна в двух последовательных проверках. После этого браузерный источник декодируется и сохраняется напрямую в task directory без просмотра общей папки Downloads.

Кнопку `Run Ctrl` нужно нажимать целиком; внутренний `<span>Ctrl</span>` — только подсказка горячей клавиши. DOM/Playwright click на проверенной странице приводил к HTTP 403, тогда как координатный mouse down/up по центру bounding box дал HTTP 200 и новый WAV. Поэтому runner использует pointer input и при первом 403 повторяет его один раз через 20 секунд.

Ответ Google с toast `http status code: 403` после двух попыток является ошибкой `generation_forbidden`. Источник `https://www.gstatic.com/aistudio/tts/trivia.wav`, который появляется при этой ошибке, служебный и не может считаться сгенерированной озвучкой. Успешно сохранён и проверен WAV длительностью 4,16 секунды; автоматический upload в API остаётся отдельным следующим smoke-шагом.
