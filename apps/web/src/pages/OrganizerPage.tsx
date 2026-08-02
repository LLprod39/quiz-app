import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Archive, ArrowLeft, BarChart3, BookOpenText, Check, ChevronRight, CircleHelp, ClipboardList, Copy, Crown, ExternalLink, Gamepad2, Gauge, Headphones, History, LayoutDashboard, Link2, LoaderCircle, LogOut, Monitor, MoreVertical, PartyPopper, Pencil, Play, Plus, QrCode, Radio, Save, Send, Settings2, Smartphone, Sparkles, Trash2, Upload, Users, Wifi } from 'lucide-react'
import { Link } from '../lib/router'
import { QRCodeSVG } from 'qrcode.react'
import { api, ApiError } from '../lib/api'
import { createId } from '../lib/id'
import { useGameStore } from '../store/game'
import type { EventData, Question, QuestionnaireItem, Snapshot } from '../types'
import { Badge, Button, Card, ConnectionPill, Empty, Field, Logo, SaveState, formatTime } from '../components/ui'
import { Timer } from '../components/Timer'

type Tab = 'overview' | 'questionnaire' | 'editor' | 'rehearsal' | 'live' | 'history'

const nav: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Главная', icon: LayoutDashboard },
  { id: 'questionnaire', label: 'Анкета героя', icon: ClipboardList },
  { id: 'editor', label: 'Вопросы', icon: CircleHelp },
  { id: 'rehearsal', label: 'Репетиция', icon: Gauge },
  { id: 'live', label: 'Эфир', icon: Radio },
  { id: 'history', label: 'Результаты', icon: History },
]

