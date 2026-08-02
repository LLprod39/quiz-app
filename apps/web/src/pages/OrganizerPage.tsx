import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Archive, ArrowLeft, ArrowRight, BarChart3, BookOpenText, Check, ChevronRight, CircleHelp, ClipboardList, Copy, Crown, ExternalLink, Gamepad2, Gauge, Headphones, History, LayoutDashboard, Library, Link2, LoaderCircle, LogOut, Monitor, MoreVertical, PartyPopper, Pencil, Play, Plus, QrCode, Radio, RotateCcw, Save, Send, Settings2, Smartphone, Sparkles, Trash2, Upload, Users, Wifi } from 'lucide-react'
import { Link } from '../lib/router'
import { QRCodeSVG } from 'qrcode.react'
import { api, ApiError } from '../lib/api'
import { createId } from '../lib/id'
import { DEFAULT_BRANDING, THEME_PRESETS, themeStyle, useBranding } from '../lib/branding'
import { useGameStore } from '../store/game'
import type { EventData, Question, QuestionnaireItem, QuizPack, Snapshot, ThemeConfig } from '../types'
import { Badge, Button, Card, ConnectionPill, Empty, Field, Logo, SaveState, formatTime } from '../components/ui'
import { Timer } from '../components/Timer'
import { QuizPackCard } from './QuizCatalogPage'

type Tab = 'overview' | 'quizzes' | 'catalog' | 'settings' | 'questionnaire' | 'editor' | 'rehearsal' | 'live' | 'history'
const MAX_QUESTIONS = 50

