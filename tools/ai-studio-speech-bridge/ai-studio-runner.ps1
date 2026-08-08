param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$sessionName = 'quiz-ai-studio'
$speechUrl = 'https://aistudio.google.com/generate-speech'
$agentErrorPath = Join-Path $env:TEMP "quiz-ai-studio-agent-browser-$PID.log"
$agentTracePath = Join-Path $env:TEMP "quiz-ai-studio-runner-$PID.trace"

function Invoke-AgentBrowser {
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string[]]$CommandArgs)

  $allArgs = @('--session', $sessionName) + $CommandArgs + @('--json')
  if ($env:QUIZ_SPEECH_DEBUG -eq '1') {
    $safeCommand = if ($CommandArgs[0] -eq 'fill') { "fill $($CommandArgs[1]) [redacted]" } else { $CommandArgs -join ' ' }
    [System.IO.File]::AppendAllText($agentTracePath, "START $safeCommand`r`n")
  }
  [System.IO.File]::WriteAllText($agentErrorPath, '')
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $rawLines = @(& agent-browser @allArgs 2> $agentErrorPath)
    $agentExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  $raw = ($rawLines | Out-String).Trim()
  $agentError = [System.IO.File]::ReadAllText($agentErrorPath).Trim()
  if ($env:QUIZ_SPEECH_DEBUG -eq '1') {
    [System.IO.File]::AppendAllText($agentTracePath, "EXIT $agentExitCode`r`n")
  }
  if ($agentExitCode -ne 0) {
    throw "agent_browser_failed: $($CommandArgs[0]) exited with code $agentExitCode; $agentError $raw"
  }
  $jsonLine = $rawLines | Where-Object { [string]$_ -match '^\s*\{' } | Select-Object -Last 1
  if ($jsonLine) { $raw = [string]$jsonLine }
  try {
    $result = $raw | ConvertFrom-Json
  } catch {
    throw "agent_browser_invalid_json: $($CommandArgs[0]) returned an unexpected response"
  }
  if (-not $result.success) {
    $detail = if ($result.error) { [string]$result.error } else { 'unknown error' }
    throw "agent_browser_failed: $detail"
  }
  if ($env:QUIZ_SPEECH_DEBUG -eq '1' -and $null -ne $result.data.result) {
    $resultSummary = [string]$result.data.result
    if ($resultSummary.Length -gt 500) { $resultSummary = $resultSummary.Substring(0, 500) + "... [length=$($resultSummary.Length)]" }
    [System.IO.File]::AppendAllText($agentTracePath, "RESULT $resultSummary`r`n")
  }
  return $result.data
}

function Get-Snapshot {
  return Invoke-AgentBrowser -CommandArgs @('snapshot', '-i', '-c')
}

function Find-Ref {
  param(
    [Parameter(Mandatory = $true)]$Snapshot,
    [Parameter(Mandatory = $true)][string]$Role,
    [Parameter(Mandatory = $true)][string]$Name,
    [ValidateSet('exact', 'prefix', 'regex')][string]$Mode = 'exact'
  )

  foreach ($property in $Snapshot.refs.PSObject.Properties) {
    $item = $property.Value
    if ([string]$item.role -ne $Role) { continue }
    $candidate = [string]$item.name
    $matches = switch ($Mode) {
      'exact' { $candidate -ceq $Name }
      'prefix' { $candidate.StartsWith($Name, [System.StringComparison]::Ordinal) }
      'regex' { $candidate -match $Name }
    }
    if ($matches) { return [string]$property.Name }
  }
  return $null
}

function Invoke-RefAction {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('click', 'fill')][string]$Action,
    [Parameter(Mandatory = $true)][string]$Ref,
    [string]$Value = ''
  )
  $selector = "@$Ref"
  if ($Action -eq 'fill') {
    Invoke-AgentBrowser -CommandArgs @('fill', $selector, $Value) | Out-Null
  } else {
    Invoke-AgentBrowser -CommandArgs @('click', $selector) | Out-Null
  }
}

