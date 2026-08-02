# Quiz App

Интерактивная праздничная викторина: организатор управляет игрой с телефона, гости отвечают без регистрации, а телевизор показывает общий игровой экран.

## Быстрый запуск для разработки

Требуются Node.js 20+ и Python 3.12+.

```powershell
cd apps/api
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\uvicorn app.main:app --reload --port 8000
```

Во втором окне:

```powershell
npm install
npm run dev
```

Откройте `http://localhost:5173`. Демо-вход организатора: `organizer@example.local` / `celebrate`.

При первом запуске API создаёт демонстрационное мероприятие «Вечер в честь Лены» и три вопроса. В панели организатора можно изменить мероприятие, анкету и вопросы без правки кода.

## Запуск в локальной сети без интернета

```powershell
docker compose -f infra/compose.lan.yml up --build
```

Приложение откроется на `http://<IP-ноутбука>`. Все устройства должны быть в одной Wi-Fi сети; на роутере должен быть отключён client isolation.

## Облачный профиль

Скопируйте `infra/env/cloud.example.env` в защищённый `.env`, заполните домен и секреты, затем:

```powershell
docker compose --env-file .env -f infra/compose.cloud.yml up --build -d
```

Для публичного запуска TLS должен завершаться перед Nginx (например, в облачном балансировщике или Caddy). Подробности: [docs/deployment.md](docs/deployment.md).

## Проверки

```powershell
npm test
npm run build
cd apps/api
pytest
```

API документация доступна на `http://localhost:8000/docs`, healthcheck — `/api/health`.

## Контрибьютеры

- [TON618 (@DayMoonX)](https://github.com/DayMoonX)

## Лицензия

Проект распространяется по лицензии [MIT](LICENSE).
