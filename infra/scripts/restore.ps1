param([Parameter(Mandatory=$true)][string]$Input, [string]$ComposeFile = "infra/compose.lan.yml")
Get-Content -Encoding Byte -Raw -LiteralPath $Input | docker compose -f $ComposeFile exec -T db pg_restore --clean --if-exists -U $env:POSTGRES_USER -d $env:POSTGRES_DB
Write-Host "Резервная копия восстановлена: $Input"
