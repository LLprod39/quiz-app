$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $bridgeRoot '..\..'))
$envFile = Join-Path $projectRoot '.env'
if (-not $env:GEMINI_API_KEY -and (Test-Path -LiteralPath $envFile -PathType Leaf)) {
  $keyLine = Get-Content -LiteralPath $envFile -Encoding UTF8 | Where-Object { $_ -match '^\s*GEMINI_API_KEY\s*=' } | Select-Object -Last 1
  if ($keyLine) {
    $keyValue = ($keyLine -replace '^\s*GEMINI_API_KEY\s*=\s*', '').Trim()
    if (($keyValue.StartsWith('"') -and $keyValue.EndsWith('"')) -or ($keyValue.StartsWith("'") -and $keyValue.EndsWith("'"))) {
      $keyValue = $keyValue.Substring(1, $keyValue.Length - 2)
    }
    if ($keyValue) { $env:GEMINI_API_KEY = $keyValue }
  }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js was not found.' }
Set-Location -LiteralPath $bridgeRoot
& node (Join-Path $bridgeRoot 'bridge-server.mjs')
