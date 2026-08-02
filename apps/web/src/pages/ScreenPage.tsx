import { useEffect, useMemo, useState } from 'react'
import { Maximize, Music2, PartyPopper, RotateCcw, Users, Volume2, VolumeX, Wifi } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useParams } from '../lib/router'
import { useGameStore } from '../store/game'
import type { Snapshot } from '../types'
import { ConnectionPill, Logo, formatTime } from '../components/ui'
import { Timer } from '../components/Timer'
import { useQuestionSpeech } from '../lib/questionSpeech'

export function ScreenPage() {
  const code = useParams().code!.toUpperCase(); const snapshot = useGameStore(s => s.snapshot); const connection = useGameStore(s => s.connection); const latency = useGameStore(s => s.latency); const [showTable, setShowTable] = useState(false)
  const speech = useQuestionSpeech({ sessionId: snapshot?.session.id, sessionCode: code, status: snapshot?.session.status, question: snapshot?.question })
  useEffect(() => { useGameStore.getState().connect(code); const key = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'f') void toggleFull() }; window.addEventListener('keydown', key); return () => { window.removeEventListener('keydown', key); useGameStore.getState().disconnect() } }, [code])
  useEffect(() => { if (snapshot?.session.status === 'finished') { setShowTable(false); const timer = window.setTimeout(() => setShowTable(true), 4500); return () => clearTimeout(timer) } }, [snapshot?.session.status])
  const toggleFull = async () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()
  if (!snapshot) return <main className="screen-shell"><div className="screen-loading"><span className="logo-mark">QA</span><p>Подключаем игровой экран…</p></div></main>
  return <main className={`screen-shell decor-${snapshot.event.theme.decor}`} style={{ '--accent': snapshot.event.theme.accent } as React.CSSProperties}><div className="screen-glow" /><header className="screen-header"><Logo /><div><span>Комната</span><b>{code}</b></div><ConnectionPill state={connection} latency={latency} mode={snapshot.session.deployment_mode} /><button onClick={() => void toggleFull()}><Maximize /> Начать показ</button></header><ScreenState snapshot={snapshot} showTable={showTable} /><footer className="screen-footer"><span><Wifi /> Сервер — источник времени</span><span>{snapshot.event.title}</span><QuestionSpeechControls speech={speech} /></footer></main>
}

function QuestionSpeechControls({ speech }: { speech: ReturnType<typeof useQuestionSpeech> }) {
  const label = !speech.supported
    ? 'Озвучка недоступна'
    : speech.enabled
      ? speech.speaking ? 'Озвучиваем вопрос' : 'Озвучка включена'
      : 'Озвучка выключена'
  const detail = !speech.supported
    ? 'Браузер не поддерживает речь'
    : speech.enabled
      ? speech.provider === 'microsoft' ? `Microsoft · ${speech.voiceName || 'русский голос'}` : speech.voiceName || 'Локальный русский голос'
      : 'Включить для новых вопросов'
  return <div className="screen-tts-controls" aria-label="Озвучка вопросов">
    <button className={`screen-tts-toggle ${speech.enabled ? 'is-enabled' : ''} ${speech.speaking ? 'is-speaking' : ''}`} type="button" role="switch" aria-checked={speech.enabled} disabled={!speech.supported} onClick={() => speech.setEnabled(!speech.enabled)}>
      {speech.enabled ? <Volume2 /> : <VolumeX />}
      <span><b>{label}</b><small>{detail}</small></span>
    </button>
    <button className="screen-tts-repeat" type="button" aria-label="Повторить текущий вопрос" title="Повторить текущий вопрос" disabled={!speech.canRepeat} onClick={speech.repeat}><RotateCcw /></button>
  </div>
}