function participantCountLabel(count: number) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} участник`
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return `${count} участника`
  return `${count} участников`
}

export function OrganizerPage() {
  const [authenticated, setAuthenticated] = useState(Boolean(localStorage.getItem('admin_token')))
  const [event, setEvent] = useState<EventData | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [session, setSession] = useState<Snapshot | null>(null)
  const storeSnapshot = useGameStore(s => s.snapshot)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const items = await api.events()
      const activeEvent = items.find(item => !['archived', 'finished'].includes(item.status)) || null
      setEvent(activeEvent)
      setTab(current => activeEvent?.event_format === 'battle' && current === 'questionnaire' ? 'overview' : current)
      const roomCode = activeEvent?.active_session_code || activeEvent?.latest_session_code
      if (roomCode) {
        const snap = await api.snapshot(roomCode); setSession(snap)
        if (activeEvent?.active_session_code) useGameStore.getState().connect(roomCode)
      } else setSession(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { localStorage.removeItem('admin_token'); setAuthenticated(false) }
      else setError(err instanceof Error ? err.message : 'Не удалось загрузить данные')
    } finally { setLoading(false) }
  }
  useEffect(() => { if (authenticated) void load(); else setLoading(false) }, [authenticated])
  useEffect(() => { if (storeSnapshot) setSession(storeSnapshot) }, [storeSnapshot])

  if (!authenticated) return <LoginPanel onDone={() => setAuthenticated(true)} />
  if (loading) return <div className="center-screen"><LoaderCircle className="spin" size={32} /><p>Готовим панель…</p></div>
  if (!event) return <CreateEventPanel onCreated={load} onLogout={() => { localStorage.removeItem('admin_token'); setAuthenticated(false) }} />

  const logout = () => { localStorage.removeItem('admin_token'); setAuthenticated(false) }
  const eventNav = nav.filter(item => event.event_format === 'celebration' || item.id !== 'questionnaire')
  const openRoom = async () => {
    try { const snap = await api.openSession(event.id); setSession(snap); useGameStore.getState().connect(snap.session.join_code); setTab('live') }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось открыть комнату') }
  }

  return <div className="admin-shell" style={{ '--accent': event.theme.accent } as React.CSSProperties}>
    <aside className="admin-sidebar">
      <Logo />
      <nav>{eventNav.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon size={20} /><span>{item.label}</span>{item.id === 'live' && session && <i className="live-dot" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="mode-block"><span className="status-dot" /><div><b>{session?.session.deployment_mode === 'cloud' ? 'Облачный режим' : 'Локальный режим'}</b><small>Сервер доступен</small></div></div><button onClick={logout}><LogOut size={19} /> Выйти</button></div>
    </aside>
    <div className="admin-main">
      <header className="admin-topbar"><button className="mobile-logo" onClick={() => setTab('overview')}><Logo compact /></button><div><span className="crumb">Мероприятие</span><h1>{event.title}</h1></div><div className="top-actions">{session && <Badge tone="success"><Radio size={13} /> Комната {session.session.join_code}</Badge>}<Button variant="secondary" onClick={() => void load()}><Activity size={17} /> Обновить</Button></div></header>
      {error && <div className="error-banner">{error}<button onClick={() => setError('')}>×</button></div>}
      <main className="admin-content">
        {tab === 'overview' && <Overview event={event} session={session} onOpen={openRoom} onTab={setTab} onChanged={load} />}
        {tab === 'questionnaire' && event.questionnaire && <QuestionnairePanel event={event} onChanged={load} />}
        {tab === 'editor' && <EditorPanel event={event} onChanged={load} />}
        {tab === 'rehearsal' && <RehearsalPanel event={event} session={session} onOpen={openRoom} />}
        {tab === 'live' && <LivePanel event={event} session={session} onOpen={openRoom} />}
        {tab === 'history' && <ResultsPanel session={session} />}
      </main>
      <nav className="mobile-tabs">{eventNav.slice(0, 5).map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon size={20} /><span>{item.label}</span></button>)}</nav>
    </div>
  </div>
}

function LoginPanel({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('organizer@example.local')
  const [password, setPassword] = useState('celebrate')
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false)
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setLoading(true); setError(''); try { const result = await api.login(email, password); localStorage.setItem('admin_token', result.access_token); onDone() } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось войти') } finally { setLoading(false) } }
  return <main className="login-page"><Link to="/" className="back-link"><ArrowLeft size={17} /> На главную</Link><Card className="login-card"><Logo /><div className="login-intro"><Badge tone="accent">Панель организатора</Badge><h1>Соберём квиз?</h1><p>Войдите, чтобы подготовить вопросы и управлять игрой.</p></div><form onSubmit={submit}><Field label="Электронная почта"><input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" /></Field><Field label="Пароль"><input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></Field>{error && <p className="form-error">{error}</p>}<Button type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={19} /> : <Sparkles size={19} />} Войти</Button></form><small className="demo-hint">Демо: organizer@example.local / celebrate</small></Card></main>
}

function CreateEventPanel({ onCreated, onLogout }: { onCreated: () => void; onLogout: () => void }) {
  const [form, setForm] = useState({
    title: '', event_format: 'celebration' as EventData['event_format'], topic: '', hero_name: '', event_date: new Date().toISOString().slice(0, 10),
    game_mode: 'individual', allow_late_join: true, hero_photo_url: null,
    theme: { accent: '#ff6b6b', mode: 'dark', decor: 'confetti' },
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('')
    try { await api.createEvent(form); await onCreated() }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось создать мероприятие') }
    finally { setBusy(false) }
  }
  return <main className="login-page create-event-page">
    <button className="back-link" onClick={onLogout}><LogOut size={17} /> Выйти</button>
    <Card className="login-card create-event-card"><Logo /><div className="login-intro"><Badge tone="accent">Новое мероприятие</Badge><h1>{form.event_format === 'battle' ? 'На какую тему играем?' : 'Кого сегодня празднуем?'}</h1><p>{form.event_format === 'battle' ? 'Создайте тематическую игру — первый раунд появится автоматически.' : 'Создайте основу — анкета героя и первый раунд появятся автоматически.'}</p></div>
      <form onSubmit={submit} className="form-grid"><Field label="Формат"><select value={form.event_format} onChange={e => { const event_format = e.target.value as EventData['event_format']; setForm({ ...form, event_format, game_mode: event_format === 'battle' ? 'team' : form.game_mode }) }}><option value="celebration">Праздник о человеке</option><option value="battle">Тематический квиз-баттл</option></select></Field><Field label="Название"><input required minLength={2} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={form.event_format === 'battle' ? 'Большая битва эрудитов' : 'Вечер в честь…'} /></Field>{form.event_format === 'celebration' ? <Field label="Имя героя"><input required value={form.hero_name} onChange={e => setForm({ ...form, hero_name: e.target.value })} placeholder="Имя" /></Field> : <Field label="Тема баттла"><input required value={form.topic} onChange={e => setForm({ ...form, topic: e.target.value })} placeholder="Кино, музыка, спорт, наука…" /></Field>}<Field label="Дата"><input type="date" value={form.event_date} onChange={e => setForm({ ...form, event_date: e.target.value })} /></Field><Field label="Режим"><select value={form.game_mode} onChange={e => setForm({ ...form, game_mode: e.target.value })}><option value="individual">Личный</option><option value="team">Командный</option></select></Field><Field label="Акцентный цвет"><input type="color" value={form.theme.accent} onChange={e => setForm({ ...form, theme: { ...form.theme, accent: e.target.value } })} /></Field><label className="check-row"><input type="checkbox" checked={form.allow_late_join} onChange={e => setForm({ ...form, allow_late_join: e.target.checked })} /><span><b>Разрешить поздний вход</b><small>Опоздавшие начнут со следующего вопроса</small></span></label>{error && <p className="form-error form-grid-wide">{error}</p>}<Button type="submit" className="form-grid-wide" disabled={busy || !form.title.trim() || (form.event_format === 'celebration' ? !form.hero_name.trim() : !form.topic.trim())}>{busy ? <LoaderCircle className="spin" size={19} /> : <PartyPopper size={19} />} Создать мероприятие</Button></form>
    </Card>
  </main>
}

function Overview({ event, session, onOpen, onTab, onChanged }: { event: EventData; session: Snapshot | null; onOpen: () => void; onTab: (tab: Tab) => void; onChanged: () => void }) {
  const [editing, setEditing] = useState(false); const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: event.title, event_format: event.event_format, topic: event.topic, hero_name: event.hero_name, event_date: event.event_date, game_mode: event.game_mode, allow_late_join: event.allow_late_join, hero_photo_url: event.hero_photo_url, theme: event.theme })
  const save = async () => { setSaving(true); await api.updateEvent(event.id, form as Partial<EventData>); setSaving(false); setEditing(false); onChanged() }
  const archive = async () => { if (!window.confirm('Архивировать мероприятие? История игр сохранится.')) return; setSaving(true); await api.archiveEvent(event.id); setSaving(false); onChanged() }
  const progress = Math.min(100, Math.round((event.question_count / 15) * 100))
  return <div className="content-stack">
    <section className="page-heading"><div><Badge tone="accent"><PartyPopper size={14} /> Активное мероприятие</Badge><h2>Добрый день! Всё идёт по плану.</h2><p>До эфира осталось проверить вопросы и устройства гостей.</p></div><Button onClick={session ? () => onTab('live') : onOpen}><Play size={19} /> {session ? 'Перейти в эфир' : 'Открыть комнату'}</Button></section>
    <div className="stats-grid"><Card><span className="metric-icon coral"><CircleHelp /></span><div><strong>{event.question_count}<small>/ 15</small></strong><span>вопросов готово</span></div><button onClick={() => onTab('editor')}>Редактировать <ChevronRight /></button></Card>{event.event_format === 'celebration' ? <Card><span className="metric-icon purple"><ClipboardList /></span><div><strong>{event.questionnaire?.status === 'completed' ? 'Готова' : 'Ждём'}</strong><span>анкета героя</span></div><button onClick={() => onTab('questionnaire')}>Открыть <ChevronRight /></button></Card> : <Card><span className="metric-icon purple"><Gamepad2 /></span><div><strong>Баттл</strong><span>{event.topic}</span></div><button onClick={() => setEditing(true)}>Настроить <ChevronRight /></button></Card>}<Card><span className="metric-icon mint"><Users /></span><div><strong>{session?.participants.length || 0}</strong><span>игроков в комнате</span></div><button onClick={() => onTab('live')}>Посмотреть <ChevronRight /></button></Card></div>
    <div className="overview-grid"><Card className="event-card"><div className="card-title"><div><span className="overline">Карточка события</span><h3>{event.title}</h3></div><div className="event-card-actions"><button className="icon-button" title="Редактировать" onClick={() => setEditing(!editing)}><Pencil size={18} /></button><button className="icon-button danger-icon" title="Архивировать" onClick={() => void archive()} disabled={saving}><Archive size={18} /></button></div></div>{editing ? <div className="form-grid"><Field label="Формат"><select value={form.event_format} onChange={e => setForm({ ...form, event_format: e.target.value as EventData['event_format'] })}><option value="celebration">Праздник о человеке</option><option value="battle">Тематический квиз-баттл</option></select></Field><Field label="Название"><input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field>{form.event_format === 'celebration' ? <Field label="Имя героя"><input value={form.hero_name} onChange={e => setForm({ ...form, hero_name: e.target.value })} /></Field> : <Field label="Тема баттла"><input value={form.topic} onChange={e => setForm({ ...form, topic: e.target.value })} placeholder="Кино, музыка, спорт…" /></Field>}<Field label="Дата"><input type="date" value={form.event_date} onChange={e => setForm({ ...form, event_date: e.target.value })} /></Field><Field label="Режим"><select value={form.game_mode} onChange={e => setForm({ ...form, game_mode: e.target.value })}><option value="individual">Личный</option><option value="team">Командный</option></select></Field><Field label="Акцентный цвет"><input type="color" value={form.theme.accent} onChange={e => setForm({ ...form, theme: { ...form.theme, accent: e.target.value } })} /></Field><label className="check-row"><input type="checkbox" checked={form.allow_late_join} onChange={e => setForm({ ...form, allow_late_join: e.target.checked })} /><span><b>Разрешить поздний вход</b><small>Игрок начнёт со следующего вопроса</small></span></label><div className="form-actions"><Button variant="ghost" onClick={() => setEditing(false)}>Отмена</Button><Button onClick={() => void save()} disabled={saving || !form.title.trim() || (form.event_format === 'celebration' ? !form.hero_name.trim() : !form.topic.trim())}><Save size={17} /> Сохранить</Button></div></div> : <><div className="event-hero-preview"><div className="event-initial">{(event.event_format === 'battle' ? event.topic : event.hero_name).slice(0, 1)}</div><div><span>{event.event_format === 'battle' ? 'Тема квиз-баттла' : 'Герой праздника'}</span><b>{event.event_format === 'battle' ? event.topic : event.hero_name}</b><small>{event.event_date ? new Date(event.event_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Дата не указана'}</small></div></div><div className="event-meta"><span><Gamepad2 /> {event.game_mode === 'team' ? 'Командная игра' : 'Личная игра'}</span><span><Wifi /> Поздний вход {event.allow_late_join ? 'включён' : 'выключен'}</span></div></>}</Card>
      <Card className="readiness-card"><div className="card-title"><div><span className="overline">Готовность</span><h3>До старта — три шага</h3></div><b>{progress}%</b></div><div className="progress-line"><i style={{ width: `${progress}%` }} /></div><button className="check-step done" onClick={() => event.event_format === 'celebration' ? onTab('questionnaire') : setEditing(true)}><Check /><span><b>Оформить мероприятие</b><small>{event.event_format === 'battle' ? 'Название, тема и режим готовы' : 'Имя, дата и тема готовы'}</small></span><ChevronRight /></button><button className={`check-step ${event.question_count >= 3 ? 'done' : ''}`} onClick={() => onTab('editor')}><Check /><span><b>Подготовить вопросы</b><small>{event.question_count} из 15 добавлено</small></span><ChevronRight /></button><button className="check-step" onClick={() => onTab('rehearsal')}><Check /><span><b>Провести репетицию</b><small>Экран, звук и телефоны</small></span><ChevronRight /></button></Card></div>
  </div>
}

function QuestionnairePanel({ event, onChanged }: { event: EventData; onChanged: () => void }) {
  const questionnaire = event.questionnaire!; const [copied, setCopied] = useState(false); const [newItem, setNewItem] = useState(''); const [busy, setBusy] = useState('')
  const copy = async () => { await navigator.clipboard.writeText(questionnaire.public_url); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  const add = async () => { if (!newItem.trim()) return; setBusy('new'); await api.addQuestionnaireItem(event.id, newItem); setNewItem(''); setBusy(''); onChanged() }
  const convert = async (item: QuestionnaireItem) => { setBusy(item.id); await api.toQuestion(item.id); setBusy(''); onChanged() }
  return <div className="content-stack"><section className="page-heading"><div><Badge tone={questionnaire.status === 'completed' ? 'success' : 'warning'}>{questionnaire.status === 'completed' ? 'Анкета заполнена' : 'Ожидаем ответы'}</Badge><h2>Анкета для {event.hero_name}</h2><p>Личная ссылка открывается без регистрации. Ответы видит только организатор.</p></div></section><Card className="share-card"><div className="share-icon"><Link2 /></div><div><span>Приватная ссылка</span><b>{questionnaire.public_url}</b><small>Ссылка содержит длинный случайный токен</small></div><Button variant="secondary" onClick={() => void copy()}>{copied ? <Check size={18} /> : <Copy size={18} />}{copied ? 'Скопировано' : 'Копировать'}</Button><a className="icon-button" href={questionnaire.public_url} target="_blank"><ExternalLink size={18} /></a></Card><div className="questionnaire-list"><div className="section-title"><div><span className="overline">Конструктор</span><h3>Вопросы анкеты</h3></div><span>{questionnaire.items.length} вопросов</span></div>{questionnaire.items.map((item, index) => <Card key={item.id} className="questionnaire-item"><span className="item-number">{index + 1}</span><div><b>{item.text}</b>{item.response ? <blockquote>«{item.response}»</blockquote> : <small>Ответа пока нет</small>}</div>{item.response && <Button variant="secondary" onClick={() => void convert(item)} disabled={busy === item.id}>{busy === item.id ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />} Создать вопрос</Button>}</Card>)}<Card className="add-inline"><input value={newItem} onChange={e => setNewItem(e.target.value)} placeholder="Добавить свой вопрос герою…" onKeyDown={e => e.key === 'Enter' && void add()} /><Button onClick={() => void add()} disabled={!newItem.trim() || busy === 'new'}><Plus size={18} /> Добавить</Button></Card></div></div>
}

const questionTypeLabels: Record<string, string> = { single: 'Один вариант', multiple: 'Несколько вариантов', text: 'Свободный текст', number: 'Число с допуском', closest: 'Кто ближе', hero_choice: 'Выбор героя' }

function EditorPanel({ event, onChanged }: { event: EventData; onChanged: () => void }) {
  const allQuestions = event.rounds.flatMap(round => round.questions)
  const hasNewDraft = Boolean(localStorage.getItem(`question_draft_${event.id}_new`))
  const [selected, setSelected] = useState<Question | null>(hasNewDraft ? null : allQuestions[0] || null)
  const [creating, setCreating] = useState(hasNewDraft)
  const [addingPresets, setAddingPresets] = useState(false)
  const [presetError, setPresetError] = useState('')
  const presetCount = Math.min(5, 15 - event.question_count)
  const remove = async (id: string) => {
    if (!confirm('Удалить вопрос?')) return
    await api.deleteQuestion(id)
    localStorage.removeItem(`question_draft_${event.id}_${id}`)
    setSelected(null)
    onChanged()
  }
  const addPresets = async () => {
    if (!presetCount || !confirm(`Добавить ${presetCount} готовых вопросов для проверки игры? Их можно будет изменить или удалить.`)) return
    setAddingPresets(true)
    setPresetError('')
    try {
      const existingIds = new Set(allQuestions.map(question => question.id))
      const updated = await api.addQuestionPresets(event.id)
      const firstCreated = updated.rounds.flatMap(round => round.questions).find(question => !existingIds.has(question.id))
      setSelected(firstCreated || null)
      setCreating(false)
      onChanged()
    } catch (err) {
      setPresetError(err instanceof Error ? err.message : 'Не удалось добавить заготовки')
    } finally {
      setAddingPresets(false)
    }
  }
  return <div className="editor-layout"><aside className="question-list"><div className="section-title"><div><span className="overline">Редактор</span><h2>Вопросы</h2></div><Badge tone={event.question_count >= 15 ? 'warning' : 'neutral'}>{event.question_count}/15</Badge></div><div className="preset-box"><div><Sparkles size={18} /><span><b>Быстрый тест</b><small>Готовые вопросы разных типов</small></span></div><Button variant="secondary" disabled={!presetCount || addingPresets} onClick={() => void addPresets()}>{addingPresets ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} {presetCount ? `Добавить ${presetCount}` : 'Лимит достигнут'}</Button>{presetError && <small className="form-error">{presetError}</small>}</div>{event.rounds.map(round => <div className="round-group" key={round.id}><h4>{round.title}</h4>{round.questions.map((question, index) => <button key={question.id} className={selected?.id === question.id && !creating ? 'active' : ''} onClick={() => { setSelected(question); setCreating(false) }}><span>{index + 1}</span><div><b>{question.text}</b><small>{questionTypeLabels[question.type]} · {question.time_limit_seconds} сек.</small></div><ChevronRight /></button>)}</div>)}<Button variant="secondary" className="add-question" disabled={event.question_count >= 15} onClick={() => { setSelected(null); setCreating(true) }}><Plus size={18} /> Добавить вопрос</Button></aside><div className="question-workspace">{selected || creating ? <QuestionForm key={selected?.id || 'new'} event={event} question={selected} onSaved={saved => { setSelected(saved); setCreating(false); onChanged() }} onDelete={selected ? () => void remove(selected.id) : undefined} /> : <Empty icon="?" title="Выберите вопрос" text="Здесь можно настроить текст, ответы, таймер и пояснение." />}</div></div>
}

function questionFormDefaults(event: EventData, question: Question | null) {
  const defaultOptions = [0, 1, 2, 3].map(() => ({ id: createId(), text: '', is_correct: false }))
  return { round_id: question?.round_id || event.rounds[0]?.id, round_title: 'Раунд 1', type: question?.type || 'single', text: question?.text || '', time_limit_seconds: question?.time_limit_seconds || 30, correct_answer: question?.correct_answer ?? null, accepted_answers: question?.accepted_answers || [], numeric_tolerance: question?.numeric_tolerance ?? 0, shuffle_options: question?.shuffle_options || false, explanation: question?.explanation || '', media_url: question?.media_url || null, media_type: question?.media_type || null, audio_replays: question?.audio_replays || 1, options: question?.options?.length ? question.options : defaultOptions }
}

function QuestionForm({ event, question, onSaved, onDelete }: { event: EventData; question: Question | null; onSaved: (saved: Question) => void; onDelete?: () => void }) {
  const draftKey = `question_draft_${event.id}_${question?.id || 'new'}`
  const [hasDraft, setHasDraft] = useState(() => Boolean(localStorage.getItem(draftKey)))
  const [form, setForm] = useState<any>(() => {
    const fallback = questionFormDefaults(event, question)
    try { return JSON.parse(localStorage.getItem(draftKey) || '') || fallback } catch { return fallback }
  })
  const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [uploading, setUploading] = useState(false)
  const firstRender = useRef(true)
  const skipNextDraft = useRef(false)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    if (skipNextDraft.current) { skipNextDraft.current = false; return }
    localStorage.setItem(draftKey, JSON.stringify(form))
    setHasDraft(true)
  }, [draftKey, form])
  const optionMode = ['single', 'multiple', 'hero_choice'].includes(form.type)
  const setCorrect = (id: string) => {
    if (form.type === 'multiple') { const current = new Set(form.correct_answer || []); current.has(id) ? current.delete(id) : current.add(id); setForm({ ...form, correct_answer: [...current], options: form.options.map((o: any) => ({ ...o, is_correct: current.has(o.id) })) }) }
    else setForm({ ...form, correct_answer: id, options: form.options.map((o: any) => ({ ...o, is_correct: o.id === id })) })
  }
  const save = async () => { setSaving(true); setError(''); try { const payload = { ...form, accepted_answers: typeof form.accepted_answers === 'string' ? form.accepted_answers.split(',').map((x: string) => x.trim()).filter(Boolean) : form.accepted_answers, correct_answer: ['number', 'closest'].includes(form.type) ? Number(form.correct_answer) : form.correct_answer }; const saved = question ? await api.updateQuestion(question.id, payload) : await api.createQuestion(event.id, payload); localStorage.removeItem(draftKey); setHasDraft(false); onSaved(saved) } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сохранить вопрос') } finally { setSaving(false) } }
  const resetDraft = () => { skipNextDraft.current = true; localStorage.removeItem(draftKey); setForm(questionFormDefaults(event, question)); setHasDraft(false); setError('') }
  const upload = async (file?: File) => { if (!file) return; setUploading(true); try { const media = await api.upload(event.id, file); setForm({ ...form, media_url: media.url, media_type: media.type }) } finally { setUploading(false) } }
  return <Card className="question-form"><div className="form-heading"><div><span className="overline">{question ? 'Настройка вопроса' : 'Новый вопрос'}</span><h2>{question ? 'Редактирование' : 'Добавьте вопрос'}</h2></div><div>{hasDraft && !saving && <span className="draft-state"><Check size={14} /> Черновик сохранён</span>}{hasDraft && <Button variant="ghost" onClick={resetDraft}>Сбросить</Button>}{onDelete && <Button variant="ghost" onClick={onDelete}><Trash2 size={17} /> Удалить</Button>}<SaveState loading={saving} saved={Boolean(question) && !hasDraft} /></div></div><div className="form-grid two"><Field label="Раунд"><select value={form.round_id} onChange={e => setForm({ ...form, round_id: e.target.value })}>{event.rounds.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></Field><Field label="Тип вопроса"><select value={form.type} onChange={e => setForm({ ...form, type: e.target.value, correct_answer: null })}>{Object.entries(questionTypeLabels).filter(([value]) => event.event_format === 'celebration' || value !== 'hero_choice').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div><Field label="Текст вопроса"><textarea rows={3} value={form.text} onChange={e => setForm({ ...form, text: e.target.value })} placeholder={event.event_format === 'battle' ? 'Какой вопрос решит исход баттла?' : 'Что друзья точно должны знать?'} /></Field>
    {optionMode && <div className="options-editor"><div className="field-label"><span>Варианты ответа</span><small>{form.type === 'multiple' ? 'Отметьте все правильные' : form.type === 'hero_choice' ? 'Герой выберет правильный в эфире' : 'Отметьте один правильный'}</small></div>{form.options.map((option: any, index: number) => <div className="option-edit" key={option.id}><button className={`correct-toggle ${form.type === 'hero_choice' ? 'hidden' : option.is_correct ? 'selected' : ''}`} onClick={() => setCorrect(option.id)} aria-label="Правильный вариант">{option.is_correct ? <Check /> : String.fromCharCode(65 + index)}</button><input value={option.text} onChange={e => setForm({ ...form, options: form.options.map((o: any) => o.id === option.id ? { ...o, text: e.target.value } : o) })} placeholder={`Вариант ${index + 1}`} />{form.options.length > 2 && <button className="icon-button" onClick={() => setForm({ ...form, options: form.options.filter((o: any) => o.id !== option.id) })}><Trash2 size={16} /></button>}</div>)}{form.options.length < 6 && <button className="text-button" onClick={() => setForm({ ...form, options: [...form.options, { id: createId(), text: '', is_correct: false }] })}><Plus size={16} /> Ещё вариант</button>}</div>}
    {form.type === 'text' && <><Field label="Правильный ответ"><input value={form.correct_answer || ''} onChange={e => setForm({ ...form, correct_answer: e.target.value })} /></Field><Field label="Синонимы" hint="Разделите запятыми"><input value={Array.isArray(form.accepted_answers) ? form.accepted_answers.join(', ') : form.accepted_answers} onChange={e => setForm({ ...form, accepted_answers: e.target.value })} placeholder="Питер, СПб" /></Field></>}
    {['number', 'closest'].includes(form.type) && <div className="form-grid two"><Field label="Правильное число"><input type="number" value={form.correct_answer ?? ''} onChange={e => setForm({ ...form, correct_answer: e.target.value })} /></Field>{form.type === 'number' && <Field label="Допуск ±"><input type="number" min="0" value={form.numeric_tolerance} onChange={e => setForm({ ...form, numeric_tolerance: Number(e.target.value) })} /></Field>}</div>}
    <div className="form-grid two"><Field label="Время на ответ"><div className="range-field"><input type="range" min="5" max="90" step="5" value={form.time_limit_seconds} onChange={e => setForm({ ...form, time_limit_seconds: Number(e.target.value) })} /><b>{form.time_limit_seconds} сек.</b></div></Field><label className="check-row compact"><input type="checkbox" checked={form.shuffle_options} onChange={e => setForm({ ...form, shuffle_options: e.target.checked })} /><span><b>Перемешивать варианты</b><small>Отдельно для каждого игрока</small></span></label></div><Field label="Пояснение после раскрытия"><textarea rows={2} value={form.explanation} onChange={e => setForm({ ...form, explanation: e.target.value })} placeholder="Добавьте историю или интересную деталь…" /></Field><div className="media-upload"><div><Upload size={20} /><span><b>{form.media_url ? 'Медиа добавлено' : 'Фото или аудио'}</b><small>JPG, PNG, WebP, MP3, M4A, OGG · до 25 МБ</small></span></div><label className="button button-secondary">{uploading ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />} Выбрать<input type="file" accept="image/jpeg,image/png,image/webp,audio/mpeg,audio/mp4,audio/ogg" hidden onChange={e => void upload(e.target.files?.[0])} /></label></div>{error && <p className="form-error">{error}</p>}<div className="form-actions"><Button onClick={() => void save()} disabled={saving || !form.text.trim()}><Save size={18} /> Сохранить вопрос</Button></div></Card>
}

function RehearsalPanel({ event, session, onOpen }: { event: EventData; session: Snapshot | null; onOpen: () => void }) {
  const connection = useGameStore(s => s.connection); const latency = useGameStore(s => s.latency); const [sound, setSound] = useState(false); const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement))
  const testSound = () => { const ctx = new AudioContext(); const oscillator = ctx.createOscillator(); const gain = ctx.createGain(); oscillator.connect(gain); gain.connect(ctx.destination); oscillator.frequency.value = 660; gain.gain.setValueAtTime(.12, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .35); oscillator.start(); oscillator.stop(ctx.currentTime + .35); setSound(true) }
  const full = async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); setFullscreen(Boolean(document.fullscreenElement)) }
  const checks = [{ title: 'Сервер и WebSocket', value: connection === 'online' ? `Готово · ${latency ?? '—'} мс` : 'Откройте комнату', ok: connection === 'online', icon: Wifi }, { title: 'Телевизионный экран', value: fullscreen ? 'Fullscreen доступен' : 'Нужно проверить', ok: fullscreen, icon: Monitor }, { title: 'Звук устройства', value: sound ? 'Звук воспроизводится' : 'Нужно разрешение', ok: sound, icon: Headphones }, { title: 'Вопросы и медиа', value: `${event.question_count} вопросов готовы`, ok: event.question_count > 0, icon: BookOpenText }]
  return <div className="content-stack"><section className="page-heading"><div><Badge tone="accent"><Gauge size={14} /> Обязательная проверка</Badge><h2>Репетиция перед игрой</h2><p>Пройдите проверку с теми же устройствами и Wi-Fi, которые будут во время игры.</p></div>{!session && <Button onClick={onOpen}><Play size={18} /> Открыть тестовую комнату</Button>}</section><div className="rehearsal-grid">{checks.map(check => <Card key={check.title} className="check-card"><span className={check.ok ? 'ok' : ''}><check.icon /></span><div><b>{check.title}</b><small>{check.value}</small></div>{check.ok ? <Check className="checkmark" /> : <Badge tone="warning">Проверить</Badge>}</Card>)}</div><Card className="device-test"><div className="card-title"><div><span className="overline">Тест устройства</span><h3>Организатор и телевизор</h3></div><Badge tone={checks.every(x => x.ok) ? 'success' : 'warning'}>{checks.filter(x => x.ok).length} из {checks.length}</Badge></div><div className="test-actions"><button onClick={() => void full()}><Monitor /><span><b>Полноэкранный режим</b><small>{fullscreen ? 'Проверен' : 'Открывается только по нажатию'}</small></span><ChevronRight /></button><button onClick={testSound}><Headphones /><span><b>Проверить звук</b><small>{sound ? 'Сигнал прозвучал' : 'Нажмите и подтвердите воспроизведение'}</small></span><ChevronRight /></button>{session && <a href={`/screen/${session.session.join_code}`} target="_blank"><ExternalLink /><span><b>Открыть экран телевизора</b><small>В новом окне</small></span><ChevronRight /></a>}</div></Card>{session && <Card><div className="section-title"><div><span className="overline">Подключённые устройства</span><h3>Готовность игроков</h3></div><span>{session.participants.filter(p => p.ready).length}/{session.participants.length}</span></div><div className="device-list">{session.participants.length ? session.participants.map(p => <div key={p.id}><span className={`avatar ${p.ready ? 'ready' : ''}`}>{p.avatar}</span><div><b>{p.name}</b><small>{p.latency_ms ? `${p.latency_ms} мс` : 'Проверка не пройдена'}</small></div><Badge tone={p.ready ? 'success' : 'warning'}>{p.ready ? 'Готов' : 'Ждём'}</Badge></div>) : <Empty title="Пока никого" text="Откройте ссылку игрока на телефоне и пройдите проверку." />}</div></Card>}</div>
}

function LivePanel({ event, session, onOpen }: { event: EventData; session: Snapshot | null; onOpen: () => void }) {
  const connection = useGameStore(s => s.connection); const latency = useGameStore(s => s.latency); const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [transfers, setTransfers] = useState<any[]>([])
  useEffect(() => { if (session?.session.join_code) api.transferRequests(session.session.join_code).then(setTransfers).catch(() => undefined) }, [session?.session.join_code, session?.version])
  if (!session) return <div className="center-panel"><Empty icon="◉" title="Комната ещё не открыта" text="Откройте эфир — появится код и ссылки для гостей и телевизора." /><Button onClick={onOpen}><Play size={18} /> Открыть комнату</Button></div>
  const code = session.session.join_code; const status = session.session.status; const q = session.question
  const act = async (action: string) => { setBusy(action); setError(''); try { const next = await api.action(code, action); useGameStore.setState({ snapshot: next }) } catch (err) { setError(err instanceof Error ? err.message : 'Команда не выполнена') } finally { setBusy('') } }
  const primary = status === 'lobby' ? ['start_game', 'Подготовить вопрос'] : status === 'countdown' ? ['start', 'Начать таймер'] : status === 'answering' ? ['lock', 'Закрыть ответы'] : ['locked', 'review'].includes(status) ? ['reveal', 'Показать ответ'] : status === 'reveal' || status === 'cancelled' ? ['next', session.session.current_question_index + 1 >= session.session.question_count ? 'Показать финал' : 'Следующий вопрос'] : null
  const joinUrl = `${location.origin}/join/${code}`
  return <div className="live-layout"><div className="live-main"><section className="page-heading compact"><div><div className="live-title"><span className="broadcast-dot" /> Эфир · {statusLabel(status)}</div><h2>{q ? q.text : 'Гости подключаются'}</h2><p>{q ? `${q.round_title} · Вопрос ${session.session.current_question_index + 1} из ${session.session.question_count}` : `${participantCountLabel(session.participants.length)} в комнате`}</p></div><ConnectionPill state={connection} latency={latency} mode={session.session.deployment_mode} /></section>{q ? <Card className="control-question"><div className="question-control-top"><Badge tone="accent">{questionTypeLabels[q.type] || q.type}</Badge>{status === 'answering' && <Timer deadline={session.session.deadline_at} total={q.time_limit_seconds} />}</div><h3>{q.text}</h3>{q.options.length > 0 && <div className="control-options">{q.options.map((o, i) => <div key={o.id}><i>{String.fromCharCode(65 + i)}</i>{o.text}</div>)}</div>}<div className="answer-progress"><div><span>Ответило</span><b>{session.session.answered_count} из {event.game_mode === 'team' ? session.teams.length : session.participants.filter(p => p.role !== 'hero').length}</b></div><div className="progress-line"><i style={{ width: `${session.participants.length ? (session.session.answered_count / Math.max(1, event.game_mode === 'team' ? session.teams.length : session.participants.length)) * 100 : 0}%` }} /></div></div></Card> : <Card className="lobby-control"><div className="mini-qr"><QRCodeSVG value={joinUrl} size={128} bgColor="transparent" fgColor="#f6f0e8" /></div><div><span>Код комнаты</span><strong>{code}</strong><p>Покажите QR-код на телевизоре или отправьте ссылку гостям.</p></div><a className="button button-secondary" href={`/screen/${code}`} target="_blank"><Monitor size={18} /> Экран</a></Card>}
    <Card className="control-deck"><span className="overline">Управление игрой</span>{error && <p className="form-error">{error}</p>}<div className="primary-control">{primary && <Button onClick={() => void act(primary[0])} disabled={Boolean(busy)}>{busy === primary[0] ? <LoaderCircle className="spin" /> : <Play />} {primary[1]}</Button>}{status === 'paused' && <Button onClick={() => void act('resume')}><Play /> Продолжить</Button>}</div><div className="secondary-controls"><Button variant="secondary" onClick={() => void act(status === 'paused' ? 'resume' : 'pause')} disabled={!['answering', 'paused'].includes(status)}>{status === 'paused' ? <Play /> : <span className="pause-icon">Ⅱ</span>} {status === 'paused' ? 'Продолжить' : 'Пауза'}</Button><Button variant="secondary" onClick={() => void act('cancel')} disabled={!['countdown', 'answering', 'locked', 'review'].includes(status)}><Archive /> Отменить вопрос</Button><Button variant="danger" onClick={() => confirm('Завершить игру и показать рейтинг?') && void act('finish')} disabled={status === 'finished'}><PartyPopper /> Завершить игру</Button></div></Card></div>
    <aside className="live-side">{transfers.length > 0 && <Card className="transfer-requests"><span className="overline">Перенос устройства</span>{transfers.map(item => <div key={item.id}><span className="avatar">{item.avatar}</span><b>{item.name}</b><Button variant="secondary" onClick={async () => { await api.approveTransfer(code, item.id); setTransfers(rows => rows.filter(row => row.id !== item.id)) }}><Check /> Разрешить</Button></div>)}</Card>}<Card><div className="section-title"><div><span className="overline">Участники</span><h3>{session.participants.length} в комнате</h3></div><Users /></div><div className="participant-stack">{session.participants.map(p => <div key={p.id}><span className="avatar">{p.avatar}</span><div><b>{p.name}</b><small>{p.role === 'hero' ? 'Герой' : p.ready ? 'Готов' : 'Подключается'}</small></div><span className={`presence ${p.connection_status}`} /></div>)}</div></Card><Card className="quick-links"><span className="overline">Быстрые ссылки</span><a href={`/screen/${code}`} target="_blank"><Monitor /> Телевизор <ExternalLink /></a><a href={`/join/${code}`} target="_blank"><Smartphone /> Игрок <ExternalLink /></a>{event.event_format === 'celebration' && <a href={`/join/${code}?hero=1`} target="_blank"><Crown /> Герой <ExternalLink /></a>}<button onClick={() => navigator.clipboard.writeText(joinUrl)}><Copy /> Скопировать ссылку</button></Card></aside></div>
}

function statusLabel(status: string) { return ({ lobby: 'Лобби', countdown: 'Подготовка', answering: 'Принимаем ответы', locked: 'Ответы закрыты', review: 'Проверка ответов', reveal: 'Ответ раскрыт', paused: 'Пауза', cancelled: 'Вопрос отменён', finished: 'Финал' } as Record<string, string>)[status] || status }

function ResultsPanel({ session }: { session: Snapshot | null }) {
  const [results, setResults] = useState<any>(null); const [loading, setLoading] = useState(false)
  useEffect(() => { if (session?.session.join_code) { setLoading(true); api.results(session.session.join_code).then(setResults).finally(() => setLoading(false)) } }, [session?.session.join_code, session?.version])
  if (!session) return <Empty icon="♜" title="История пока пуста" text="После первой открытой комнаты здесь появятся участники и ответы." />
  if (loading && !results) return <div className="center-panel"><LoaderCircle className="spin" /></div>
  const ranking = results?.leaderboard || []
  return <div className="content-stack"><section className="page-heading"><div><Badge tone={session.session.status === 'finished' ? 'success' : 'neutral'}>{session.session.status === 'finished' ? 'Игра завершена' : 'Предварительные данные'}</Badge><h2>Результаты игры</h2><p>Правильность важнее скорости. При равенстве сравнивается суммарное время правильных ответов.</p></div></section>{ranking.length ? <Card className="results-table"><div className="table-row table-head"><span>Место</span><span>Игрок</span><span>Верно</span><span>Время</span></div>{ranking.map((row: any) => <div className="table-row" key={row.id}><strong>{row.rank}</strong><span className="player-cell"><i>{row.avatar}</i><b>{row.name}</b></span><span>{row.correct_count}</span><span>{formatTime(row.correct_time_ms)}</span></div>)}</Card> : <Empty icon="✦" title="Ответов ещё нет" text="Рейтинг заполнится после раскрытия вопросов." />}{results?.submissions?.length > 0 && <Card><div className="section-title"><div><span className="overline">Журнал</span><h3>Все ответы</h3></div></div><div className="submission-list">{results.submissions.map((row: any) => <div key={row.id}><span className={row.is_correct ? 'answer-ok' : 'answer-no'}>{row.is_correct ? '✓' : '×'}</span><div><b>{row.name}</b><small>{row.question}</small></div><code>{String(row.answer ?? 'Пропуск')}</code><span>{formatTime(row.elapsed_ms)}</span></div>)}</div></Card>}</div>
}
