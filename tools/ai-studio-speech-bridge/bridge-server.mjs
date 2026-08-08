import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = dirname(fileURLToPath(import.meta.url))
const runner = join(root, 'ai-studio-runner.ps1')
const host = '127.0.0.1'
const port = Number(process.env.QUIZ_SPEECH_BRIDGE_PORT || 8766)
const allowedVoices = new Set(['Kore', 'Aoede', 'Leda', 'Zephyr', 'Puck', 'Charon', 'Fenrir', 'Orus'])
const allowedEffects = new Set(['quiz-host', 'warm-smile', 'suspense', 'dramatic-pause', 'emphasize', 'mysterious', 'final-question'])
const explicitOrigins = new Set((process.env.QUIZ_APP_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean))
let busy = false
let currentStage = 'idle'
const downloadsRoot = join(process.env.LOCALAPPDATA || join(root, 'state'), 'QuizApp', 'speech-downloads')

function originAllowed(value) {
  if (!value) return true
  try {
    const url = new URL(value)
    return explicitOrigins.has(url.origin) || ['localhost', '127.0.0.1'].includes(url.hostname)
  } catch { return false }
}

function uploadAllowed(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && originAllowed(url.origin) && /^\/api\/questions\/[0-9a-f-]+\/speech\/upload$/i.test(url.pathname)
  } catch { return false }
}

function styleLevel(value, low, medium, high) {
  return value <= 33 ? low : value >= 67 ? high : medium
}

function buildPrompt(text, style) {
  const notes = [
    `Темп ${styleLevel(style.pace, 'медленный', 'средний', 'быстрый')}.`,
    `Регистр голоса ${styleLevel(style.pitch, 'более низкий', 'естественный', 'более высокий')}.`,
    `Выразительность ${styleLevel(style.expression, 'сдержанная', 'умеренная', 'театральная')}.`,
    `Дикция ${styleLevel(style.clarity, 'естественная', 'чёткая', 'максимально чёткая')}.`,
  ]
  if (style.pause_ms >= 800 || style.effects.includes('dramatic-pause')) notes.push('Добавь драматическую паузу перед самим вопросом.')
  else if (style.pause_ms >= 250) notes.push('Добавь короткую паузу перед самим вопросом.')
  if (style.effects.includes('warm-smile')) notes.push('Говори тепло, с лёгкой улыбкой.')
  if (style.effects.includes('suspense')) notes.push('Создай ощущение интриги, не замедляя речь чрезмерно.')
  if (style.effects.includes('mysterious')) notes.push('Используй слегка таинственный тон.')
  if (style.effects.includes('emphasize')) notes.push('Умеренно подчеркни смысловые слова.')
  if (style.effects.includes('final-question')) notes.push('Подай вопрос как важный финальный, но не кричи.')
  const delivery = styleLevel(style.energy, 'спокойная', 'уверенная', 'очень энергичная')
  return `Создай озвучку на русском языке.\nМанера: ${delivery} подача ведущего телевизионной викторины.\n${notes.join(' ')}\nНе добавляй вступление, пояснения, комментарии или новые слова.\nПроизнеси только текст между маркерами.\n\nТЕКСТ ВОПРОСА:\n<<<\n${text}\n>>>`
}

function nativeStyle(style) {
  if (style.effects.includes('final-question') || style.energy >= 80) return 'Promo/Hype'
  if (style.effects.includes('mysterious')) return 'Whisper'
  if (style.effects.includes('warm-smile')) return 'Vocal Smile'
  if (style.expression <= 25) return 'Deadpan'
  if (style.clarity >= 75 || style.effects.includes('quiz-host')) return 'Newscaster'
  return 'Empathetic'
}

function nativePace(style) {
  if (style.pace >= 67) return 'Rapid Fire'
  if (style.pace <= 33) return 'The Drift'
  return 'Natural'
}

function buildScene(style) {
  const prompt = buildPrompt('QUESTION_TEXT_PLACEHOLDER', style)
  return prompt.split('\n\nТЕКСТ ВОПРОСА:')[0]
}

function validate(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Некорректное тело запроса')
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(payload.question_id || '')) throw new Error('Некорректный question_id')
  if (typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 1000) throw new Error('Текст должен содержать от 1 до 1000 символов')
  if (!/^[a-f0-9]{64}$/i.test(payload.source_hash || '')) throw new Error('Некорректный source_hash')
  if (!allowedVoices.has(payload.voice_id)) throw new Error('Голос не входит в разрешённый каталог')
  if (!uploadAllowed(payload.upload_url)) throw new Error('upload_url не принадлежит Quiz App')
  if (typeof payload.ticket !== 'string' || payload.ticket.length < 20 || payload.ticket.length > 8192) throw new Error('Некорректный ticket')
  const settings = payload.settings
  if (!settings || typeof settings !== 'object') throw new Error('Настройки отсутствуют')
  for (const key of ['pace', 'energy', 'pitch', 'expression', 'clarity']) {
    if (!Number.isInteger(settings[key]) || settings[key] < 0 || settings[key] > 100) throw new Error(`Некорректное поле ${key}`)
  }
  if (!Number.isInteger(settings.pause_ms) || settings.pause_ms < 0 || settings.pause_ms > 1500) throw new Error('Некорректная пауза')
  if (!Array.isArray(settings.effects) || settings.effects.some(effect => !allowedEffects.has(effect))) throw new Error('Некорректные эффекты')
  const text = payload.text.trim()
  return {
    ...payload,
    text,
    prompt: buildPrompt(text, settings),
    composer: {
      mode: 'Composer',
      scene: buildScene(settings),
      speech_text: text,
      voice_id: payload.voice_id,
      native_style: nativeStyle(settings),
      native_pace: nativePace(settings),
      native_accent: 'Neutral',
    },
  }
}

