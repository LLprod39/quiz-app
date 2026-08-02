import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GameStatus, Question } from '../types'
import { fetchMicrosoftQuestionSpeech } from './api'

export const QUESTION_SPEECH_STORAGE_KEY = 'quiz-app.screen.question-speech'

interface QuestionSpeechOptions {
  sessionId?: string
  sessionCode?: string
  status?: GameStatus
  question?: Question | null
}

function savedPreference() {
  try {
    return window.localStorage.getItem(QUESTION_SPEECH_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function savePreference(enabled: boolean) {
  try {
    window.localStorage.setItem(QUESTION_SPEECH_STORAGE_KEY, String(enabled))
  } catch {
    // Private browsing and locked-down TV profiles can reject localStorage.
  }
}

export function selectRussianVoice(voices: SpeechSynthesisVoice[]) {
  const russian = voices.filter(voice => /^ru(?:-|_)/i.test(voice.lang))
  return russian.find(voice => voice.localService && voice.default)
    || russian.find(voice => voice.localService)
    || russian.find(voice => voice.default)
    || russian[0]
    || null
}

export function questionSpeechText(question: Question) {
  return question.text.trim()
}

export function useQuestionSpeech({ sessionId, sessionCode, status, question }: QuestionSpeechOptions) {
  const browserSupported = typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && Boolean(window.speechSynthesis)
    && typeof SpeechSynthesisUtterance !== 'undefined'
  const audioSupported = typeof Audio !== 'undefined'
    && typeof URL !== 'undefined'
    && typeof URL.createObjectURL === 'function'
  const supported = browserSupported || (audioSupported && Boolean(sessionCode))
  const [enabled, setEnabledState] = useState(savedPreference)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [speaking, setSpeaking] = useState(false)
  const [provider, setProvider] = useState<'microsoft' | 'browser' | null>(null)
  const [providerVoice, setProviderVoice] = useState<string | null>(null)
  const spokenQuestions = useRef(new Set<string>())
  const currentUtterance = useRef<SpeechSynthesisUtterance | null>(null)
  const currentAudio = useRef<{ element: HTMLAudioElement; url: string } | null>(null)
  const currentRequest = useRef<AbortController | null>(null)
  const playbackAttempt = useRef(0)
  const activeKey = status === 'answering' && question ? `${sessionId || 'session'}:${question.id}` : null
  const voice = useMemo(() => selectRussianVoice(voices), [voices])

  useEffect(() => {
    if (!browserSupported) return
    const synthesis = window.speechSynthesis
    const refreshVoices = () => setVoices(synthesis.getVoices())
    refreshVoices()
    synthesis.addEventListener('voiceschanged', refreshVoices)
    return () => synthesis.removeEventListener('voiceschanged', refreshVoices)
  }, [browserSupported])

  const cancel = useCallback((updateState = true) => {
    playbackAttempt.current += 1
    currentRequest.current?.abort()
    currentRequest.current = null
    if (currentAudio.current) {
      currentAudio.current.element.onended = null
      currentAudio.current.element.onerror = null
      currentAudio.current.element.pause()
      URL.revokeObjectURL(currentAudio.current.url)
      currentAudio.current = null
    }
    currentUtterance.current = null
    if (browserSupported) window.speechSynthesis.cancel()
    if (updateState) setSpeaking(false)
  }, [browserSupported])

  const speak = useCallback(async (repeat = false) => {
    if (!supported || !question || !activeKey) return false
    if (!repeat && spokenQuestions.current.has(activeKey)) return false
    cancel()
    const attempt = playbackAttempt.current
    if (!repeat) spokenQuestions.current.add(activeKey)

    if (audioSupported && sessionCode) {
      const controller = new AbortController()
      currentRequest.current = controller
      try {
        const result = await fetchMicrosoftQuestionSpeech(sessionCode, question.id, controller.signal)
        currentRequest.current = null
        if (attempt !== playbackAttempt.current) return false
        if (result) {
          const url = URL.createObjectURL(result.audio)
          const audio = new Audio(url)
          currentAudio.current = { element: audio, url }
          const finish = () => {
            if (currentAudio.current?.element === audio) {
              URL.revokeObjectURL(url)
              currentAudio.current = null
              setSpeaking(false)
            }
          }
          audio.onended = finish
          audio.onerror = finish
          try {
            await audio.play()
            if (attempt !== playbackAttempt.current || currentAudio.current?.element !== audio) return false
            setProvider('microsoft')
            setProviderVoice(result.voice)
            setSpeaking(true)
            return true
          } catch {
            finish()
          }
        }
      } catch (error) {
        currentRequest.current = null
        if (controller.signal.aborted || attempt !== playbackAttempt.current) return false
      }
    }

    if (!browserSupported || attempt !== playbackAttempt.current) {
      if (!repeat) spokenQuestions.current.delete(activeKey)
      return false
    }
    const synthesis = window.speechSynthesis
    const utterance = new SpeechSynthesisUtterance(questionSpeechText(question))
    utterance.lang = voice?.lang || 'ru-RU'
    utterance.rate = 0.95
    utterance.pitch = 1
    utterance.volume = 1
    if (voice) utterance.voice = voice
    utterance.onstart = () => {
      if (currentUtterance.current === utterance) {
        setProvider('browser')
        setProviderVoice(voice?.name || null)
        setSpeaking(true)
      }
    }
    const finish = () => {
      if (currentUtterance.current === utterance) {
        currentUtterance.current = null
        setSpeaking(false)
      }
    }
    utterance.onend = finish
    utterance.onerror = finish
    currentUtterance.current = utterance
    try {
      synthesis.speak(utterance)
      return true
    } catch {
      currentUtterance.current = null
      setSpeaking(false)
      if (!repeat) spokenQuestions.current.delete(activeKey)
      return false
    }
  }, [activeKey, audioSupported, browserSupported, cancel, question, sessionCode, supported, voice])

  useEffect(() => {
    setSpeaking(false)
    return () => cancel(false)
  }, [activeKey, cancel])

  useEffect(() => {
    if (enabled && activeKey) void speak(false)
  }, [activeKey, enabled, speak])

  const setEnabled = useCallback((next: boolean) => {
    if (!supported) return
    setEnabledState(next)
    savePreference(next)
    if (!next) cancel()
  }, [cancel, supported])

  return {
    supported,
    enabled: supported && enabled,
    speaking,
    canRepeat: supported && enabled && Boolean(activeKey),
    provider,
    voiceName: providerVoice || voice?.name || null,
    setEnabled,
    repeat: () => { void speak(true) },
  }
}
