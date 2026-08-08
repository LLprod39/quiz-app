$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js was not found.' }
Set-Location -LiteralPath $bridgeRoot
& node (Join-Path $bridgeRoot 'bridge-server.mjs')