function Invoke-PointerRefClick {
  param([Parameter(Mandatory = $true)][string]$Ref)

  $selector = "@$Ref"
  $box = Invoke-AgentBrowser -CommandArgs @('get', 'box', $selector)
  if ($null -eq $box.x -or $null -eq $box.y -or $null -eq $box.width -or $null -eq $box.height) {
    throw "page_changed: bounding box for $selector was not available"
  }
  $centerX = [Math]::Round([double]$box.x + ([double]$box.width / 2))
  $centerY = [Math]::Round([double]$box.y + ([double]$box.height / 2))
  Invoke-AgentBrowser -CommandArgs @('mouse', 'move', [string]$centerX, [string]$centerY) | Out-Null
  Invoke-AgentBrowser -CommandArgs @('mouse', 'down', 'left') | Out-Null
  Start-Sleep -Milliseconds 120
  Invoke-AgentBrowser -CommandArgs @('mouse', 'up', 'left') | Out-Null
}

function Invoke-AriaButtonClick {
  param([Parameter(Mandatory = $true)][string]$Name)
  $escapedName = $Name.Replace('\', '\\').Replace("'", "\'")
  $script = "(() => { const expected = '$escapedName'; const buttons = Array.from(document.querySelectorAll('button[aria-label]')); const target = buttons.find(item => item.offsetParent !== null && item.getAttribute('aria-label') === expected); if (!target) return false; target.click(); return true; })()"
  $clicked = Invoke-AgentBrowser -CommandArgs @('eval', $script)
  if (-not $clicked.result) { throw "page_changed: aria button $Name could not be clicked" }
}

function Wait-ForRef {
  param(
    [Parameter(Mandatory = $true)][string]$Role,
    [Parameter(Mandatory = $true)][string]$Name,
    [ValidateSet('exact', 'prefix', 'regex')][string]$Mode = 'exact',
    [int]$Attempts = 160
  )
  for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
    $snapshot = Get-Snapshot
    $ref = Find-Ref -Snapshot $snapshot -Role $Role -Name $Name -Mode $Mode
    if ($ref) {
      return [pscustomobject]@{ Snapshot = $snapshot; Ref = $ref }
    }
    Start-Sleep -Milliseconds 250
  }
  throw "page_changed: $Role '$Name' did not appear"
}

function Test-RefDisabled {
  param(
    [Parameter(Mandatory = $true)]$Snapshot,
    [Parameter(Mandatory = $true)][string]$Ref
  )
  foreach ($line in ([string]$Snapshot.snapshot -split "`r?`n")) {
    if ($line.Contains("ref=$Ref") -and $line.Contains('disabled')) { return $true }
  }
  return $false
}

function Get-AudioState {
  $script = "(() => { const audio = document.querySelector('audio'); const source = audio ? (audio.currentSrc || audio.src || '') : ''; let hash = 2166136261; for (let i = 0; i < source.length; i++) { hash ^= source.charCodeAt(i); hash = Math.imul(hash, 16777619); } const notices = Array.from(document.querySelectorAll('[role=alert], mat-snack-bar-container, .mat-mdc-snack-bar-label')).map(item => (item.textContent || '').trim()); const error = notices.find(text => /http response|http status code|generation failed|something went wrong/i.test(text)) || ''; const sourceKind = source.startsWith('data:audio/') ? 'data' : source.startsWith('blob:') ? 'blob' : source ? 'other' : 'none'; return { length: source.length, hash: (hash >>> 0).toString(16), duration: audio && Number.isFinite(audio.duration) ? audio.duration : 0, readyState: audio ? audio.readyState : 0, sourceKind, error }; })()"
  return Invoke-AgentBrowser -CommandArgs @('eval', $script)
}

