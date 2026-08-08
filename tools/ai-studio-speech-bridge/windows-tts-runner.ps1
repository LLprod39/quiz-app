param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) {
  throw 'windows_tts_invalid_task: input.json was not found'
}

$task = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
$text = ([string]$task.text).Trim()
if (-not $text) { throw 'windows_tts_invalid_task: question text is empty' }

Add-Type -AssemblyName System.Speech
$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
  $voice = $synth.GetInstalledVoices() | Where-Object {
    $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'ru-RU'
  } | Select-Object -First 1
  if (-not $voice) { throw 'windows_tts_voice_missing: install a Russian Windows speech voice' }

  $synth.SelectVoice($voice.VoiceInfo.Name)
  $pace = [Math]::Max(0, [Math]::Min(100, [int]$task.settings.pace))
  $energy = [Math]::Max(0, [Math]::Min(100, [int]$task.settings.energy))
  $pauseMs = [Math]::Max(0, [Math]::Min(1500, [int]$task.settings.pause_ms))
  $synth.Rate = [Math]::Max(-6, [Math]::Min(6, [Math]::Round(($pace - 50) / 10)))
  $synth.Volume = [Math]::Max(50, [Math]::Min(100, 50 + [Math]::Round($energy / 2)))

  $resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
  $parent = Split-Path -Parent $resolvedOutput
  if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  $synth.SetOutputToWaveFile($resolvedOutput)
  $prompt = [System.Speech.Synthesis.PromptBuilder]::new([Globalization.CultureInfo]::GetCultureInfo('ru-RU'))
  if ($pauseMs -gt 0) { $prompt.AppendBreak([TimeSpan]::FromMilliseconds($pauseMs)) }
  $prompt.AppendText($text)
  $synth.Speak($prompt)
  $synth.SetOutputToNull()

  $audio = Get-Item -LiteralPath $resolvedOutput
  if ($audio.Length -le 44) { throw 'windows_tts_invalid_audio: generated WAV is empty' }
} finally {
  $synth.Dispose()
}
