param([switch]$ShowWindow)

$ErrorActionPreference = 'Stop'
$profilePath = Join-Path $env:LOCALAPPDATA 'QuizApp\ai-studio-profile'
New-Item -ItemType Directory -Force -Path $profilePath | Out-Null

$candidates = @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$registryPaths = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe'
)
foreach ($registryPath in $registryPaths) {
  try {
    $registeredChrome = (Get-ItemProperty -LiteralPath $registryPath -ErrorAction Stop).'(default)'
    if ($registeredChrome) { $candidates += $registeredChrome }
  } catch { }
}
$chromePath = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $chromePath) { throw 'Google Chrome was not found in standard Windows locations.' }

$arguments = @(
  '--remote-debugging-address=127.0.0.1',
  '--remote-debugging-port=9223',
  "--user-data-dir=$profilePath",
  '--no-first-run',
  '--no-default-browser-check'
)
if (-not $ShowWindow) { $arguments += '--start-minimized' }
$arguments += 'https://aistudio.google.com/generate-speech'

Start-Process -FilePath $chromePath -ArgumentList $arguments
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  try {
    $version = Invoke-RestMethod -Uri 'http://127.0.0.1:9223/json/version' -TimeoutSec 1
    if ($version.webSocketDebuggerUrl) { return }
  } catch { Start-Sleep -Milliseconds 500 }
}
throw 'Chrome started, but CDP 127.0.0.1:9223 did not become available.'
