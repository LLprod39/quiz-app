$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeScript = Join-Path $projectRoot 'tools\ai-studio-speech-bridge\start-bridge.ps1'

if (-not (Get-Command agent-browser -ErrorAction SilentlyContinue)) {
  Write-Warning 'Install Google AI Studio automation first: npm i -g agent-browser; then agent-browser install'
}

try {
  Invoke-RestMethod -Uri 'http://127.0.0.1:8766/health' -TimeoutSec 1 | Out-Null
} catch {
  Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $bridgeScript
  ) -WindowStyle Hidden
}

$bridgeReady = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  try {
    Invoke-RestMethod -Uri 'http://127.0.0.1:8766/health' -TimeoutSec 1 | Out-Null
    $bridgeReady = $true
    break
  } catch { Start-Sleep -Milliseconds 300 }
}
if (-not $bridgeReady) { throw 'Local speech bridge did not start on 127.0.0.1:8766.' }

Set-Location -LiteralPath $projectRoot
& docker compose -f (Join-Path $projectRoot 'infra\compose.lan.yml') up -d --build
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose did not start Quiz App.' }
Start-Process 'http://localhost/admin'
