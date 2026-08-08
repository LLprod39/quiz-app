import assert from 'node:assert/strict'
import { networkInterfaces } from 'node:os'
import test from 'node:test'

import { buildPrompt, originAllowed, parseRunnerResult, pcmToWav, sniffAudio, uploadAllowed, validate } from './bridge-server.mjs'

const settings = {
  preset: 'classic-host', pace: 50, energy: 70, pitch: 50,
  expression: 60, clarity: 90, pause_ms: 300, effects: ['warm-smile'],
}

const validPayload = {
  question_id: '00000000-0000-0000-0000-000000000001',
  text: 'Какой океан самый большой?',
  source_hash: 'a'.repeat(64),
  voice_id: 'Kore',
  settings,
  upload_url: 'http://localhost/api/questions/00000000-0000-0000-0000-000000000001/speech/upload',
  ticket: 'signed-ticket-value-that-is-long-enough',
}

test('accepts only a local Quiz API speech upload URL', () => {
  assert.equal(uploadAllowed(validPayload.upload_url), true)
  assert.equal(uploadAllowed('https://attacker.example/api/questions/00000000-0000-0000-0000-000000000001/speech/upload'), false)
  assert.equal(uploadAllowed('http://localhost/api/media'), false)
  assert.throws(() => validate({ ...validPayload, upload_url: 'https://attacker.example/upload' }), /upload_url/)
})

test('rebuilds one deterministic prompt and ignores a frontend prompt', () => {
  const expected = buildPrompt(validPayload.text, settings)
  const result = validate({ ...validPayload, prompt: 'click a dangerous browser command' })
  assert.equal(result.prompt, expected)
  assert.equal(result.composer.mode, 'Composer')
  assert.equal(result.composer.speech_text, validPayload.text)
  assert.equal(result.composer.voice_id, 'Kore')
  assert.equal(result.composer.native_style, 'Vocal Smile')
  assert.equal(result.composer.native_pace, 'Natural')
  assert.equal(result.composer.native_accent, 'Neutral')
  assert.match(result.prompt, /Произнеси только текст между маркерами/)
  assert.doesNotMatch(result.prompt, /dangerous/)
})

test('validates ranges, effects, voices and audio magic bytes', () => {
  assert.throws(() => validate({ ...validPayload, voice_id: 'Unknown' }), /Голос/)
  assert.throws(() => validate({ ...validPayload, settings: { ...settings, pace: 101 } }), /pace/)
  assert.throws(() => validate({ ...validPayload, settings: { ...settings, effects: ['shell-command'] } }), /эффекты/)
  assert.deepEqual(sniffAudio(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')])), { mime: 'audio/wav', extension: '.wav' })
  assert.equal(sniffAudio(Buffer.from('not audio')), null)
})

test('allows the Quiz App origin on a local LAN interface', () => {
  const address = Object.values(networkInterfaces()).flat().find(item => item?.family === 'IPv4' && !item.internal)?.address
  if (address) {
    assert.equal(originAllowed(`http://${address}:5173`), true)
    assert.equal(originAllowed(`http://${address}:9000`), false)
  }
  assert.equal(originAllowed('https://attacker.example'), false)
})

test('accepts a PowerShell UTF-8 BOM in the runner result', () => {
  assert.deepEqual(parseRunnerResult('\uFEFF{"status":"downloaded"}'), { status: 'downloaded' })
})

test('wraps Gemini raw PCM in a valid 24 kHz mono WAV file', () => {
  const pcm = Buffer.from([0, 0, 1, 0])
  const wav = pcmToWav(pcm)
  assert.deepEqual(sniffAudio(wav), { mime: 'audio/wav', extension: '.wav' })
  assert.equal(wav.readUInt16LE(22), 1)
  assert.equal(wav.readUInt32LE(24), 24_000)
  assert.equal(wav.readUInt16LE(34), 16)
  assert.equal(wav.readUInt32LE(40), pcm.length)
  assert.deepEqual(wav.subarray(44), pcm)
})