async function commandExists(command) {
  try { await execFileAsync('where.exe', [command], { windowsHide: true }); return true } catch { return false }
}

async function chromeStatus() {
  try {
    const response = await fetch('http://127.0.0.1:9223/json/version', { signal: AbortSignal.timeout(700) })
    const body = await response.json()
    return body.webSocketDebuggerUrl ? 'connected' : 'unavailable'
  } catch { return 'stopped' }
}

function json(response, status, body, origin = '') {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': originAllowed(origin) && origin ? origin : 'http://localhost',
    'Vary': 'Origin',
  })
  response.end(JSON.stringify(body))
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 128 * 1024) throw new Error('Запрос слишком большой')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function runPowerShell(inputPath, outputPath) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', runner, '-InputPath', inputPath, '-OutputPath', outputPath], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    const timer = setTimeout(() => { child.kill(); reject(new Error('AI Studio не ответил за 5 минут')) }, 300_000)
    child.on('error', reject)
    child.on('exit', code => {
      clearTimeout(timer)
      if (code === 0) resolvePromise()
      else reject(new Error(stderr.trim() || `Runner завершился с кодом ${code}`))
    })
  })
}

function parseRunnerResult(content) {
  return JSON.parse(String(content).replace(/^\uFEFF/, ''))
}

function sniffAudio(buffer) {
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WAVE') return { mime: 'audio/wav', extension: '.wav' }
  if (buffer.subarray(0, 3).toString() === 'ID3' || (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', extension: '.mp3' }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString() === 'ftyp') return { mime: 'audio/mp4', extension: '.m4a' }
  if (buffer.subarray(0, 4).toString() === 'OggS') return { mime: 'audio/ogg', extension: '.ogg' }
  return null
}

async function generateOne(payload) {
  const taskId = randomUUID()
  const taskDir = join(downloadsRoot, taskId)
  currentStage = 'preparing_task'
  await mkdir(taskDir, { recursive: true })
  const inputPath = join(taskDir, 'input.json')
  const outputPath = join(taskDir, 'output.json')
  let downloaded = false
  let uploaded = false
  try {
    await writeFile(inputPath, JSON.stringify({ ...payload, task_id: taskId, task_dir: taskDir }), 'utf8')
    currentStage = 'browser_automation'
    await runPowerShell(inputPath, outputPath)
    currentStage = 'validating_download'
    const result = parseRunnerResult(await readFile(outputPath, 'utf8'))
    if (!result.downloaded_file) throw new Error(result.detail || 'Runner не вернул аудиофайл')
    const audioPath = resolve(result.downloaded_file)
    const inside = relative(resolve(taskDir), audioPath)
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Runner вернул файл вне каталога задачи')
    const audio = await readFile(audioPath)
    downloaded = true
    if (!audio.length || audio.length > 25 * 1024 * 1024) throw new Error('Скачанный файл пустой или больше 25 МБ')
    const detected = sniffAudio(audio)
    if (!detected) throw new Error('Скачанный файл не является WAV, MP3, M4A или OGG')
    currentStage = 'uploading'
    const form = new FormData()
    form.append('file', new Blob([audio], { type: detected.mime }), `speech${detected.extension}`)
    const upload = await fetch(payload.upload_url, { method: 'POST', headers: { 'X-Speech-Automation-Ticket': payload.ticket }, body: form })
    const uploadBody = await upload.json().catch(() => ({}))
    if (!upload.ok) throw new Error(uploadBody.detail || `Quiz API отклонил файл (${upload.status})`)
    uploaded = true
    currentStage = 'completed'
    return { status: 'uploaded', task_id: taskId, speech: uploadBody }
  } finally {
    await rm(inputPath, { force: true })
    await rm(outputPath, { force: true })
    if (uploaded || !downloaded) await rm(taskDir, { recursive: true, force: true })
  }
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin || ''
  if (!originAllowed(origin)) return json(response, 403, { error: 'origin_forbidden', detail: 'Этот Origin не разрешён' }, origin)
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': origin || 'http://localhost',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Vary': 'Origin',
    })
    return response.end()
  }
  if (request.method === 'GET' && request.url === '/health') {
    const installed = await commandExists('agent-browser')
    return json(response, 200, {
      status: installed ? 'ready' : 'setup_required',
      agent_browser: installed ? 'installed' : 'missing',
      chrome: await chromeStatus(),
      ai_studio: 'unknown',
      busy,
      stage: currentStage,
    }, origin)
  }
  if (request.method !== 'POST' || request.url !== '/generate-one') return json(response, 404, { error: 'not_found' }, origin)
  if (busy) return json(response, 409, { error: 'generation_busy', detail: 'Уже озвучивается другой вопрос' }, origin)
  if (!await commandExists('agent-browser')) return json(response, 503, {
    error: 'agent_browser_missing',
    detail: 'Установите agent-browser: npm i -g agent-browser, затем agent-browser install',
  }, origin)
  busy = true
  currentStage = 'validating'
  try {
    const payload = validate(await readJson(request))
    return json(response, 200, await generateOne(payload), origin)
  } catch (error) {
    return json(response, 500, { error: 'generation_failed', detail: error instanceof Error ? error.message : String(error) }, origin)
  } finally {
    busy = false
    currentStage = 'idle'
  }
})

export { buildPrompt, buildScene, nativePace, nativeStyle, originAllowed, parseRunnerResult, server, sniffAudio, uploadAllowed, validate }

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  server.listen(port, host, () => process.stdout.write(`Quiz speech bridge: http://${host}:${port}\n`))
}
