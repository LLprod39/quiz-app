param([string]$Output = ".\quiz-backup.dump", [string]$ComposeFile = "infra/compose.lan.yml")
docker compose -f $ComposeFile exec -T db pg_dump -Fc -U $env:POSTGRES_USER $env:POSTGRES_DB | Set-Content -Encoding Byte -LiteralPath $Output
Write-Host "Резервная копия сохранена: $Output"
