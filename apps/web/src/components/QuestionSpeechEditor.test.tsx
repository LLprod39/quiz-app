import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, checkLocalSpeechBridge, runLocalSpeechBridge } from '../lib/api'
import type { EventData, Question, QuestionSpeech } from '../types'
import { QuestionSpeechEditor } from './QuestionSpeechEditor'

vi.mock('../lib/api', () => ({
  api: {
    speechMvpConfig: vi.fn(), questionSpeech: vi.fn(), updateQuestionSpeechDefaults: vi.fn(),
    speechTicket: vi.fn(), updateSpeechDefaults: vi.fn(), activateSpeech: vi.fn(),
    restoreSpeech: vi.fn(), deleteSpeech: vi.fn(),
  },
  checkLocalSpeechBridge: vi.fn(),
  runLocalSpeechBridge: vi.fn(),
}))

const style = {
  preset: 'classic-host' as const, pace: 50, energy: 70, pitch: 50,
  expression: 60, clarity: 90, pause_ms: 300, effects: ['warm-smile'],
}
const speech: QuestionSpeech = {
  active: null, candidate: null, previous: null, versions: [], stale: false,
  uses_event_defaults: true, effective_settings: { voice_id: 'Kore', settings: style },
}
const question: Question = {
  id: '00000000-0000-0000-0000-000000000001', round_title: 'Раунд 1', type: 'single',
  text: 'Какой океан самый большой?', time_limit_seconds: 30, options: [], speech,
}
const event = {
  id: 'event-1', speech_settings: { voice_id: 'Kore', settings: style },
  theme: { accent: '#ff6b6b' }, rounds: [], sessions: [],
} as unknown as EventData

describe('QuestionSpeechEditor', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.speechMvpConfig).mockResolvedValue({
      bridge_url: 'http://127.0.0.1:8766', prompt_version: 1,
      voices: [
        { id: 'Kore', label: 'Женский · уверенный', presentation: 'female', description: 'Уверенная' },
        { id: 'Puck', label: 'Мужской · энергичный', presentation: 'male', description: 'Энергичный' },
      ],
      presets: {
        'classic-host': { label: 'Классический ведущий', voice_id: 'Kore', ...style },
        'energetic-battle': { label: 'Энергичный баттл', voice_id: 'Puck', pace: 68, energy: 92, pitch: 58, expression: 78, clarity: 88, pause_ms: 180, effects: ['quiz-host', 'emphasize'] },
        custom: { label: 'Свои настройки' },
      },
      defaults: { voice_id: 'Kore', settings: style },
    })
    vi.mocked(api.questionSpeech).mockResolvedValue(speech)
    vi.mocked(api.updateQuestionSpeechDefaults).mockResolvedValue(speech)
    vi.mocked(checkLocalSpeechBridge).mockResolvedValue({
      status: 'ready', agent_browser: 'installed', chrome: 'stopped', ai_studio: 'unknown', busy: false, stage: 'idle',
    })
    vi.mocked(api.speechTicket).mockResolvedValue({
      status: 'ready', question_id: question.id, text: question.text, source_hash: 'a'.repeat(64),
      voice_id: 'Puck', voice_presentation: 'male', settings: { ...style, preset: 'energetic-battle' },
      ticket: 'signed-ticket-value-that-is-long-enough', upload_path: `/api/questions/${question.id}/speech/upload`,
    })
  })

  it('filters voices, applies a preset and blocks a second generation click', async () => {
    let finishBridge!: () => void
    vi.mocked(runLocalSpeechBridge).mockImplementation(() => new Promise(resolve => { finishBridge = () => resolve({ status: 'uploaded' }) }))
    const onChanged = vi.fn()
    const { container } = render(<QuestionSpeechEditor event={event} question={question} onChanged={onChanged} />)

    const voiceSelect = await screen.findByLabelText('Голос')
    fireEvent.click(screen.getByRole('button', { name: 'Мужские' }))
    expect(voiceSelect).toHaveValue('Puck')

    fireEvent.change(screen.getByLabelText('Пресет'), { target: { value: 'energetic-battle' } })
    expect(voiceSelect).toHaveValue('Puck')
    const sliders = container.querySelectorAll<HTMLInputElement>('.speech-sliders input[type="range"]')
    expect(sliders[0]).toHaveValue('68')
    expect(sliders[1]).toHaveValue('92')
    expect(screen.getByLabelText('Подача ведущего')).toBeChecked()

    const generate = screen.getByRole('button', { name: /Озвучить через AI Studio/ })
    fireEvent.click(generate)
    await waitFor(() => expect(runLocalSpeechBridge).toHaveBeenCalledTimes(1))
    expect(generate).toBeDisabled()
    fireEvent.click(generate)
    expect(runLocalSpeechBridge).toHaveBeenCalledTimes(1)
    finishBridge()
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('checks the local bridge and explains lazy Chrome startup', async () => {
    render(<QuestionSpeechEditor event={event} question={question} onChanged={vi.fn()} />)
    await screen.findByLabelText('Голос')
    fireEvent.click(screen.getByRole('button', { name: 'Проверить bridge' }))
    await screen.findByText('Bridge готов. Отдельный Chrome запустится автоматически при озвучивании.')
    expect(checkLocalSpeechBridge).toHaveBeenCalledWith('http://127.0.0.1:8766')
  })
})
