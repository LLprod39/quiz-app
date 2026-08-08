import { useEffect, useMemo, useState } from 'react'
import { Check, Headphones, LoaderCircle, Play, RotateCcw, Save, Sparkles, Trash2 } from 'lucide-react'

import { api, checkLocalSpeechBridge, runLocalSpeechBridge, type LocalSpeechBridgeHealth, type SpeechMvpConfig } from '../lib/api'
import type { EventData, Question, QuestionSpeech, SpeechDefaults, SpeechStyleSettings } from '../types'
import { Badge, Button, Field } from './ui'

const FALLBACK_STYLE: SpeechStyleSettings = {
  preset: 'classic-host', pace: 50, energy: 70, pitch: 50,
  expression: 60, clarity: 90, pause_ms: 300, effects: ['warm-smile'],
}

const effectLabels: Record<string, string> = {
  'quiz-host': 'Подача ведущего',
  'warm-smile': 'С лёгкой улыбкой',
  suspense: 'Добавить интригу',
  'dramatic-pause': 'Драматическая пауза',
  emphasize: 'Подчеркнуть важные слова',
  mysterious: 'Таинственный тон',
  'final-question': 'Финальная подача',
}

const sliderLabels: { key: keyof SpeechStyleSettings; label: string; min: number; max: number; suffix?: string }[] = [
  { key: 'pace', label: 'Темп', min: 0, max: 100 },
  { key: 'energy', label: 'Энергия', min: 0, max: 100 },
  { key: 'pitch', label: 'Высота', min: 0, max: 100 },
  { key: 'expression', label: 'Выразительность', min: 0, max: 100 },
  { key: 'clarity', label: 'Чёткость', min: 0, max: 100 },
  { key: 'pause_ms', label: 'Пауза', min: 0, max: 1500, suffix: ' мс' },
]

const bridgeStageLabels: Record<string, string> = {
  validating: 'Проверяем задачу и одноразовый билет…',
  preparing_task: 'Готовим отдельную папку для нового аудиофайла…',
  windows_tts: 'Создаём озвучку локальным русским голосом Windows…',
  gemini_api: 'Создаём озвучку через официальный Gemini TTS API…',
  browser_automation: 'Chrome открывает AI Studio, вставляет вопрос, создаёт и скачивает озвучку…',
  validating_download: 'Проверяем формат и целостность скачанного аудиофайла…',
  uploading: 'Сохраняем озвучку в выбранный вопрос…',
  completed: 'Озвучка сохранена.',
}

function messageForBridgeError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (/fetch|network|failed/i.test(message)) {
    return 'Локальный помощник не запущен. Запустите .\\start-quiz-mvp.ps1 и повторите.'
  }
  return message || 'Не удалось создать озвучку'
}