function ScreenState({ snapshot, showTable }: { snapshot: Snapshot; showTable: boolean }) {
  const status = snapshot.session.status; const q = snapshot.question; const joinUrl = `${location.origin}/join/${snapshot.session.join_code}`
  if (status === 'lobby') return <section className="tv-lobby"><div className="tv-copy"><span className="tv-kicker"><PartyPopper /> Скоро начинаем</span><h1>{snapshot.event.title}</h1><p>{snapshot.event.event_format === 'battle' ? <>Квиз-баттл на тему <em>{snapshot.event.topic}</em></> : <>Проверим, кто знает <em>{snapshot.event.hero_name}</em> лучше всех?</>}</p><div className="tv-people"><div className="avatar-cloud">{snapshot.participants.slice(0, 8).map((p, i) => <span key={p.id} style={{ zIndex: 9 - i }}>{p.avatar}</span>)}</div><b><Users /> {snapshot.participants.length} {pluralGuests(snapshot.participants.length)}</b></div></div><div className="qr-panel"><div className="qr-wrap"><QRCodeSVG value={joinUrl} size={230} bgColor="#fffaf3" fgColor="#151522" level="M" /></div><span>Сканируйте камерой</span><div className="room-code-display">{snapshot.session.join_code.split('').map((x, i) => <i key={i}>{x}</i>)}</div><small>или откройте ссылку и введите код</small></div></section>
  if (status === 'countdown') return <section className="tv-countdown"><span>{q?.round_title}</span><div>3</div><h1>Вопрос {snapshot.session.current_question_index + 1}</h1><p>Приготовьте телефоны</p></section>
  if (status === 'answering' && q) return <section className="tv-question"><div className="tv-question-meta"><span>{q.round_title}</span><b>Вопрос {snapshot.session.current_question_index + 1} из {snapshot.session.question_count}</b></div><h1>{q.text}</h1>{q.media_url && (q.media_type === 'audio' ? <div className="tv-audio"><Music2 /><div><i /><i /><i /><i /><i /><i /><i /><i /></div><span>Слушаем фрагмент</span></div> : <img src={q.media_url} alt="Фотография к вопросу" />)}{q.options.length > 0 && <div className={`tv-options count-${q.options.length}`}>{q.options.map((option, index) => <div key={option.id}><i>{String.fromCharCode(65 + index)}</i><span>{option.text}</span></div>)}</div>}<div className="tv-question-bottom"><div><Users /><span>Ответило</span><b>{snapshot.session.answered_count} из {snapshot.event.game_mode === 'team' ? snapshot.teams.length : snapshot.participants.filter(p => p.role !== 'hero').length}</b></div><Timer large deadline={snapshot.session.deadline_at} total={q.time_limit_seconds} /></div></section>
  if (['locked', 'review'].includes(status)) return <section className="tv-state-message"><span className="state-lock">🔐</span><h1>Ответы приняты</h1><p>{status === 'review' ? 'Организатор проверяет текстовые ответы' : 'Готовы узнать, как было на самом деле?'}</p></section>
  if (status === 'paused') return <section className="tv-state-message"><span className="state-lock">Ⅱ</span><h1>Небольшая пауза</h1><p>Игра скоро продолжится</p></section>
  if (status === 'cancelled') return <section className="tv-state-message"><span className="state-lock">↩</span><h1>Вопрос отменён</h1><p>Его результаты не повлияют на рейтинг</p></section>
  if (status === 'reveal' && q) { const correct = Array.isArray(q.correct_answer) ? q.correct_answer : [q.correct_answer]; return <section className="tv-reveal"><span className="tv-kicker">Правильный ответ</span><h1>{q.text}</h1><div className="reveal-options">{q.options.length ? q.options.map((o, i) => <div key={o.id} className={correct.includes(o.id) ? 'correct' : ''}><i>{correct.includes(o.id) ? '✓' : String.fromCharCode(65 + i)}</i><span>{o.text}</span></div>) : <strong>{String(q.correct_answer ?? 'Ответ выбран героем')}</strong>}</div>{q.explanation && <blockquote>{q.explanation}</blockquote>}<small>Личный результат уже на телефонах гостей</small></section> }
  if (status === 'finished') return <FinalScreen snapshot={snapshot} showTable={showTable} />
  return <section className="tv-state-message"><span className="state-lock">✦</span><h1>Следующий вопрос</h1><p>Небольшая передышка</p></section>
}

function FinalScreen({ snapshot, showTable }: { snapshot: Snapshot; showTable: boolean }) { const rows = snapshot.leaderboard; const top = rows.slice(0, 3); if (showTable) return <section className="tv-final-table"><span className="tv-kicker">Финальная таблица</span><h1>{snapshot.event.event_format === 'battle' ? 'Итоги квиз-баттла' : 'Вот кто знает героя лучше всех'}</h1><div>{rows.map(row => <article key={row.id}><strong>{row.rank}</strong><span>{row.avatar}</span><b>{row.name}</b><i>{row.correct_count} верно</i><em>{formatTime(row.correct_time_ms)}</em></article>)}</div></section>; return <section className="tv-podium"><Confetti /><span className="tv-kicker"><PartyPopper /> Финал</span><h1>{snapshot.event.event_format === 'battle' ? 'Победители баттла!' : 'Наши знатоки!'}</h1><div className="podium">{[top[1], top[0], top[2]].map((row, index) => row ? <article key={row.id} className={`place-${row.rank}`}><div className="podium-avatar">{row.avatar}<span>{row.rank}</span></div><h2>{row.name}</h2><p>{row.correct_count} правильных</p><div>{row.rank}</div></article> : <article key={index} className={`place-${index + 1} empty-place`} />)}</div><p className="table-soon">Полная таблица появится через несколько секунд</p></section> }
function Confetti() { return <div className="confetti" aria-hidden="true">{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ '--i': i } as React.CSSProperties} />)}</div> }
function pluralGuests(count: number) { const mod10 = count % 10, mod100 = count % 100; if (mod10 === 1 && mod100 !== 11) return 'участник'; if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'участника'; return 'участников' }