function Get-AudioDataUri {
  $script = "(async () => { const audio = document.querySelector('audio'); const source = audio ? (audio.currentSrc || audio.src || '') : ''; if (source.startsWith('data:audio/')) return source; if (!source.startsWith('blob:')) return ''; const blob = await fetch(source).then(response => response.blob()); return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }); })()"
  return Invoke-AgentBrowser -CommandArgs @('eval', $script)
}

function Select-MenuValue {
  param(
    [Parameter(Mandatory = $true)][string]$ButtonName,
    [Parameter(Mandatory = $true)][string]$Value
  )
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    $snapshot = Get-Snapshot
    $buttonRef = Find-Ref -Snapshot $snapshot -Role 'button' -Name $ButtonName
    if (-not $buttonRef) { throw "page_changed: button $ButtonName was not found" }
    $itemRef = Find-Ref -Snapshot $snapshot -Role 'menuitem' -Name $Value
    if (-not $itemRef) { $itemRef = Find-Ref -Snapshot $snapshot -Role 'menuitem' -Name "$Value " -Mode prefix }
    if (-not $itemRef) {
      $escapedButton = $ButtonName.Replace('\', '\\').Replace("'", "\'")
      $openScript = "(() => { const expected = '$escapedButton'; const buttons = Array.from(document.querySelectorAll('button[aria-label]')); const target = buttons.find(item => item.offsetParent !== null && item.getAttribute('aria-label') === expected); if (!target) return false; target.click(); return true; })()"
      $opened = Invoke-AgentBrowser -CommandArgs @('eval', $openScript)
      if (-not $opened.result) { continue }
      for ($menuWait = 0; $menuWait -lt 20; $menuWait++) {
        Start-Sleep -Milliseconds 250
        $snapshot = Get-Snapshot
        $itemRef = Find-Ref -Snapshot $snapshot -Role 'menuitem' -Name $Value
        if (-not $itemRef) { $itemRef = Find-Ref -Snapshot $snapshot -Role 'menuitem' -Name "$Value " -Mode prefix }
        if ($itemRef) { break }
      }
    }
    if (-not $itemRef) { continue }
    $escapedValue = $Value.Replace('\', '\\').Replace("'", "\'")
    $evalScript = "(() => { const expected = '$escapedValue'; const items = Array.from(document.querySelectorAll('[role=menuitem]')); const target = items.find(item => (item.textContent || '').trim().startsWith(expected)); if (!target) return false; target.click(); return true; })()"
    $clicked = Invoke-AgentBrowser -CommandArgs @('eval', $evalScript)
    if (-not $clicked.result) { continue }
    Invoke-AgentBrowser -CommandArgs @('wait', '700') | Out-Null
    return
  }
  throw "page_changed: value $Value was not applied for $ButtonName"
}

function Test-CdpReady {
  try {
    $version = Invoke-RestMethod -Uri 'http://127.0.0.1:9223/json/version' -TimeoutSec 1
    return [bool]$version.webSocketDebuggerUrl
  } catch {
    return $false
  }
}

function Save-FailureEvidence {
  param([Parameter(Mandatory = $true)][string]$TaskDir)
  try {
    $snapshot = Get-Snapshot
    $snapshot.snapshot | Set-Content -LiteralPath (Join-Path $TaskDir 'failure-snapshot.txt') -Encoding utf8
  } catch { }
  try {
    & agent-browser --session $sessionName screenshot (Join-Path $TaskDir 'failure-screenshot.png') *> $null
  } catch { }
}

try {
  if (-not (Get-Command agent-browser -ErrorAction SilentlyContinue)) {
    throw 'agent_browser_missing: run npm i -g agent-browser and then agent-browser install'
  }
  if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) { throw 'invalid_task: input.json was not found' }

  $task = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $taskDir = [System.IO.Path]::GetFullPath([string]$task.task_dir)
  $resolvedInput = [System.IO.Path]::GetFullPath($InputPath)
  $resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
  $taskPrefix = $taskDir.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $resolvedInput.StartsWith($taskPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'invalid_task: input is outside task directory' }
  if (-not $resolvedOutput.StartsWith($taskPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'invalid_task: output is outside task directory' }
  if (-not $task.composer -or $task.composer.mode -ne 'Composer') { throw 'invalid_task: Composer contract is missing' }

  if (-not (Test-CdpReady)) {
    & (Join-Path $PSScriptRoot 'start-chrome.ps1')
  }
  if (-not (Test-CdpReady)) { throw 'chrome_not_connected: CDP 127.0.0.1:9223 is unavailable' }

  Invoke-AgentBrowser -CommandArgs @('connect', 'http://127.0.0.1:9223') | Out-Null
  $tabs = Invoke-AgentBrowser -CommandArgs @('tab', 'list')
  $speechTab = @($tabs.tabs) | Where-Object {
    try {
      $tabUri = [Uri][string]$_.url
      $tabUri.Host -eq 'aistudio.google.com' -and $tabUri.AbsolutePath -eq '/generate-speech'
    } catch { $false }
  } | Select-Object -First 1
  if ($speechTab) {
    Invoke-AgentBrowser -CommandArgs @('tab', [string]$speechTab.tabId) | Out-Null
  } else {
    Invoke-AgentBrowser -CommandArgs @('tab', 'new', $speechUrl) | Out-Null
  }
  Invoke-AgentBrowser -CommandArgs @('wait', '--load', 'networkidle') | Out-Null

  $page = Invoke-AgentBrowser -CommandArgs @('get', 'url')
  $uri = [Uri][string]$page.url
  if ($uri.Host -eq 'accounts.google.com') { throw 'login_required: sign in to Google manually in the opened Chrome window' }
  if ($uri.Host -ne 'aistudio.google.com') { throw "page_changed: unexpected host $($uri.Host)" }

  $snapshot = Get-Snapshot
  if ($snapshot.snapshot -match '(?i)captcha|security check') {
    throw 'captcha_or_security_check: complete the Google check manually'
  }

  $openMenuRef = Find-Ref -Snapshot $snapshot -Role 'menuitem' -Name '.+' -Mode regex
  if ($openMenuRef) {
    Invoke-AgentBrowser -CommandArgs @('press', 'Escape') | Out-Null
    for ($dismissWait = 0; $dismissWait -lt 20; $dismissWait++) {
      Start-Sleep -Milliseconds 250
      $snapshot = Get-Snapshot
      $openMenuRef = Find-Ref -Snapshot $snapshot -Role 'menuitem' -Name '.+' -Mode regex
      if (-not $openMenuRef) { break }
    }
    if ($openMenuRef) { throw 'page_changed: an old menu overlay could not be dismissed' }
  }

  $tourRef = Find-Ref -Snapshot $snapshot -Role 'button' -Name 'Close guided tour'
  if ($tourRef) {
    Invoke-RefAction -Action click -Ref $tourRef
    $snapshot = Get-Snapshot
  }

  $stalePanelRef = Find-Ref -Snapshot $snapshot -Role 'button' -Name 'Close panel'
  if ($stalePanelRef) {
    Invoke-AriaButtonClick -Name 'Close panel'
    $composerAfterPanel = Wait-ForRef -Role 'textbox' -Name 'Scene' -Attempts 60
    $snapshot = $composerAfterPanel.Snapshot
  }

  $sceneRef = Find-Ref -Snapshot $snapshot -Role 'textbox' -Name 'Scene'
  if (-not $sceneRef) {
    $templateName = 'The Game Show Host - A vibrant and theatrical host.'
    $entryRef = Find-Ref -Snapshot $snapshot -Role 'button' -Name $templateName
    $entryName = if ($entryRef) { $templateName } else { 'Turn text into natural-sounding speech...' }
    if (-not $entryRef) {
      $entryRef = Find-Ref -Snapshot $snapshot -Role 'button' -Name $entryName
    }
    if (-not $entryRef) { throw 'page_changed: Speech Composer entry was not found' }
    $composerReady = $null
    for ($entryAttempt = 0; $entryAttempt -lt 3; $entryAttempt++) {
      Invoke-AgentBrowser -CommandArgs @('find', 'role', 'button', 'click', '--name', $entryName, '--exact') | Out-Null
      try {
        $composerReady = Wait-ForRef -Role 'textbox' -Name 'Speech block text' -Attempts 30
        break
      } catch {
        if ($entryAttempt -ge 2) { throw }
      }
    }
    $snapshot = $composerReady.Snapshot
    $sceneRef = Find-Ref -Snapshot $snapshot -Role 'textbox' -Name 'Scene'
  }

  $contextRef = Find-Ref -Snapshot $snapshot -Role 'textbox' -Name 'Sample Context'
  $speechRef = Find-Ref -Snapshot $snapshot -Role 'textbox' -Name 'Speech block text'
  if (-not $sceneRef -or -not $contextRef -or -not $speechRef) { throw 'page_changed: Scene, Sample Context, or Speech block text was not found' }
  Invoke-RefAction -Action fill -Ref $sceneRef -Value ([string]$task.composer.scene)
  $snapshot = Get-Snapshot
  $contextRef = Find-Ref -Snapshot $snapshot -Role 'textbox' -Name 'Sample Context'
  if (-not $contextRef) { throw 'page_changed: Sample Context disappeared after filling Scene' }
  Invoke-RefAction -Action fill -Ref $contextRef -Value ''
  $snapshot = Get-Snapshot
  $speechRef = Find-Ref -Snapshot $snapshot -Role 'textbox' -Name 'Speech block text'
  if (-not $speechRef) { throw 'page_changed: Speech block text disappeared after filling Scene' }
  Invoke-RefAction -Action fill -Ref $speechRef -Value ([string]$task.composer.speech_text)

  $snapshot = Get-Snapshot
  $speakerRef = Find-Ref -Snapshot $snapshot -Role 'button' -Name '^Speaker 1 - ' -Mode regex
  if (-not $speakerRef) { throw 'page_changed: Speaker 1 button was not found' }
  Invoke-RefAction -Action click -Ref $speakerRef

  $voicePanel = Wait-ForRef -Role 'textbox' -Name 'Search voices' -Attempts 60
  $snapshot = $voicePanel.Snapshot
  $voiceId = [string]$task.composer.voice_id
  $searchRef = Find-Ref -Snapshot $snapshot -Role 'textbox' -Name 'Search voices'
  if (-not $searchRef) { throw 'page_changed: voice search was not found' }
  Invoke-RefAction -Action fill -Ref $searchRef -Value $voiceId
  $snapshot = Get-Snapshot
  $voiceRef = Find-Ref -Snapshot $snapshot -Role 'button' -Name "$voiceId (Current)"
  if (-not $voiceRef) {
    $voiceReady = $null
    for ($voiceAttempt = 0; $voiceAttempt -lt 3; $voiceAttempt++) {
      $snapshot = Get-Snapshot
      $voiceRef = Find-Ref -Snapshot $snapshot -Role 'button' -Name $voiceId
      if (-not $voiceRef) { throw "voice_unavailable: voice $voiceId is absent" }
      Invoke-AgentBrowser -CommandArgs @('find', 'role', 'button', 'click', '--name', $voiceId, '--exact') | Out-Null
      try {
        $voiceReady = Wait-ForRef -Role 'button' -Name "$voiceId (Current)" -Attempts 30
        break
      } catch {
        if ($voiceAttempt -ge 2) { throw "voice_unavailable: AI Studio did not apply voice $voiceId" }
      }
    }
    $snapshot = $voiceReady.Snapshot
  }
  Invoke-AgentBrowser -CommandArgs @('wait', '1500') | Out-Null

  Select-MenuValue -ButtonName 'Style' -Value ([string]$task.composer.native_style)
  Select-MenuValue -ButtonName 'Pace' -Value ([string]$task.composer.native_pace)
  Select-MenuValue -ButtonName 'Accent' -Value ([string]$task.composer.native_accent)

  $snapshot = Get-Snapshot
  $closeRef = Find-Ref -Snapshot $snapshot -Role 'button' -Name 'Close panel'
  if (-not $closeRef) { throw 'page_changed: Close panel was not found' }
  Invoke-AriaButtonClick -Name 'Close panel'

  $composerAfterClose = Wait-ForRef -Role 'button' -Name '^Speaker 1 - ' -Mode regex -Attempts 40
  $snapshot = $composerAfterClose.Snapshot
  $selectedSpeaker = Find-Ref -Snapshot $snapshot -Role 'button' -Name "Speaker 1 - $voiceId"
  if (-not $selectedSpeaker) { throw "voice_unavailable: AI Studio did not confirm voice $voiceId" }
  $runRef = Find-Ref -Snapshot $snapshot -Role 'button' -Name 'Run Ctrl'
  if (-not $runRef) { throw 'page_changed: Run button was not found' }
  if (Test-RefDisabled -Snapshot $snapshot -Ref $runRef) { throw 'generation_unavailable: Run is disabled' }
  $baselineAudio = Get-AudioState
  Invoke-PointerRefClick -Ref $runRef
  $runAttempts = 1
  $retryAfter = $null
  $ignoreForbiddenUntil = (Get-Date).AddSeconds(3)

  $downloadRef = $null
  $completedAudio = $null
  $sawDisabledResult = $false
  $stableAudioSignature = $null
  $stableAudioChecks = 0
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    $snapshot = Get-Snapshot
    if ($retryAfter -and (Get-Date) -ge $retryAfter) {
      $runRef = Find-Ref -Snapshot $snapshot -Role 'button' -Name 'Run Ctrl'
      if (-not $runRef) { throw 'page_changed: Run button was not found for retry' }
      if (Test-RefDisabled -Snapshot $snapshot -Ref $runRef) { throw 'generation_unavailable: Run is disabled for retry' }
      $baselineAudio = Get-AudioState
      Invoke-PointerRefClick -Ref $runRef
      $runAttempts++
      $retryAfter = $null
      # AI Studio can keep the first 403 snackbar visible while the repeated
      # request is already generating successfully. Give that second request
      # enough time to replace the stale audio/error state.
      $ignoreForbiddenUntil = (Get-Date).AddSeconds(90)
      $sawDisabledResult = $false
      $stableAudioSignature = $null
      $stableAudioChecks = 0
      Invoke-AgentBrowser -CommandArgs @('wait', '2000') | Out-Null
      continue
    }
    if ($snapshot.snapshot -match '(?i)quota|billing required|generation failed|something went wrong') {
      throw 'generation_failed: AI Studio reported a generation or quota error'
    }
    if ($snapshot.snapshot -match '(?i)Choose project and API key|Create key and link|Set up billing') {
      throw 'api_key_required: AI Studio opened the key selection dialog after Run'
    }
    $downloadRef = Find-Ref -Snapshot $snapshot -Role 'button' -Name '(?i)^download' -Mode regex
    if (-not $downloadRef) {
      $downloadRef = Find-Ref -Snapshot $snapshot -Role 'link' -Name '(?i)^download' -Mode regex
    }
    if ($downloadRef -and (Test-RefDisabled -Snapshot $snapshot -Ref $downloadRef)) {
      $sawDisabledResult = $true
      $downloadRef = $null
    }
    $audioState = Get-AudioState
    if ([string]$audioState.result.error) {
      if ([string]$audioState.result.error -match '(?i)status code:\s*403') {
        if ((Get-Date) -lt $ignoreForbiddenUntil) {
          Invoke-AgentBrowser -CommandArgs @('wait', '2000') | Out-Null
          continue
        }
        if ($runAttempts -lt 2 -and -not $retryAfter) {
          $retryAfter = (Get-Date).AddSeconds(3)
          $downloadRef = $null
          Invoke-AgentBrowser -CommandArgs @('wait', '2000') | Out-Null
          continue
        }
        if ($runAttempts -ge 2) {
          throw 'generation_forbidden: AI Studio returned HTTP 403 after two coordinate Run attempts'
        }
        $downloadRef = $null
        Invoke-AgentBrowser -CommandArgs @('wait', '2000') | Out-Null
        continue
      }
      throw "generation_failed: $([string]$audioState.result.error)"
    }
    $audioChanged = $audioState.result.length -gt 32 -and (
      $sawDisabledResult -or
      $audioState.result.length -ne $baselineAudio.result.length -or
      $audioState.result.hash -ne $baselineAudio.result.hash
    )
    $audioIsDownloadable = $audioState.result.sourceKind -in @('data', 'blob')
    $audioIsComplete = $downloadRef -and $audioChanged -and $audioIsDownloadable -and $audioState.result.duration -gt 0 -and $audioState.result.readyState -ge 4
    if ($audioIsComplete) {
      $currentSignature = "$($audioState.result.sourceKind):$($audioState.result.length):$($audioState.result.hash):$($audioState.result.duration)"
      if ($currentSignature -eq $stableAudioSignature) {
        $stableAudioChecks++
      } else {
        $stableAudioSignature = $currentSignature
        $stableAudioChecks = 1
      }
      if ($stableAudioChecks -ge 2) {
        $completedAudio = $audioState.result
        break
      }
    } else {
      $stableAudioSignature = $null
      $stableAudioChecks = 0
    }
    $downloadRef = $null
    Invoke-AgentBrowser -CommandArgs @('wait', '2000') | Out-Null
  }
  if (-not $downloadRef -or -not $completedAudio) { throw 'generation_timeout: audio did not fully finish within 4 minutes' }

  $audioData = Get-AudioDataUri
  $dataUri = [string]$audioData.result
  if ($dataUri -notmatch '^data:(audio/[a-zA-Z0-9.+-]+);base64,(.+)$') {
    throw 'download_unavailable: completed audio was not available as a browser data URI'
  }
  $mimeType = [string]$Matches[1]
  try {
    $audioBytes = [Convert]::FromBase64String([string]$Matches[2])
  } catch {
    throw 'invalid_audio: browser returned malformed base64 audio'
  }
  $extension = switch ($mimeType) {
    'audio/wav' { '.wav' }
    'audio/mpeg' { '.mp3' }
    'audio/mp4' { '.m4a' }
    'audio/ogg' { '.ogg' }
    default { '.bin' }
  }
  $downloadPath = Join-Path $taskDir "speech-download$extension"
  [System.IO.File]::WriteAllBytes($downloadPath, $audioBytes)
  if (-not (Test-Path -LiteralPath $downloadPath -PathType Leaf)) { throw 'download_unavailable: no file appeared in the task directory' }
  $downloadFile = Get-Item -LiteralPath $downloadPath
  if ($downloadFile.Length -le 0) { throw 'invalid_audio: downloaded file is empty' }

  @{
    status = 'downloaded'
    downloaded_file = $downloadFile.FullName
    voice_id = $voiceId
  } | ConvertTo-Json | Set-Content -LiteralPath $OutputPath -Encoding utf8
} catch {
  $failureMessage = $_.Exception.Message
  $failureTaskDir = $null
  try { $failureTaskDir = [string]$task.task_dir } catch { }
  if ($failureTaskDir -and (Test-Path -LiteralPath $failureTaskDir -PathType Container)) {
    Save-FailureEvidence -TaskDir $failureTaskDir
    [System.IO.File]::WriteAllText((Join-Path $failureTaskDir 'failure-error.txt'), $failureMessage)
  }
  Write-Output $failureMessage
  [Console]::Error.WriteLine($failureMessage)
  exit 1
}