export function QuestionSpeechEditor({ event, question, onChanged }: {
  event: EventData
  question: Question | null
  onChanged: () => void | Promise<void>
}) {
  const [config, setConfig] = useState<SpeechMvpConfig | null>(null)
  const [speech, setSpeech] = useState<QuestionSpeech | null>(question?.speech || null)
  const [values, setValues] = useState<SpeechDefaults>(() => question?.speech_settings_override || event.speech_settings || { voice_id: 'Kore', settings: FALLBACK_STYLE })
  const [useEventDefaults, setUseEventDefaults] = useState(!question?.speech_settings_override)
  const [voiceFilter, setVoiceFilter] = useState<'all' | 'female' | 'male'>('all')
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [bridgeProvider, setBridgeProvider] = useState<LocalSpeechBridgeHealth['provider']>()

  useEffect(() => {
    let active = true
    api.speechMvpConfig().then(result => {
      if (!active) return
      setConfig(result)
      if (!event.speech_settings) setValues(result.defaults)
      void checkLocalSpeechBridge(result.bridge_url).then(health => {
        if (active) setBridgeProvider(health.provider)
      }).catch(() => {})
    }).catch(err => active && setError(err instanceof Error ? err.message : 'Не удалось загрузить голоса'))
    return () => { active = false }
  }, [event.id])

  useEffect(() => {
    if (!question) { setSpeech(null); return }
    api.questionSpeech(question.id).then(setSpeech).catch(() => setSpeech(question.speech || null))
  }, [question?.id])

  const voices = useMemo(() => (config?.voices || []).filter(voice => voiceFilter === 'all' || voice.presentation === voiceFilter), [config, voiceFilter])
  const setStyle = (patch: Partial<SpeechStyleSettings>) => {
    setUseEventDefaults(false)
    setValues(current => ({ ...current, settings: { ...current.settings, ...patch } }))
  }
  const choosePreset = (preset: string) => {
    const found = config?.presets[preset]
    if (!found) return
    const { label: _label, voice_id, ...style } = found
    void _label
    setUseEventDefaults(false)
    setValues(current => ({
      voice_id: voice_id || current.voice_id,
      settings: { ...current.settings, ...style, preset } as SpeechStyleSettings,
    }))
  }
  const toggleEffect = (effect: string) => {
    const current = new Set(values.settings.effects)
    current.has(effect) ? current.delete(effect) : current.add(effect)
    setStyle({ preset: 'custom', effects: [...current] })
  }
  const refresh = async () => {
    if (!question) return
    setSpeech(await api.questionSpeech(question.id))
    await onChanged()
  }
  const persistQuestionSettings = async () => {
    if (!question) return
    const next = await api.updateQuestionSpeechDefaults(question.id, { ...values, use_event_defaults: useEventDefaults })
    setSpeech(next)
  }
  const generate = async (force = false) => {
    if (!question) return
    setBusy('generate'); setError(''); setStatus('Проверяем сохранённую озвучку…')
    try {
      await persistQuestionSettings()
      const ticket = await api.speechTicket(question.id, { ...values, force })
      if (ticket.status === 'already_ready') {
        setStatus('Такая озвучка уже сохранена — повторная генерация не нужна.')
        await refresh()
        return
      }
      if (!config) throw new Error('Конфигурация озвучки ещё загружается')
      const initialHealth = await checkLocalSpeechBridge(config.bridge_url)
      setBridgeProvider(initialHealth.provider)
      setStatus(initialHealth.provider === 'windows_tts'
        ? 'Создаём один аудиофайл локальным русским голосом Windows…'
        : initialHealth.provider === 'gemini_api'
          ? 'Создаём один аудиофайл через Gemini TTS API…'
          : 'Открываем Google AI Studio и создаём один аудиофайл…')
      await runLocalSpeechBridge(config.bridge_url, ticket, health => {
        setBridgeProvider(health.provider)
        const progress = bridgeStageLabels[health.stage]
        if (progress) setStatus(progress)
      })
      setStatus(speech?.active ? 'Новый вариант готов. Прослушайте и примените его.' : 'Озвучка создана и применена.')
      await refresh()
    } catch (err) {
      setError(messageForBridgeError(err)); setStatus('')
    } finally { setBusy('') }
  }
  const saveDefaults = async () => {
    setBusy('defaults'); setError('')
    try { await api.updateSpeechDefaults(event.id, values); setStatus('Настройки сохранены для этого квиза.'); await onChanged() }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сохранить настройки') }
    finally { setBusy('') }
  }
  const saveQuestionDefaults = async () => {
    setBusy('question-defaults'); setError('')
    try { await persistQuestionSettings(); setStatus(useEventDefaults ? 'Вопрос снова использует настройки квиза.' : 'Собственные настройки вопроса сохранены.'); await onChanged() }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сохранить настройки вопроса') }
    finally { setBusy('') }
  }
  const checkBridge = async () => {
    setBusy('bridge'); setError(''); setStatus('Проверяем локальный помощник…')
    try {
      if (!config) throw new Error('Конфигурация озвучки ещё загружается')
      const health = await checkLocalSpeechBridge(config.bridge_url)
      setBridgeProvider(health.provider)
      if (health.provider === 'windows_tts') {
        setStatus(health.busy ? 'Локальная озвучка уже создаётся для другого вопроса.' : 'Локальный русский голос Windows готов. API key и Chrome не нужны.')
      } else if (health.provider === 'gemini_api') {
        setStatus(health.busy ? 'Gemini TTS уже озвучивает другой вопрос.' : 'Официальный Gemini TTS API готов.')
      } else if (health.agent_browser === 'missing') {
        setError('Bridge запущен, но agent-browser не установлен. Выполните: npm i -g agent-browser; затем agent-browser install')
        setStatus('')
      } else if (health.busy) {
        setStatus('Bridge работает: сейчас озвучивается другой вопрос.')
      } else if (health.chrome === 'connected') {
        setStatus('Bridge и отдельный Chrome подключены. Можно озвучивать вопрос.')
      } else {
        setStatus('Bridge готов. Отдельный Chrome запустится автоматически при озвучивании.')
      }
    } catch (err) {
      setError(messageForBridgeError(err)); setStatus('')
    } finally { setBusy('') }
  }
  const activate = async () => {
    if (!question || !speech?.candidate) return
    setBusy('activate'); setError('')
    try { setSpeech(await api.activateSpeech(question.id, speech.candidate.id)); setStatus('Новый вариант применён.'); await onChanged() }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось применить вариант') }
    finally { setBusy('') }
  }
  const keepOld = async () => {
    if (!question || !speech?.candidate) return
    setBusy('delete'); setError('')
    try { setSpeech(await api.deleteSpeech(question.id, speech.candidate.id)); setStatus('Старый активный вариант оставлен.'); await onChanged() }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось удалить новый вариант') }
    finally { setBusy('') }
  }
  const restore = async () => {
    if (!question) return
    setBusy('restore'); setError('')
    try { setSpeech(await api.restoreSpeech(question.id, speech!.previous!.id)); setStatus('Предыдущая версия снова активна.'); await onChanged() }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось вернуть предыдущую версию') }
    finally { setBusy('') }
  }

  if (!question) return <section className="speech-editor disabled"><Headphones /><div><b>Озвучка вопроса</b><small>Сначала сохраните вопрос, затем появятся голос и настройки.</small></div></section>

  const previewVersion = speech?.versions.find(version => version.voice_id === values.voice_id)
  const useQuizDefaults = () => {
    setUseEventDefaults(true)
    setValues(event.speech_settings || config?.defaults || { voice_id: 'Kore', settings: FALLBACK_STYLE })
  }
  const changeFilter = (filter: 'all' | 'female' | 'male') => {
    setVoiceFilter(filter)
    const first = config?.voices.find(voice => filter === 'all' || voice.presentation === filter)
    const selected = config?.voices.find(voice => voice.id === values.voice_id)
    if (filter !== 'all' && selected?.presentation !== filter && first) {
      setUseEventDefaults(false)
      setValues(current => ({ ...current, voice_id: first.id }))
    }
  }
  const providerTitle = bridgeProvider === 'windows_tts'
    ? 'Локальная озвучка Windows · один вопрос'
    : bridgeProvider === 'gemini_api'
      ? 'Gemini TTS API · один вопрос'
      : 'Озвучка · один вопрос'
  const privacyNote = bridgeProvider === 'windows_tts'
    ? 'Текст обрабатывается только на этом компьютере системным голосом Windows и никуда не передаётся.'
    : 'При облачном режиме текст вопроса передаётся выбранному провайдеру озвучки.'

  return <section className="speech-editor">
    <div className="speech-editor-heading"><div><span className="overline">Озвучка вопроса</span><h3>{providerTitle}</h3><p>Готовый файл сохраняется в квизе и повторно не генерируется.</p></div><Badge tone={speech?.active ? 'success' : 'neutral'}>{speech?.active ? 'Озвучка сохранена' : 'Без озвучки'}</Badge></div>
    <label className="check-row compact speech-default-toggle"><input type="checkbox" checked={useEventDefaults} onChange={e => e.target.checked ? useQuizDefaults() : setUseEventDefaults(false)} /><span><b>Использовать настройки квиза</b><small>Снимите флажок, чтобы сохранить отдельный голос и стиль для этого вопроса.</small></span></label>
    <div className="speech-filter" role="group" aria-label="Фильтр голосов">{([['female', 'Женские'], ['male', 'Мужские'], ['all', 'Все']] as const).map(([value, label]) => <button type="button" key={value} className={voiceFilter === value ? 'active' : ''} onClick={() => changeFilter(value)}>{label}</button>)}</div>
    <div className="form-grid two"><Field label="Голос"><select value={values.voice_id} onChange={e => { setUseEventDefaults(false); setValues({ ...values, voice_id: e.target.value }) }}>{voices.map(voice => <option key={voice.id} value={voice.id}>{voice.label}</option>)}</select><small>{config?.voices.find(voice => voice.id === values.voice_id)?.description}</small><button type="button" className="text-button speech-voice-preview" disabled={!previewVersion} onClick={() => previewVersion && void new Audio(previewVersion.file_url).play()}><Play size={14} /> {previewVersion ? 'Тест голоса' : 'Тест после первой генерации'}</button></Field><Field label="Пресет"><select value={values.settings.preset} onChange={e => choosePreset(e.target.value)}>{Object.entries(config?.presets || {}).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}</select></Field></div>
    <div className="speech-sliders">{sliderLabels.map(item => <label key={item.key}><span>{item.label}</span><input type="range" min={item.min} max={item.max} step={item.key === 'pause_ms' ? 50 : 1} value={Number(values.settings[item.key])} onChange={e => setStyle({ preset: 'custom', [item.key]: Number(e.target.value) })} /><b>{Number(values.settings[item.key])}{item.suffix}</b></label>)}</div>
    <div className="speech-effects">{Object.entries(effectLabels).map(([effect, label]) => <label key={effect}><input type="checkbox" checked={values.settings.effects.includes(effect)} onChange={() => toggleEffect(effect)} /><span>{label}</span></label>)}</div>
    <div className="speech-actions"><Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => void checkBridge()}>{busy === 'bridge' ? <LoaderCircle className="spin" /> : <Headphones />} Проверить bridge</Button><Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => void saveDefaults()}>{busy === 'defaults' ? <LoaderCircle className="spin" /> : <Save />} Для всего квиза</Button><Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => void saveQuestionDefaults()}>{busy === 'question-defaults' ? <LoaderCircle className="spin" /> : <Save />} Для этого вопроса</Button><Button type="button" disabled={Boolean(busy)} onClick={() => void generate(Boolean(speech?.active))}>{busy === 'generate' ? <LoaderCircle className="spin" /> : <Sparkles />} {speech?.active ? 'Переозвучить' : bridgeProvider === 'windows_tts' ? 'Озвучить локально' : 'Озвучить вопрос'}</Button></div>
    {speech?.stale && <p className="speech-warning">Текст или настройки изменились после озвучки. Сохранённый файл останется рабочим, но лучше переозвучить.</p>}
    <div className="speech-versions">
      {speech?.active && <div><span><Check /> Текущая озвучка · {speech.active.voice_id}</span><audio controls preload="metadata" src={speech.active.file_url} /></div>}
      {speech?.candidate && <div className="candidate"><span><Sparkles /> Новый вариант · {speech.candidate.voice_id}</span><audio controls preload="metadata" src={speech.candidate.file_url} /><div><Button type="button" onClick={() => void activate()} disabled={Boolean(busy)}><Check /> Применить новую</Button><Button type="button" variant="secondary" onClick={() => void keepOld()} disabled={Boolean(busy)}><Trash2 /> Оставить старую</Button></div></div>}
      {speech?.previous && <Button type="button" variant="ghost" onClick={() => void restore()} disabled={Boolean(busy)}><RotateCcw /> Вернуть предыдущую версию</Button>}
    </div>
    {status && <p className="speech-status"><Play size={15} /> {status}</p>}
    {error && <p className="form-error">{error}</p>}
    <small className="speech-privacy-note">{privacyNote}</small>
  </section>
}
