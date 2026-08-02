import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GameStatus, Question } from '../types'

export const QUESTION_SPEECH_STORAGE_KEY = 'quiz-app.screen.question-speech'

interface QuestionSpeechOptions {
  sessionId?: string
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
  const parts = [question.text.trim()]
  if (question.options.length) {
    parts.push('Варианты ответа.')
    question.options.forEach((option, index) => {
      parts.push(`${String.fromCharCode(65 + index)}. ${option.text.trim()}.`)
    })
  }
  return parts.filter(Boolean).join(' ')
}

export function useQuestionSpeech({ sessionId, status, question }: QuestionSpeechOptions) {
  const supported = typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && typeof SpeechSynthesisUtterance !== 'undefined'
  const [enabled, setEnabledState] = useState(savedPreference)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [speaking, setSpeaking] = useState(false)
  const spokenQuestions = useRef(new Set<string>())
  const currentUtterance = useRef<SpeechSynthesisUtterance | null>(null)
  const activeKey = status === 'answering' && question ? `${sessionId || 'session'}:${question.id}` : null
  const voice = useMemo(() => selectRussianVoice(voices), [voices])

  useEffect(() => {
    if (!supported) return
    const synthesis = window.speechSynthesis
    const refreshVoices = () => setVoices(synthesis.getVoices())
    refreshVoices()
    synthesis.addEventListener('voiceschanged', refreshVoices)
    return () => synthesis.removeEventListener('voiceschanged', refreshVoices)
  }, [supported])

  const cancel = useCallback(() => {
    if (!supported) return
    currentUtterance.current = null
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [supported])

  const speak = useCallback((repeat = false) => {
    if (!supported || !question || !activeKey) return false
    if (!repeat && spokenQuestions.current.has(activeKey)) return false

    const synthesis = window.speechSynthesis
    currentUtterance.current = null
    synthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(questionSpeechText(question))
    utterance.lang = voice?.lang || 'ru-RU'
    utterance.rate = 0.95
    utterance.pitch = 1
    utterance.volume = 1
    if (voice) utterance.voice = voice
    utterance.onstart = () => {
      if (currentUtterance.current === utterance) setSpeaking(true)
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
    if (!repeat) spokenQuestions.current.add(activeKey)
    try {
      synthesis.speak(utterance)
      return true
    } catch {
      currentUtterance.current = null
      setSpeaking(false)
      if (!repeat) spokenQuestions.current.delete(activeKey)
      return false
    }
  }, [activeKey, question, supported, voice])

  useEffect(() => {
    if (!supported) return
    setSpeaking(false)
    return () => {
      currentUtterance.current = null
      window.speechSynthesis.cancel()
    }
  }, [activeKey, supported])

  useEffect(() => {
    if (enabled && activeKey) speak(false)
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
    voiceName: voice?.name || null,
    setEnabled,
    repeat: () => speak(true),
  }
}