const nav: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Главная', icon: LayoutDashboard },
  { id: 'quizzes', label: 'Мои квизы', icon: Library },
  { id: 'catalog', label: 'Каталог шаблонов', icon: BookOpenText },
  { id: 'settings', label: 'Настройки', icon: Settings2 },
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
  const { refreshBranding } = useBranding()
  const [authenticated, setAuthenticated] = useState(Boolean(localStorage.getItem('admin_token')))
  const [events, setEvents] = useState<EventData[]>([])
  const [event, setEvent] = useState<EventData | null>(null)
  const [creatingEvent, setCreatingEvent] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [session, setSession] = useState<Snapshot | null>(null)
  const storeSnapshot = useGameStore(s => s.snapshot)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const items = await api.events()
      setEvents(items)
      const activeEvent = items.find(item => item.is_selected && item.status !== 'archived') || items.find(item => item.status !== 'archived') || null
      setEvent(activeEvent)
      setTab(current => activeEvent?.event_format === 'battle' && current === 'questionnaire' ? 'overview' : current)
      const roomCode = activeEvent?.active_session_code || activeEvent?.latest_session_code
      if (roomCode) {
        const snap = await api.snapshot(roomCode); setSession(snap)
        if (activeEvent?.active_session_code) useGameStore.getState().connect(roomCode)
        else useGameStore.getState().disconnect()
      } else { setSession(null); useGameStore.getState().disconnect() }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { localStorage.removeItem('admin_token'); setAuthenticated(false) }
      else setError(err instanceof Error ? err.message : 'Не удалось загрузить данные')
    } finally { setLoading(false) }
  }
  useEffect(() => { if (authenticated) void load(); else setLoading(false) }, [authenticated])
  useEffect(() => { if (storeSnapshot) setSession(storeSnapshot) }, [storeSnapshot])

  if (!authenticated) return <LoginPanel onDone={() => setAuthenticated(true)} />
  if (loading) return <div className="center-screen"><LoaderCircle className="spin" size={32} /><p>Готовим панель…</p></div>
  if (creatingEvent || !event) return <CreateEventPanel onCreated={async () => { setCreatingEvent(false); await refreshBranding(); await load() }} onLogout={() => { localStorage.removeItem('admin_token'); setAuthenticated(false) }} onCancel={event ? () => setCreatingEvent(false) : undefined} />

  const logout = () => { localStorage.removeItem('admin_token'); setAuthenticated(false) }
  const eventNav = nav.filter(item => event.event_format === 'celebration' || item.id !== 'questionnaire')
  const mobileNav = eventNav.filter(item => ['overview', 'quizzes', 'editor', 'live', 'history'].includes(item.id))
  const selectEvent = async (eventId: string) => { await api.selectEvent(eventId); await refreshBranding(); await load(); setTab('overview') }
  const reloadWithBranding = async () => { await refreshBranding(); await load() }
  const openRoom = async () => {
    try { const snap = await api.openSession(event.id); setSession(snap); useGameStore.getState().connect(snap.session.join_code); setTab('live') }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось открыть комнату') }
  }

  return <div className="admin-shell" style={{ '--accent': event.theme.accent } as React.CSSProperties}>
    <aside className="admin-sidebar">
      <Logo />
      <nav>{eventNav.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon size={20} /><span>{item.label}</span>{item.id === 'live' && event.active_session_code && <i className="live-dot" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="mode-block"><span className="status-dot" /><div><b>{session?.session.deployment_mode === 'cloud' ? 'Облачный режим' : 'Локальный режим'}</b><small>Сервер доступен</small></div></div><button onClick={logout}><LogOut size={19} /> Выйти</button></div>
    </aside>
    <div className="admin-main">
      <header className="admin-topbar"><button className="mobile-logo" onClick={() => setTab('overview')}><Logo compact /></button><button className="current-quiz-switch" onClick={() => setTab('quizzes')}><span className="crumb">Выбранный квиз · {events.filter(item => item.status !== 'archived').length} в библиотеке</span><h1>{event.title} <ChevronRight size={15} /></h1></button><div className="top-actions">{event.active_session_code && session && <Badge tone="success"><Radio size={13} /> Комната {session.session.join_code}</Badge>}<Button variant="secondary" onClick={() => void load()}><Activity size={17} /> Обновить</Button></div></header>
      {error && <div className="error-banner">{error}<button onClick={() => setError('')}>×</button></div>}
      <main className="admin-content">
        {tab === 'overview' && <Overview event={event} session={session} onOpen={openRoom} onTab={setTab} onChanged={reloadWithBranding} />}
        {tab === 'quizzes' && <MyQuizzesPanel events={events} current={event} onSelect={selectEvent} onCreate={() => setCreatingEvent(true)} onChanged={reloadWithBranding} />}
        {tab === 'catalog' && <PackCatalogPanel onInstalled={async () => { await refreshBranding(); await load(); setTab('overview') }} />}
        {tab === 'settings' && <SettingsPanel event={event} onChanged={load} />}
        {tab === 'questionnaire' && event.questionnaire && <QuestionnairePanel event={event} onChanged={load} />}
        {tab === 'editor' && <EditorPanel event={event} onChanged={load} />}
        {tab === 'rehearsal' && <RehearsalPanel event={event} session={session} onOpen={openRoom} />}
        {tab === 'live' && <LivePanel event={event} session={session} onOpen={openRoom} onResults={() => setTab('history')} onChanged={load} />}
        {tab === 'history' && <ResultsPanel event={event} session={session} onReplay={openRoom} />}
      </main>
      <nav className="mobile-tabs">{mobileNav.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon size={20} /><span>{item.label}</span></button>)}</nav>
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

function CreateEventPanel({ onCreated, onLogout, onCancel }: { onCreated: () => void; onLogout: () => void; onCancel?: () => void }) {
  const [form, setForm] = useState({
    title: '', event_format: 'celebration' as EventData['event_format'], topic: '', hero_name: '', event_date: new Date().toISOString().slice(0, 10),
    game_mode: 'individual', host_mode: 'auto' as const, auto_advance_seconds: 5, allow_late_join: true, hero_photo_url: null,
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
    <button className="back-link" onClick={onCancel || onLogout}>{onCancel ? <ArrowLeft size={17} /> : <LogOut size={17} />} {onCancel ? 'Назад к моим квизам' : 'Выйти'}</button>
    <Card className="login-card create-event-card"><Logo /><div className="login-intro"><Badge tone="accent">Новое мероприятие</Badge><h1>{form.event_format === 'battle' ? 'На какую тему играем?' : 'Кого сегодня празднуем?'}</h1><p>{form.event_format === 'battle' ? 'Создайте тематическую игру — первый раунд появится автоматически.' : 'Создайте основу — анкета героя и первый раунд появятся автоматически.'}</p><Link className="catalog-inline-link" to="/quizzes"><BookOpenText size={17} /> Выбрать готовый квиз из каталога <ArrowRight size={16} /></Link></div>
      <form onSubmit={submit} className="form-grid"><Field label="Формат"><select value={form.event_format} onChange={e => { const event_format = e.target.value as EventData['event_format']; setForm({ ...form, event_format, game_mode: event_format === 'battle' ? 'team' : form.game_mode }) }}><option value="celebration">Праздник о человеке</option><option value="battle">Тематический квиз-баттл</option></select></Field><Field label="Название"><input required minLength={2} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={form.event_format === 'battle' ? 'Большая битва эрудитов' : 'Вечер в честь…'} /></Field>{form.event_format === 'celebration' ? <Field label="Имя героя"><input required value={form.hero_name} onChange={e => setForm({ ...form, hero_name: e.target.value })} placeholder="Имя" /></Field> : <Field label="Тема баттла"><input required value={form.topic} onChange={e => setForm({ ...form, topic: e.target.value })} placeholder="Кино, музыка, спорт, наука…" /></Field>}<Field label="Дата"><input type="date" value={form.event_date} onChange={e => setForm({ ...form, event_date: e.target.value })} /></Field><Field label="Режим"><select value={form.game_mode} onChange={e => setForm({ ...form, game_mode: e.target.value })}><option value="individual">Личный</option><option value="team">Командный</option></select></Field><Field label="Акцентный цвет"><input type="color" value={form.theme.accent} onChange={e => setForm({ ...form, theme: { ...form.theme, accent: e.target.value } })} /></Field><label className="check-row"><input type="checkbox" checked={form.allow_late_join} onChange={e => setForm({ ...form, allow_late_join: e.target.checked })} /><span><b>Разрешить поздний вход</b><small>Опоздавшие начнут со следующего вопроса</small></span></label>{error && <p className="form-error form-grid-wide">{error}</p>}<Button type="submit" className="form-grid-wide" disabled={busy || !form.title.trim() || (form.event_format === 'celebration' ? !form.hero_name.trim() : !form.topic.trim())}>{busy ? <LoaderCircle className="spin" size={19} /> : <PartyPopper size={19} />} Создать мероприятие</Button></form>
    </Card>
  </main>
}

function Overview({ event, session, onOpen, onTab, onChanged }: { event: EventData; session: Snapshot | null; onOpen: () => void; onTab: (tab: Tab) => void; onChanged: () => void }) {
  const [editing, setEditing] = useState(false); const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: event.title, event_format: event.event_format, topic: event.topic, hero_name: event.hero_name, event_date: event.event_date, game_mode: event.game_mode, host_mode: event.host_mode, auto_advance_seconds: event.auto_advance_seconds, allow_late_join: event.allow_late_join, hero_photo_url: event.hero_photo_url, theme: event.theme })
  const save = async () => { setSaving(true); await api.updateEvent(event.id, form as Partial<EventData>); setSaving(false); setEditing(false); onChanged() }
  const archive = async () => { if (!window.confirm('Перенести квиз в архив? Вопросы, настройки и история игр сохранятся — квиз можно будет восстановить.')) return; setSaving(true); try { await api.archiveEvent(event.id); onChanged() } catch (err) { window.alert(err instanceof Error ? err.message : 'Не удалось архивировать квиз') } finally { setSaving(false) } }
  const progress = Math.min(100, Math.round((event.question_count / 10) * 100))
  return <div className="content-stack">
    <section className="page-heading"><div><Badge tone="accent"><PartyPopper size={14} /> Выбранный квиз</Badge><h2>{event.active_session_code ? 'Игра уже открыта' : event.sessions.length ? 'Можно сыграть ещё раз' : 'Всё готово к первой игре'}</h2><p>{event.active_session_code ? 'Вернитесь в эфир и продолжайте управление комнатой.' : 'Каждый запуск создаёт новую комнату, а этот квиз и его настройки остаются в библиотеке.'}</p></div><Button onClick={event.active_session_code ? () => onTab('live') : onOpen}><Play size={19} /> {event.active_session_code ? 'Перейти в эфир' : event.sessions.length ? 'Играть снова' : 'Открыть комнату'}</Button></section>
    <div className="stats-grid"><Card><span className="metric-icon coral"><CircleHelp /></span><div><strong>{event.question_count}</strong><span>вопросов готово</span></div><button onClick={() => onTab('editor')}>Редактировать <ChevronRight /></button></Card>{event.event_format === 'celebration' ? <Card><span className="metric-icon purple"><ClipboardList /></span><div><strong>{event.questionnaire?.status === 'completed' ? 'Готова' : 'Ждём'}</strong><span>анкета героя</span></div><button onClick={() => onTab('questionnaire')}>Открыть <ChevronRight /></button></Card> : <Card><span className="metric-icon purple"><Gamepad2 /></span><div><strong>Баттл</strong><span>{event.topic}</span></div><button onClick={() => setEditing(true)}>Настроить <ChevronRight /></button></Card>}<Card><span className="metric-icon mint"><Users /></span><div><strong>{session?.participants.length || 0}</strong><span>игроков в комнате</span></div><button onClick={() => onTab('live')}>Посмотреть <ChevronRight /></button></Card></div>
    <div className="overview-grid"><Card className="event-card"><div className="card-title"><div><span className="overline">Карточка события</span><h3>{event.title}</h3></div><div className="event-card-actions"><button className="icon-button" title="Редактировать" onClick={() => setEditing(!editing)}><Pencil size={18} /></button><button className="icon-button danger-icon" title="Архивировать" onClick={() => void archive()} disabled={saving}><Archive size={18} /></button></div></div>{editing ? <div className="form-grid"><Field label="Формат"><select value={form.event_format} onChange={e => setForm({ ...form, event_format: e.target.value as EventData['event_format'] })}><option value="celebration">Праздник о человеке</option><option value="battle">Тематический квиз-баттл</option></select></Field><Field label="Название"><input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field>{form.event_format === 'celebration' ? <Field label="Имя героя"><input value={form.hero_name} onChange={e => setForm({ ...form, hero_name: e.target.value })} /></Field> : <Field label="Тема баттла"><input value={form.topic} onChange={e => setForm({ ...form, topic: e.target.value })} placeholder="Кино, музыка, спорт…" /></Field>}<Field label="Дата"><input type="date" value={form.event_date} onChange={e => setForm({ ...form, event_date: e.target.value })} /></Field><Field label="Режим"><select value={form.game_mode} onChange={e => setForm({ ...form, game_mode: e.target.value })}><option value="individual">Личный</option><option value="team">Командный</option></select></Field><Field label="Акцентный цвет"><input type="color" value={form.theme.accent} onChange={e => setForm({ ...form, theme: { ...form.theme, accent: e.target.value } })} /></Field><label className="check-row"><input type="checkbox" checked={form.allow_late_join} onChange={e => setForm({ ...form, allow_late_join: e.target.checked })} /><span><b>Разрешить поздний вход</b><small>Игрок начнёт со следующего вопроса</small></span></label><div className="form-actions"><Button variant="ghost" onClick={() => setEditing(false)}>Отмена</Button><Button onClick={() => void save()} disabled={saving || !form.title.trim() || (form.event_format === 'celebration' ? !form.hero_name.trim() : !form.topic.trim())}><Save size={17} /> Сохранить</Button></div></div> : <><div className="event-hero-preview"><div className="event-initial">{(event.event_format === 'battle' ? event.topic : event.hero_name).slice(0, 1)}</div><div><span>{event.event_format === 'battle' ? 'Тема квиз-баттла' : 'Герой праздника'}</span><b>{event.event_format === 'battle' ? event.topic : event.hero_name}</b><small>{event.event_date ? new Date(event.event_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Дата не указана'}</small></div></div><div className="event-meta"><span><Gamepad2 /> {event.game_mode === 'team' ? 'Командная игра' : 'Личная игра'}</span><span><Wifi /> Поздний вход {event.allow_late_join ? 'включён' : 'выключен'}</span></div></>}</Card>
      <Card className="readiness-card"><div className="card-title"><div><span className="overline">Готовность</span><h3>До старта — три шага</h3></div><b>{progress}%</b></div><div className="progress-line"><i style={{ width: `${progress}%` }} /></div><button className="check-step done" onClick={() => event.event_format === 'celebration' ? onTab('questionnaire') : setEditing(true)}><Check /><span><b>Оформить мероприятие</b><small>{event.event_format === 'battle' ? 'Название, тема и режим готовы' : 'Имя, дата и тема готовы'}</small></span><ChevronRight /></button><button className={`check-step ${event.question_count >= 3 ? 'done' : ''}`} onClick={() => onTab('editor')}><Check /><span><b>Подготовить вопросы</b><small>{event.question_count} добавлено · рекомендуем от 10</small></span><ChevronRight /></button><button className="check-step" onClick={() => onTab('rehearsal')}><Check /><span><b>Провести репетицию</b><small>Экран, звук и телефоны</small></span><ChevronRight /></button></Card></div>
  </div>
}

function MyQuizzesPanel({ events, current, onSelect, onCreate, onChanged }: { events: EventData[]; current: EventData; onSelect: (eventId: string) => Promise<void>; onCreate: () => void; onChanged: () => Promise<void> | void }) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const saved = events.filter(item => item.status !== 'archived')
  const archived = events.filter(item => item.status === 'archived')
  const choose = async (eventId: string) => { setBusy(eventId); setError(''); try { await onSelect(eventId) } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось открыть квиз') } finally { setBusy('') } }
  const archive = async (item: EventData) => {
    if (!window.confirm(`Перенести «${item.title}» в архив? Все вопросы, настройки и результаты останутся сохранены.`)) return
    setBusy(item.id); setError('')
    try { await api.archiveEvent(item.id); await onChanged() } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось архивировать квиз') } finally { setBusy('') }
  }
  const restore = async (item: EventData) => { setBusy(item.id); setError(''); try { await api.restoreEvent(item.id); await onSelect(item.id) } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось восстановить квиз') } finally { setBusy('') } }
  return <div className="content-stack my-quizzes-panel"><section className="page-heading"><div><Badge tone="accent"><Library size={14} /> Постоянная библиотека</Badge><h2>Мои квизы</h2><p>Настройки и вопросы каждого квиза сохраняются. Открывайте любой из них и создавайте новую игровую комнату столько раз, сколько нужно.</p></div><div className="quiz-library-actions"><Button variant="secondary" onClick={() => onSelect(current.id)} disabled><Check size={17} /> Выбран: {current.title}</Button><Button onClick={onCreate}><Plus size={18} /> Новый квиз</Button></div></section>{error && <p className="form-error">{error}</p>}<section className="saved-quiz-grid">{saved.map(item => <Card key={item.id} className={`saved-quiz-card ${item.id === current.id ? 'selected' : ''}`} style={themeStyle(item.theme)}><div className="saved-quiz-head"><span className="saved-quiz-mark">{item.theme.logo_mark || (item.topic || item.hero_name || item.title).slice(0, 2)}</span><div>{item.id === current.id && <Badge tone="success"><Check size={12} /> Выбран</Badge>}<Badge tone="neutral">{item.event_format === 'battle' ? 'Квиз-баттл' : 'Праздник'}</Badge></div></div><span className="quiz-pack-topic">{item.event_format === 'battle' ? item.topic : `О ${item.hero_name}`}</span><h3>{item.title}</h3><div className="saved-quiz-stats"><span><CircleHelp /> <b>{item.question_count}</b><small>вопросов</small></span><span><Play /> <b>{item.sessions.length}</b><small>игр</small></span><span><Users /> <b>{item.sessions.reduce((sum, game) => sum + game.participant_count, 0)}</b><small>участников</small></span></div>{item.sessions.length > 0 && <p className="saved-quiz-last">Последняя комната: <b>{item.sessions[0].join_code}</b> · {item.sessions[0].status === 'finished' ? 'завершена' : 'в процессе'}</p>}<div className="saved-quiz-actions"><Button onClick={() => void choose(item.id)} disabled={Boolean(busy) || item.id === current.id}>{busy === item.id ? <LoaderCircle className="spin" /> : item.id === current.id ? <Check /> : <ChevronRight />} {item.id === current.id ? 'Открыт' : 'Выбрать'}</Button><button className="icon-button danger-icon" title="Перенести в архив" onClick={() => void archive(item)} disabled={Boolean(busy)}><Archive size={17} /></button></div></Card>)}</section>{archived.length > 0 && <section className="quiz-archive"><div className="section-title"><div><span className="overline">Можно восстановить</span><h3>Архив</h3></div><Badge>{archived.length}</Badge></div>{archived.map(item => <Card key={item.id}><span className="saved-quiz-mark muted">{item.theme.logo_mark || 'Q'}</span><div><b>{item.title}</b><small>{item.question_count} вопросов · {item.sessions.length} игр</small></div><Button variant="secondary" onClick={() => void restore(item)} disabled={Boolean(busy)}>{busy === item.id ? <LoaderCircle className="spin" /> : <RotateCcw />} Восстановить</Button></Card>)}</section>}</div>
}

function PackCatalogPanel({ onInstalled }: { onInstalled: () => Promise<void> | void }) {
  const { refreshBranding } = useBranding()
  const [packs, setPacks] = useState<QuizPack[]>([])
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { api.quizPacks().then(setPacks).catch(err => setError(err instanceof Error ? err.message : 'Не удалось открыть каталог')).finally(() => setLoading(false)) }, [])
  const install = async (pack: QuizPack) => {
    const confirmed = window.confirm(`Добавить «${pack.title}» в мои квизы? Уже сохранённые квизы останутся в библиотеке.`)
    if (!confirmed) return
    setInstalling(pack.slug); setError('')
    try {
      await api.installQuizPack(pack.slug)
      await refreshBranding()
      await onInstalled()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать тематический квиз')
    } finally { setInstalling('') }
  }
  return <div className="content-stack quiz-library-panel"><section className="page-heading"><div><Badge tone="accent"><BookOpenText size={14} /> Каталог шаблонов</Badge><h2>Добавьте ещё один готовый квиз</h2><p>Шаблон станет новым самостоятельным квизом. Все текущие квизы, их настройки и история игр останутся без изменений.</p></div><Link className="button button-secondary" to="/quizzes" target="_blank">Открыть публичный каталог <ExternalLink size={16} /></Link></section>{error && <p className="form-error">{error}</p>}{loading ? <div className="center-panel"><LoaderCircle className="spin" /></div> : <section className="quiz-pack-grid">{packs.map(pack => <QuizPackCard key={pack.slug} pack={pack} action={<Button onClick={() => void install(pack)} disabled={Boolean(installing)}>{installing === pack.slug ? <LoaderCircle className="spin" /> : <Plus size={16} />} Добавить</Button>} />)}</section>}</div>
}

function SettingsPanel({ event, onChanged }: { event: EventData; onChanged: () => void }) {
  const { refreshBranding } = useBranding()
  const eventForm = () => ({
    title: event.title,
    event_format: event.event_format,
    topic: event.topic,
    hero_name: event.hero_name,
    event_date: event.event_date,
    game_mode: event.game_mode,
    host_mode: event.host_mode,
    auto_advance_seconds: event.auto_advance_seconds,
    allow_late_join: event.allow_late_join,
    hero_photo_url: event.hero_photo_url,
    theme: { ...DEFAULT_BRANDING, ...event.theme },
  })
  const [form, setForm] = useState(eventForm)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setForm(eventForm()) }, [event])

  const updateTheme = <K extends keyof ThemeConfig>(key: K, value: ThemeConfig[K]) => {
    setSaved(false)
    setForm(current => ({ ...current, theme: { ...current.theme, [key]: value, ...(key === 'accent' || key === 'secondary' || key === 'background' || key === 'panel' || key === 'panel_2' || key === 'text' || key === 'muted' ? { theme_preset: 'custom' } : {}) } }))
  }
  const choosePreset = (preset: typeof THEME_PRESETS[number]) => {
    setSaved(false)
    setForm(current => ({ ...current, theme: { ...current.theme, ...preset.colors, theme_preset: preset.id } }))
  }
  const reset = () => { setForm(eventForm()); setSaved(false); setError('') }
  const resetTheme = () => { setForm(current => ({ ...current, theme: { ...current.theme, accent: DEFAULT_BRANDING.accent, secondary: DEFAULT_BRANDING.secondary, background: DEFAULT_BRANDING.background, panel: DEFAULT_BRANDING.panel, panel_2: DEFAULT_BRANDING.panel_2, text: DEFAULT_BRANDING.text, muted: DEFAULT_BRANDING.muted, mode: DEFAULT_BRANDING.mode, decor: DEFAULT_BRANDING.decor, theme_preset: DEFAULT_BRANDING.theme_preset } })); setSaved(false) }
  const canSave = form.title.trim().length >= 2 && (form.event_format === 'celebration' ? Boolean(form.hero_name.trim()) : Boolean(form.topic.trim())) && Boolean(form.theme.brand_name.trim()) && Boolean(form.theme.logo_mark.trim()) && Boolean(form.theme.landing_title.trim())
  const save = async () => {
    if (!canSave) return
    setBusy(true); setError(''); setSaved(false)
    try {
      await api.updateEvent(event.id, form as Partial<EventData>)
      await refreshBranding()
      onChanged()
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить настройки')
    } finally { setBusy(false) }
  }
  const previewStyle = {
    '--accent': form.theme.accent,
    '--secondary': form.theme.secondary,
    '--bg': form.theme.background,
    '--panel': form.theme.panel,
    '--panel-2': form.theme.panel_2,
    '--text': form.theme.text,
    '--muted': form.theme.muted,
  } as React.CSSProperties

  return <div className="content-stack settings-page">
    <section className="page-heading"><div><Badge tone="accent"><Settings2 size={14} /> Настройки квиза</Badge><h2>Все параметры — в одном месте</h2><p>Режим организатора, тексты и оформление сохраняются для этого квиза и применяются на всех устройствах.</p></div><div className="settings-heading-actions"><Button variant="ghost" onClick={reset} disabled={busy}>Отменить изменения</Button><Button onClick={() => void save()} disabled={busy || !canSave}>{busy ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />} Сохранить всё</Button></div></section>
    {error && <p className="form-error">{error}</p>}
    {saved && <div className="success-banner"><Check size={17} /> Настройки сохранены и уже применяются на всех страницах.</div>}
    <div className="settings-layout">
      <div className="settings-fields">
        <Card className="settings-card"><div className="section-title"><div><span className="overline">Бренд</span><h3>Название и знак</h3></div><Badge tone="neutral">Шапка сайта</Badge></div><div className="form-grid"><Field label="Название проекта"><input required maxLength={60} value={form.theme.brand_name} onChange={e => updateTheme('brand_name', e.target.value)} placeholder="Свои знают" /></Field><Field label="Короткий знак" hint="До четырёх символов"><input required maxLength={4} value={form.theme.logo_mark} onChange={e => updateTheme('logo_mark', e.target.value.toUpperCase().slice(0, 4))} placeholder="СЗ" /></Field><Field label="Подпись под названием"><input maxLength={100} value={form.theme.brand_tagline} onChange={e => updateTheme('brand_tagline', e.target.value)} placeholder="викторина для своих" /></Field></div></Card>
        <Card className="settings-card"><div className="section-title"><div><span className="overline">Главная страница</span><h3>Первый экран</h3></div></div><div className="form-grid"><Field label="Строка над заголовком"><input maxLength={160} value={form.theme.landing_eyebrow} onChange={e => updateTheme('landing_eyebrow', e.target.value)} /></Field><Field label="Основной заголовок"><input required maxLength={120} value={form.theme.landing_title} onChange={e => updateTheme('landing_title', e.target.value)} /></Field><Field label="Выделенная строка"><input maxLength={120} value={form.theme.landing_highlight} onChange={e => updateTheme('landing_highlight', e.target.value)} /></Field><Field label="Описание"><textarea rows={4} maxLength={500} value={form.theme.landing_description} onChange={e => updateTheme('landing_description', e.target.value)} /></Field></div></Card>
        <Card className="settings-card"><div className="section-title"><div><span className="overline">Главная страница</span><h3>Кнопки, преимущества и шаги</h3></div></div><div className="form-grid"><Field label="Ссылка для организатора"><input maxLength={60} value={form.theme.organizer_link_label} onChange={e => updateTheme('organizer_link_label', e.target.value)} /></Field><Field label="Подпись к коду комнаты"><input maxLength={60} value={form.theme.join_code_label} onChange={e => updateTheme('join_code_label', e.target.value)} /></Field><Field label="Кнопка входа"><input maxLength={60} value={form.theme.join_button_label} onChange={e => updateTheme('join_button_label', e.target.value)} /></Field><Field label="Преимущество 1"><input maxLength={80} value={form.theme.trust_no_registration} onChange={e => updateTheme('trust_no_registration', e.target.value)} /></Field><Field label="Преимущество 2"><input maxLength={80} value={form.theme.trust_players} onChange={e => updateTheme('trust_players', e.target.value)} /></Field><Field label="Преимущество 3"><input maxLength={80} value={form.theme.trust_offline} onChange={e => updateTheme('trust_offline', e.target.value)} /></Field><Field label="Шаг 1"><input maxLength={100} value={form.theme.step_format} onChange={e => updateTheme('step_format', e.target.value)} /></Field><Field label="Шаг 2"><input maxLength={100} value={form.theme.step_join} onChange={e => updateTheme('step_join', e.target.value)} /></Field><Field label="Шаг 3"><input maxLength={100} value={form.theme.step_show} onChange={e => updateTheme('step_show', e.target.value)} /></Field></div></Card>
        <Card className="settings-card"><div className="section-title"><div><span className="overline">Мероприятие</span><h3>Формат и параметры квиза</h3></div></div><div className="form-grid"><Field label="Название квиза"><input required minLength={2} maxLength={160} value={form.title} onChange={e => { setSaved(false); setForm({ ...form, title: e.target.value }) }} /></Field><Field label="Формат"><select value={form.event_format} onChange={e => { const event_format = e.target.value as EventData['event_format']; setSaved(false); setForm({ ...form, event_format, game_mode: event_format === 'battle' ? 'team' : form.game_mode }) }}><option value="celebration">Праздник о человеке</option><option value="battle">Тематический квиз-баттл</option></select></Field>{form.event_format === 'celebration' ? <Field label="Имя героя"><input required maxLength={100} value={form.hero_name} onChange={e => { setSaved(false); setForm({ ...form, hero_name: e.target.value }) }} /></Field> : <Field label="Тема баттла"><input required maxLength={160} value={form.topic} onChange={e => { setSaved(false); setForm({ ...form, topic: e.target.value }) }} placeholder="Кино, музыка, спорт…" /></Field>}<Field label="Дата"><input type="date" value={form.event_date} onChange={e => { setSaved(false); setForm({ ...form, event_date: e.target.value }) }} /></Field><Field label="Режим игры"><select value={form.game_mode} onChange={e => { setSaved(false); setForm({ ...form, game_mode: e.target.value }) }}><option value="individual">Личный</option><option value="team">Командный</option></select></Field><label className="check-row"><input type="checkbox" checked={form.allow_late_join} onChange={e => { setSaved(false); setForm({ ...form, allow_late_join: e.target.checked }) }} /><span><b>Разрешить поздний вход</b><small>Опоздавшие начнут со следующего вопроса</small></span></label></div></Card>
        <Card className="settings-card host-settings-card"><div className="section-title"><div><span className="overline">Управление эфиром</span><h3>Автоматически или вручную</h3></div><Badge tone={form.host_mode === 'auto' ? 'success' : 'neutral'}>{form.host_mode === 'auto' ? 'Авто' : 'Вручную'}</Badge></div><p className="settings-card-description">Автоматический режим сам запускает таймер ответа, показывает результат и переходит к следующему вопросу. Кнопки организатора остаются доступны для перехода раньше.</p><div className="host-mode-switch" role="group" aria-label="Режим организатора"><button type="button" className={form.host_mode === 'auto' ? 'active' : ''} onClick={() => { setSaved(false); setForm({ ...form, host_mode: 'auto' }) }}><Play size={18} /><span><b>Автоматически</b><small>Рекомендуется для обычной игры</small></span></button><button type="button" className={form.host_mode === 'manual' ? 'active' : ''} onClick={() => { setSaved(false); setForm({ ...form, host_mode: 'manual' }) }}><Radio size={18} /><span><b>Вручную</b><small>Каждый этап по кнопке</small></span></button></div><Field label="Пауза между экранами" hint="Не меняет время на ответ"><div className="range-field"><input type="range" min="2" max="30" step="1" value={form.auto_advance_seconds} disabled={form.host_mode === 'manual'} onChange={e => { setSaved(false); setForm({ ...form, auto_advance_seconds: Number(e.target.value) }) }} /><b>{form.auto_advance_seconds} сек.</b></div></Field></Card>
        <Card className="settings-card theme-settings-card"><div className="section-title"><div><span className="overline">Визуальная тема</span><h3>Готовые стили</h3></div><Button variant="ghost" onClick={resetTheme}>Вернуть стандартную</Button></div><div className="theme-presets">{THEME_PRESETS.map(preset => <button key={preset.id} className={form.theme.theme_preset === preset.id ? 'active' : ''} onClick={() => choosePreset(preset)}><span className="theme-swatches"><i style={{ background: preset.colors.background }} /><i style={{ background: preset.colors.accent }} /><i style={{ background: preset.colors.secondary }} /></span><b>{preset.name}</b><small>{preset.description}</small>{form.theme.theme_preset === preset.id && <Check size={16} />}</button>)}</div><div className="color-grid">{([['accent', 'Акцент'], ['secondary', 'Второй цвет'], ['background', 'Фон'], ['panel', 'Карточки'], ['panel_2', 'Доп. панели'], ['text', 'Текст'], ['muted', 'Вторичный текст']] as [keyof ThemeConfig, string][]).map(([key, label]) => <label className="color-control" key={key}><span>{label}</span><div><input type="color" value={form.theme[key] as string} onChange={e => updateTheme(key, e.target.value as never)} /><code>{form.theme[key] as string}</code></div></label>)}</div><Field label="Декоративный стиль"><select value={form.theme.decor} onChange={e => updateTheme('decor', e.target.value as ThemeConfig['decor'])}><option value="confetti">Праздничный</option><option value="glow">Мягкое свечение</option><option value="neon">Неон</option><option value="minimal">Минимализм</option></select></Field></Card>
      </div>
      <aside className="settings-preview" style={previewStyle}><div className="preview-browser"><div className="preview-browser-bar"><i /><i /><i /><span>Предпросмотр</span></div><div className="preview-content"><div className="preview-logo"><span>{form.theme.logo_mark || 'QA'}</span><b>{form.theme.brand_name || 'Название'}<small>{form.theme.brand_tagline}</small></b></div><div className="preview-eyebrow">✦ {form.theme.landing_eyebrow}</div><h3>{form.theme.landing_title}<em>{form.theme.landing_highlight}</em></h3><p>{form.theme.landing_description}</p><button>{form.theme.join_button_label || 'Войти в игру'} <ChevronRight size={15} /></button><div className="preview-event"><small>{form.event_format === 'battle' ? 'Тематический баттл' : 'Праздничный квиз'}</small><b>{form.title || 'Название квиза'}</b><span>{form.event_format === 'battle' ? form.topic : form.hero_name}</span></div></div></div><small className="preview-hint">Предпросмотр обновляется сразу. На других устройствах тема изменится после сохранения.</small></aside>
    </div>
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
  const presetCount = Math.min(5, MAX_QUESTIONS - event.question_count)
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
  return <div className="editor-layout"><aside className="question-list"><div className="section-title"><div><span className="overline">Редактор</span><h2>Вопросы</h2></div><Badge tone={event.question_count >= MAX_QUESTIONS ? 'warning' : 'neutral'}>{event.question_count}/{MAX_QUESTIONS}</Badge></div><div className="preset-box"><div><Sparkles size={18} /><span><b>Быстрый тест</b><small>Готовые вопросы разных типов</small></span></div><Button variant="secondary" disabled={!presetCount || addingPresets} onClick={() => void addPresets()}>{addingPresets ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} {presetCount ? `Добавить ${presetCount}` : 'Лимит достигнут'}</Button>{presetError && <small className="form-error">{presetError}</small>}</div>{event.rounds.map(round => <div className="round-group" key={round.id}><h4>{round.title}</h4>{round.questions.map((question, index) => <button key={question.id} className={selected?.id === question.id && !creating ? 'active' : ''} onClick={() => { setSelected(question); setCreating(false) }}><span>{index + 1}</span><div><b>{question.text}</b><small>{questionTypeLabels[question.type]} · {question.time_limit_seconds} сек.</small></div><ChevronRight /></button>)}</div>)}<Button variant="secondary" className="add-question" disabled={event.question_count >= MAX_QUESTIONS} onClick={() => { setSelected(null); setCreating(true) }}><Plus size={18} /> Добавить вопрос</Button></aside><div className="question-workspace">{selected || creating ? <QuestionForm key={selected?.id || 'new'} event={event} question={selected} onSaved={saved => { setSelected(saved); setCreating(false); onChanged() }} onDelete={selected ? () => void remove(selected.id) : undefined} /> : <Empty icon="?" title="Выберите вопрос" text="Здесь можно настроить текст, ответы, таймер и пояснение." />}</div></div>
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

export function HostControlPanel({ event, session, onChanged }: { event: EventData; session?: Snapshot | null; onChanged: () => void | Promise<void> }) {
  const [mode, setMode] = useState<EventData['host_mode']>(event.host_mode)
  const [delay, setDelay] = useState(event.auto_advance_seconds)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setMode(event.host_mode); setDelay(event.auto_advance_seconds) }, [event.id, event.host_mode, event.auto_advance_seconds])
  const save = async (host_mode: EventData['host_mode'], auto_advance_seconds = delay) => {
    setBusy(true); setError(''); setMode(host_mode)
    try {
      const updated = await api.updateHostControl(event.id, { host_mode, auto_advance_seconds })
      setMode(updated.host_mode); setDelay(updated.auto_advance_seconds)
      await onChanged()
    } catch (err) {
      setMode(event.host_mode); setDelay(event.auto_advance_seconds)
      setError(err instanceof Error ? err.message : 'Не удалось изменить режим')
    } finally { setBusy(false) }
  }
  const status = session?.session.status
  const awaitingHero = session?.question?.type === 'hero_choice' && ['locked', 'review'].includes(status || '') && !session?.session.deadline_at
  const hasTransitionTimer = mode === 'auto' && Boolean(session?.session.deadline_at) && status !== 'answering'
  return <Card className="host-control-card"><div className="section-title"><div><span className="overline">Режим организатора</span><h3>{mode === 'auto' ? 'Автоматический' : 'Ручной'}</h3></div><Gauge /></div><div className="host-mode-switch compact" role="group" aria-label="Режим организатора"><button type="button" className={mode === 'auto' ? 'active' : ''} disabled={busy} onClick={() => void save('auto')}><Play size={16} /><span><b>Авто</b><small>По таймеру</small></span></button><button type="button" className={mode === 'manual' ? 'active' : ''} disabled={busy} onClick={() => void save('manual')}><Radio size={16} /><span><b>Вручную</b><small>По кнопке</small></span></button></div>{mode === 'auto' && <div className="live-delay-control"><label htmlFor="live-auto-delay">Пауза между экранами</label><div className="range-field"><input id="live-auto-delay" type="range" min="2" max="30" step="1" value={delay} disabled={busy} onChange={e => setDelay(Number(e.target.value))} /><b>{delay} сек.</b></div><Button variant="secondary" disabled={busy || delay === event.auto_advance_seconds} onClick={() => void save('auto', delay)}>{busy ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />} Применить</Button></div>}<div className="host-control-status">{hasTransitionTimer ? <><span>Следующий этап через</span><Timer deadline={session?.session.deadline_at} total={delay} serverTime={session?.server_time} /></> : <small>{awaitingHero ? 'Ждём выбор героя — затем автоматика продолжит игру.' : mode === 'auto' ? 'После запуска этапы будут переключаться сами.' : 'Этапы меняются только по кнопкам ниже.'}</small>}</div>{error && <p className="form-error">{error}</p>}</Card>
}

export function LivePanel({ event, session, onOpen, onResults, onChanged }: { event: EventData; session: Snapshot | null; onOpen: () => void; onResults: () => void; onChanged: () => void | Promise<void> }) {
  const connection = useGameStore(s => s.connection); const latency = useGameStore(s => s.latency); const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [transfers, setTransfers] = useState<any[]>([])
  useEffect(() => { if (session?.session.join_code) api.transferRequests(session.session.join_code).then(setTransfers).catch(() => undefined) }, [session?.session.join_code, session?.version])
  if (!session) return <div className="center-panel"><Empty icon="◉" title="Комната ещё не открыта" text="Откройте эфир — появится код и ссылки для гостей и телевизора." /><Button onClick={onOpen}><Play size={18} /> Открыть комнату</Button></div>
  const code = session.session.join_code; const status = session.session.status; const q = session.question; const isFinished = status === 'finished'
  const act = async (action: string) => { setBusy(action); setError(''); try { const next = await api.action(code, action); useGameStore.setState({ snapshot: next }); if (next.session.status === 'finished') onResults() } catch (err) { setError(err instanceof Error ? err.message : 'Команда не выполнена') } finally { setBusy('') } }
  const automatic = event.host_mode === 'auto'
  const primary = status === 'lobby' ? ['start_game', automatic ? 'Запустить автопоказ' : 'Подготовить вопрос'] : status === 'countdown' ? ['start', automatic ? 'Начать сейчас' : 'Начать таймер'] : status === 'answering' ? ['lock', 'Закрыть ответы сейчас'] : ['locked', 'review'].includes(status) ? ['reveal', automatic ? 'Показать сейчас' : 'Показать ответ'] : status === 'reveal' || status === 'cancelled' ? ['next', session.session.current_question_index + 1 >= session.session.question_count ? 'Показать финал' : automatic ? 'Дальше сейчас' : 'Следующий вопрос'] : null
  const joinUrl = `${location.origin}/join/${code}`
  return <div className="live-layout"><div className="live-main"><section className="page-heading compact"><div><div className="live-title"><span className="broadcast-dot" /> Эфир · {statusLabel(status)}</div><h2>{isFinished ? 'Игра завершена' : q ? q.text : 'Гости подключаются'}</h2><p>{isFinished ? 'Все ответы сохранены, финальный рейтинг готов.' : q ? `${q.round_title} · Вопрос ${session.session.current_question_index + 1} из ${session.session.question_count}` : `${participantCountLabel(session.participants.length)} в комнате`}</p></div><ConnectionPill state={connection} latency={latency} mode={session.session.deployment_mode} /></section>{isFinished ? <Card className="final-control-card"><span className="final-control-icon"><PartyPopper /></span><div><Badge tone="success">Финал готов</Badge><h3>Квиз пройден полностью</h3><p>{session.session.question_count} вопросов · {participantCountLabel(session.participants.length)}. Результаты сохранены в истории.</p></div><Button onClick={onResults}><BarChart3 size={18} /> Открыть результаты</Button></Card> : q ? <Card className="control-question"><div className="question-control-top"><Badge tone="accent">{questionTypeLabels[q.type] || q.type}</Badge>{status === 'answering' && <Timer deadline={session.session.deadline_at} total={q.time_limit_seconds} serverTime={session.server_time} />}</div><h3>{q.text}</h3>{q.options.length > 0 && <div className="control-options">{q.options.map((o, i) => <div key={o.id}><i>{String.fromCharCode(65 + i)}</i>{o.text}</div>)}</div>}<div className="answer-progress"><div><span>Ответило</span><b>{session.session.answered_count} из {session.session.answer_target_count}</b></div><div className="progress-line"><i style={{ width: `${session.session.answer_target_count ? (session.session.answered_count / session.session.answer_target_count) * 100 : 0}%` }} /></div></div></Card> : <Card className="lobby-control"><div className="mini-qr"><QRCodeSVG value={joinUrl} size={128} bgColor="transparent" fgColor="#f6f0e8" /></div><div><span>Код комнаты</span><strong>{code}</strong><p>Покажите QR-код на телевизоре или отправьте ссылку гостям.</p></div><a className="button button-secondary" href={`/screen/${code}`} target="_blank"><Monitor size={18} /> Экран</a></Card>}
    {!isFinished && <Card className="control-deck"><span className="overline">Управление игрой</span>{error && <p className="form-error">{error}</p>}<div className="primary-control">{primary && <Button onClick={() => void act(primary[0])} disabled={Boolean(busy)}>{busy === primary[0] ? <LoaderCircle className="spin" /> : <Play />} {primary[1]}</Button>}{status === 'paused' && <Button onClick={() => void act('resume')}><Play /> Продолжить</Button>}</div><div className="secondary-controls"><Button variant="secondary" onClick={() => void act(status === 'paused' ? 'resume' : 'pause')} disabled={!['answering', 'paused'].includes(status)}>{status === 'paused' ? <Play /> : <span className="pause-icon">Ⅱ</span>} {status === 'paused' ? 'Продолжить' : 'Пауза'}</Button><Button variant="secondary" onClick={() => void act('cancel')} disabled={!['countdown', 'answering', 'locked', 'review'].includes(status)}><Archive /> Отменить вопрос</Button><Button variant="danger" onClick={() => confirm('Завершить игру досрочно и показать рейтинг?') && void act('finish')}><PartyPopper /> Завершить досрочно</Button></div></Card>}</div>
    <aside className="live-side"><HostControlPanel event={event} session={session} onChanged={onChanged} />{transfers.length > 0 && <Card className="transfer-requests"><span className="overline">Перенос устройства</span>{transfers.map(item => <div key={item.id}><span className="avatar">{item.avatar}</span><b>{item.name}</b><Button variant="secondary" onClick={async () => { await api.approveTransfer(code, item.id); setTransfers(rows => rows.filter(row => row.id !== item.id)) }}><Check /> Разрешить</Button></div>)}</Card>}<Card><div className="section-title"><div><span className="overline">Участники</span><h3>{session.participants.length} в комнате</h3></div><Users /></div><div className="participant-stack">{session.participants.map(p => <div key={p.id}><span className="avatar">{p.avatar}</span><div><b>{p.name}</b><small>{p.role === 'hero' ? 'Герой' : p.ready ? 'Готов' : 'Подключается'}</small></div><span className={`presence ${p.connection_status}`} /></div>)}</div></Card><Card className="quick-links"><span className="overline">Быстрые ссылки</span><a href={`/screen/${code}`} target="_blank"><Monitor /> Телевизор <ExternalLink /></a><a href={`/join/${code}`} target="_blank"><Smartphone /> Игрок <ExternalLink /></a>{event.event_format === 'celebration' && <a href={`/join/${code}?hero=1`} target="_blank"><Crown /> Герой <ExternalLink /></a>}<button onClick={() => navigator.clipboard.writeText(joinUrl)}><Copy /> Скопировать ссылку</button></Card></aside></div>
}

function statusLabel(status: string) { return ({ lobby: 'Лобби', countdown: 'Подготовка', answering: 'Принимаем ответы', locked: 'Ответы закрыты', review: 'Проверка ответов', reveal: 'Ответ раскрыт', paused: 'Пауза', cancelled: 'Вопрос отменён', finished: 'Финал' } as Record<string, string>)[status] || status }

function ResultsPanel({ event, session, onReplay }: { event: EventData; session: Snapshot | null; onReplay: () => void }) {
  const [selectedCode, setSelectedCode] = useState(event.latest_session_code || '')
  const [results, setResults] = useState<any>(null); const [loading, setLoading] = useState(false)
  useEffect(() => { setSelectedCode(event.latest_session_code || '') }, [event.id, event.latest_session_code])
  useEffect(() => { if (selectedCode) { setLoading(true); setResults(null); api.results(selectedCode).then(setResults).finally(() => setLoading(false)) } }, [selectedCode, session?.version])
  if (!event.sessions.length) return <div className="center-panel"><Empty icon="♜" title="История пока пуста" text="После первой открытой комнаты здесь появятся участники и ответы." /><Button onClick={onReplay}><Play size={17} /> Начать первую игру</Button></div>
  if (loading && !results) return <div className="center-panel"><LoaderCircle className="spin" /></div>
  const ranking = results?.leaderboard || []
  const selectedSession = event.sessions.find(item => item.join_code === selectedCode)
  return <div className="content-stack"><section className="page-heading"><div><Badge tone={selectedSession?.status === 'finished' ? 'success' : 'neutral'}>{selectedSession?.status === 'finished' ? 'Игра завершена' : 'Предварительные данные'}</Badge><h2>История игр: {event.title}</h2><p>Каждый повторный запуск хранится отдельно. Выберите комнату, чтобы посмотреть её рейтинг и ответы.</p></div><Badge>{event.sessions.length} игр</Badge></section><Card className="session-history-picker">{event.sessions.map((item, index) => <button key={item.id} className={selectedCode === item.join_code ? 'active' : ''} onClick={() => setSelectedCode(item.join_code)}><span>{index + 1}</span><div><b>Комната {item.join_code}</b><small>{item.participant_count} игроков · {item.status === 'finished' ? 'завершена' : 'в процессе'}</small></div>{selectedCode === item.join_code && <Check />}</button>)}</Card>{ranking.length ? <Card className="results-table"><div className="table-row table-head"><span>Место</span><span>Игрок</span><span>Верно</span><span>Время</span></div>{ranking.map((row: any) => <div className="table-row" key={row.id}><strong>{row.rank}</strong><span className="player-cell"><i>{row.avatar}</i><b>{row.name}</b></span><span>{row.correct_count}</span><span>{formatTime(row.correct_time_ms)}</span></div>)}</Card> : <Empty icon="✦" title="Ответов ещё нет" text="Рейтинг заполнится после раскрытия вопросов." />}{results?.submissions?.length > 0 && <Card><div className="section-title"><div><span className="overline">Журнал</span><h3>Все ответы</h3></div></div><div className="submission-list">{results.submissions.map((row: any) => <div key={row.id}><span className={row.is_correct ? 'answer-ok' : 'answer-no'}>{row.is_correct ? '✓' : '×'}</span><div><b>{row.name}</b><small>{row.question}</small></div><code>{String(row.answer ?? 'Пропуск')}</code><span>{formatTime(row.elapsed_ms)}</span></div>)}</div></Card>}</div>
}
