import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Question } from '../types'
import { QUESTION_SPEECH_STORAGE_KEY, questionSpeechText, selectRussianVoice, useQuestionSpeech } from './questionSpeech'

class MockUtterance {
  text: string
  lang = ''
  rate = 1
  pitch = 1
  volume = 1
  voice: SpeechSynthesisVoice | null = null
  onstart: ((event: SpeechSynthesisEvent) => void) | null = null
  onend: ((event: SpeechSynthesisEvent) => void) | null = null
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null

  constructor(text: string) {
    this.text = text
  }
}

const question = (id: string, text = 'Кто первым полетел в космос?'): Question => ({
  id,
  round_title: 'Космос',
  type: 'single',
  text,
  time_limit_seconds: 30,
  options: [
    { id: 'a', text: 'Юрий Гагарин' },
    { id: 'b', text: 'Нил Армстронг' },
  ],
})

const voice = (name: string, lang: string, localService: boolean, isDefault = false): SpeechSynthesisVoice => ({
  default: isDefault,
  lang,
  localService,
  name,
  voiceURI: name,
})

describe('question speech', () => {
  const speak = vi.fn()
  const cancel = vi.fn()
  const addEventListener = vi.fn()
  const removeEventListener = vi.fn()
  const russianVoice = voice('Microsoft Irina', 'ru-RU', true)

  beforeEach(() => {
    speak.mockReset()
    cancel.mockReset()
    addEventListener.mockReset()
    removeEventListener.mockReset()
    speak.mockImplementation((utterance: MockUtterance) => utterance.onstart?.(new Event('start') as SpeechSynthesisEvent))
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance)
    vi.stubGlobal('speechSynthesis', {
      speak,
      cancel,
      getVoices: () => [voice('English', 'en-US', true, true), russianVoice],
      addEventListener,
      removeEventListener,
    })
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('reads each new question once, selects a local Russian voice and supports repeat', async () => {
    const first = question('q-1')
    const { result, rerender, unmount } = renderHook(
      ({ current }) => useQuestionSpeech({ sessionId: 'session-1', status: 'answering', question: current }),
      { initialProps: { current: first } },
    )

    expect(result.current.enabled).toBe(false)
    act(() => result.current.setEnabled(true))

    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1))
    const firstUtterance = speak.mock.calls[0][0] as MockUtterance
    expect(firstUtterance.text).toBe('Кто первым полетел в космос?')
    expect(firstUtterance.text).not.toContain('Юрий Гагарин')
    expect(firstUtterance.voice).toBe(russianVoice)
    expect(window.localStorage.getItem(QUESTION_SPEECH_STORAGE_KEY)).toBe('true')

    rerender({ current: { ...first, options: [...first.options] } })
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1))

    rerender({ current: question('q-2', 'Какая планета известна как красная?') })
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(2))
    expect((speak.mock.calls[1][0] as MockUtterance).text).toContain('Какая планета')

    act(() => result.current.repeat())
    expect(speak).toHaveBeenCalledTimes(3)
    expect(cancel).toHaveBeenCalled()

    const cancelsBeforeUnmount = cancel.mock.calls.length
    unmount()
    expect(cancel.mock.calls.length).toBeGreaterThan(cancelsBeforeUnmount)
  })

  it('restores the preference for the TV browser', async () => {
    window.localStorage.setItem(QUESTION_SPEECH_STORAGE_KEY, 'true')
    const { result } = renderHook(() => useQuestionSpeech({ sessionId: 'session-2', status: 'answering', question: question('q-1') }))

    expect(result.current.enabled).toBe(true)
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1))
  })

  it('uses Microsoft audio from the server before the local browser fallback', async () => {
    const play = vi.fn().mockResolvedValue(undefined)
    const pause = vi.fn()
    class MockAudio {
      onended: (() => void) | null = null
      onerror: (() => void) | null = null
      play = play
      pause = pause
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['audio'])),
      headers: new Headers({ 'X-Speech-Voice': 'ru-RU-SvetlanaNeural' }),
    })
    vi.stubGlobal('Audio', MockAudio)
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:microsoft-speech')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const { result, unmount } = renderHook(() => useQuestionSpeech({
      sessionId: 'session-cloud',
      sessionCode: 'ABC123',
      status: 'answering',
      question: question('q-cloud'),
    }))

    act(() => result.current.setEnabled(true))
    await waitFor(() => expect(result.current.provider).toBe('microsoft'))

    expect(fetchMock).toHaveBeenCalledWith('/api/speech/screens/ABC123/questions/q-cloud', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(play).toHaveBeenCalledTimes(1)
    expect(speak).not.toHaveBeenCalled()
    expect(result.current.voiceName).toBe('ru-RU-SvetlanaNeural')
    unmount()
    expect(pause).toHaveBeenCalled()
  })

  it('uses a saved question audio file before Microsoft and can replay it offline', async () => {
    const play = vi.fn().mockResolvedValue(undefined)
    const pause = vi.fn()
    const sources: string[] = []
    class MockAudio {
      onended: (() => void) | null = null
      onerror: (() => void) | null = null
      play = play
      pause = pause
      constructor(source: string) { sources.push(source) }
    }
    const fetchMock = vi.fn()
    vi.stubGlobal('Audio', MockAudio)
    vi.stubGlobal('fetch', fetchMock)
    const storedQuestion = { ...question('q-stored'), speech_audio_url: '/media/speech/event/question.wav' }
    const { result, unmount } = renderHook(() => useQuestionSpeech({
      sessionId: 'session-stored',
      sessionCode: 'ABC123',
      status: 'answering',
      question: storedQuestion,
    }))

    act(() => result.current.setEnabled(true))
    await waitFor(() => expect(result.current.provider).toBe('stored'))
    expect(sources).toEqual(['/media/speech/event/question.wav'])
    expect(fetchMock).not.toHaveBeenCalled()
    act(() => result.current.repeat())
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2))
    expect(fetchMock).not.toHaveBeenCalled()
    unmount()
    expect(pause).toHaveBeenCalled()
  })

  it('falls back to Microsoft when the saved file cannot be played', async () => {
    const play = vi.fn()
      .mockRejectedValueOnce(new Error('stored file missing'))
      .mockResolvedValueOnce(undefined)
    class MockAudio {
      onended: (() => void) | null = null
      onerror: (() => void) | null = null
      play = play
      pause = vi.fn()
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['audio'])),
      headers: new Headers({ 'X-Speech-Voice': 'ru-RU-SvetlanaNeural' }),
    })
    vi.stubGlobal('Audio', MockAudio)
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:microsoft-fallback')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const { result } = renderHook(() => useQuestionSpeech({
      sessionId: 'session-stored-fallback',
      sessionCode: 'ABC123',
      status: 'answering',
      question: { ...question('q-stored-fallback'), speech_audio_url: '/media/missing.wav' },
    }))

    act(() => result.current.setEnabled(true))
    await waitFor(() => expect(result.current.provider).toBe('microsoft'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledTimes(2)
    expect(speak).not.toHaveBeenCalled()
  })

  it('falls back to local Web Speech when Microsoft is not configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useQuestionSpeech({
      sessionId: 'session-fallback',
      sessionCode: 'ABC123',
      status: 'answering',
      question: question('q-fallback'),
    }))

    act(() => result.current.setEnabled(true))
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((speak.mock.calls[0][0] as MockUtterance).text).toBe('Кто первым полетел в космос?')
  })

  it('stays safe when the browser has no speech synthesis API', () => {
    vi.stubGlobal('SpeechSynthesisUtterance', undefined)
    vi.stubGlobal('speechSynthesis', undefined)
    const { result } = renderHook(() => useQuestionSpeech({ sessionId: 'session-3', status: 'answering', question: question('q-1') }))

    expect(result.current.supported).toBe(false)
    expect(result.current.enabled).toBe(false)
    expect(result.current.canRepeat).toBe(false)
    expect(result.current.repeat()).toBeUndefined()
  })

  it('formats options and prefers a local Russian voice', () => {
    const remoteRussian = voice('Remote Russian', 'ru-RU', false, true)
    expect(selectRussianVoice([remoteRussian, russianVoice])).toBe(russianVoice)
    expect(questionSpeechText(question('q-1'))).toBe('Кто первым полетел в космос?')
  })
})
