import { useEffect, useState } from 'react'
import { Check, Clock3, Crown, Gamepad2, History, KeyRound, LoaderCircle, LogOut, MonitorSmartphone, Pencil, Sparkles, Trash2, Upload, UserRound } from 'lucide-react'
import { api } from '../lib/api'
import { Link, useSearchParams } from '../lib/router'
import type { Account, AccountSession, Plan, PlanUsage } from '../types'
import { Badge, Button, Card, Field, Logo } from '../components/ui'

const avatars = ['🎈', '🚀', '🎉', '✨', '🧠', '🎮', '🌟', '🦊', '🐼', '👑', '🎤', '🏆']
const quotaLabels: Record<string, string> = {
  active_quizzes: 'Активные квизы', concurrent_rooms: 'Активные комнаты', media_bytes: 'Медиа', private_templates: 'Личные шаблоны', games_per_month: 'Игры в этом месяце',
}

export function AccountPage() {
  const [params] = useSearchParams()
  const [account, setAccount] = useState<Account | null>(null)
  const [checking, setChecking] = useState(true)
  const [usage, setUsage] = useState<PlanUsage | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [sessions, setSessions] = useState<AccountSession[]>([])
  const [history, setHistory] = useState<any[]>([])
  const [unclaimed, setUnclaimed] = useState<any[]>([])
  const [media, setMedia] = useState<any[]>([])
  const [error, setError] = useState('')
  const [profileName, setProfileName] = useState('')
  const [profileAvatar, setProfileAvatar] = useState(avatars[0])
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const load = async () => {
    const current = await api.me()
    setAccount(current)
    setProfileName(current.display_name)
    if (avatars.includes(current.avatar)) setProfileAvatar(current.avatar)
    const [nextUsage, nextPlans, nextSessions, nextHistory, nextUnclaimed, nextMedia] = await Promise.all([api.accountUsage(), api.publicPlans(), api.accountSessions(), api.accountHistory(), api.unclaimedResults(), api.mediaAssets()])
    setUsage(nextUsage); setPlans(nextPlans); setSessions(nextSessions); setHistory(nextHistory); setUnclaimed(nextUnclaimed); setMedia(nextMedia)
  }
  useEffect(() => { load().catch(() => setAccount(null)).finally(() => setChecking(false)) }, [])
  if (checking) return <div className="center-screen"><LoaderCircle className="spin" /><p>Открываем аккаунт…</p></div>
  if (!account) return <AccountAuth initialRegister={params.get('register') === '1'} onDone={() => { setChecking(true); load().finally(() => setChecking(false)) }} />
  const logout = async () => { await api.logout(); setAccount(null) }
  const claim = async () => { if (!confirm(`Привязать ${unclaimed.length} найденных игр к аккаунту?`)) return; await api.claimResults(); await load() }
  const upload = async (file?: File) => { if (!file) return; try { setAccount(await api.uploadAvatar(file)) } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось загрузить аватар') } }
  const saveProfile = async (event: React.FormEvent) => { event.preventDefault(); try { setError(''); setAccount(await api.updateProfile({ display_name: profileName, avatar: profileAvatar })) } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сохранить профиль') } }
  const changePassword = async (event: React.FormEvent) => { event.preventDefault(); try { setError(''); await api.changePassword(currentPassword, newPassword); setCurrentPassword(''); setNewPassword(''); alert('Пароль изменён. Остальные устройства отключены.') } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось изменить пароль') } }
  const renameSession = async (row: AccountSession) => { const name = prompt('Название устройства', row.device_name)?.trim(); if (!name || name === row.device_name) return; await api.renameAccountSession(row.id, name); setSessions(await api.accountSessions()) }
  return <main className="account-page"><header className="account-nav"><Link to="/"><Logo /></Link><nav><Link to="/admin"><Gamepad2 /> Админка</Link><button onClick={() => void logout()}><LogOut /> Выйти</button></nav></header>
    <div className="account-wrap"><section className="account-hero"><div className="account-avatar">{account.avatar_kind === 'upload' ? <img src={account.avatar} alt="Аватар" /> : account.avatar}<label title="Загрузить фото"><Upload /><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => void upload(e.target.files?.[0])} /></label></div><div><Badge tone={account.role === 'superadmin' ? 'accent' : 'success'}>{account.role === 'superadmin' ? 'Суперадминистратор' : 'Активный аккаунт'}</Badge><h1>{account.display_name}</h1><p>{account.phone}</p></div><div className="account-hero-actions"><Link className="button button-primary" to="/admin"><Sparkles /> Создать квиз</Link></div></section>
      {error && <p className="form-error">{error}</p>}
      {unclaimed.length > 0 && <Card className="claim-card"><History /><div><b>Найдены гостевые результаты</b><p>{unclaimed.length} игр на этом устройстве ещё не привязаны к аккаунту.</p></div><Button onClick={() => void claim()}><Check /> Привязать все</Button></Card>}
      <Card className="profile-settings"><div className="section-title"><div><span className="overline">Профиль игрока</span><h2>Имя и аватар</h2></div><UserRound /></div><form onSubmit={saveProfile}><Field label="Ваше имя"><input required minLength={2} maxLength={80} value={profileName} onChange={e => setProfileName(e.target.value)} /></Field><div className="avatar-picker" aria-label="Выберите аватар">{avatars.map(item => <button type="button" className={profileAvatar === item ? 'active' : ''} key={item} onClick={() => setProfileAvatar(item)}>{item}</button>)}</div><Button type="submit"><Check /> Сохранить профиль</Button></form></Card>
      <div className="account-grid"><Card className="plan-card"><div className="section-title"><div><span className="overline">Текущий тариф</span><h2>{usage?.plan.name}</h2></div><Crown /></div><p>{usage?.plan.description}</p><div className="quota-list">{usage && Object.entries(usage.usage).map(([key, value]) => <div key={key}><span>{quotaLabels[key] || key}</span><b>{key === 'media_bytes' ? `${Math.round(value.current / 1024 / 1024)} МБ` : value.current} / {value.limit == null ? '∞' : key === 'media_bytes' ? `${Math.round(value.limit / 1024 / 1024)} МБ` : value.limit}</b><i><em style={{ width: value.limit ? `${Math.min(100, value.current / value.limit * 100)}%` : '8%' }} /></i></div>)}</div><div className="plan-comparison">{plans.map(plan => <span key={plan.id} className={plan.id === usage?.plan.id ? 'active' : ''}><b>{plan.name}</b><small>{plan.id === usage?.plan.id ? 'Текущий' : 'Обратитесь к администратору'}</small></span>)}</div></Card>
        <Card><div className="section-title"><div><span className="overline">Безопасность</span><h2>Ваши устройства</h2></div><MonitorSmartphone /></div><div className="account-device-list">{sessions.filter(row => !row.revoked_at).map(row => <div key={row.id}><span>{row.os.includes('Android') || row.os.includes('iOS') ? '📱' : '💻'}</span><div><b>{row.device_name}{row.is_current ? ' · это устройство' : ''}</b><small>{row.ip_address} · {new Date(row.last_seen_at).toLocaleString('ru-RU')}</small></div><span className="device-actions"><Button variant="ghost" onClick={() => void renameSession(row)}><Pencil /> Назвать</Button><Button variant="ghost" disabled={row.is_current} onClick={async () => { await api.revokeAccountSession(row.id); setSessions(await api.accountSessions()) }}>Отозвать</Button></span></div>)}</div><div className="security-actions"><Button variant="ghost" onClick={async () => { if (!confirm('Завершить все сеансы, включая текущий?')) return; await api.logoutAll(); setAccount(null) }}><LogOut /> Выйти везде</Button></div><form className="password-form" onSubmit={changePassword}><h3>Сменить пароль</h3><input type="password" required minLength={8} maxLength={128} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="Текущий пароль" /><input type="password" required minLength={8} maxLength={128} value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Новый пароль" /><Button type="submit"><KeyRound /> Сменить пароль</Button></form></Card>
      </div>
      {media.length > 0 && <Card><div className="section-title"><div><span className="overline">Хранилище аккаунта</span><h2>Локальные медиафайлы</h2></div><Upload /></div><div className="media-asset-list">{media.map(row => <div key={row.id}><span>{row.media_type === 'audio' ? '🎵' : '🖼️'}</span><div><b>{row.url.split('/').pop()}</b><small>{(row.size_bytes / 1024 / 1024).toFixed(2)} МБ · {new Date(row.created_at).toLocaleDateString('ru-RU')}</small></div><Button variant="ghost" onClick={async () => { if (!confirm('Удалить файл и убрать его из вопросов?')) return; await api.deleteMediaAsset(row.id); await load() }}><Trash2 /> Удалить</Button></div>)}</div></Card>}
      <Card><div className="section-title"><div><span className="overline">Личный профиль игрока</span><h2>История игр</h2></div><Clock3 /></div>{history.length ? <div className="account-history">{history.map(row => <div key={row.participant_id}><span>🏁</span><div><b>{row.event_title}</b><small>Комната {row.join_code} · {new Date(row.played_at).toLocaleDateString('ru-RU')}</small></div><strong>{row.correct_count} верно</strong></div>)}</div> : <p className="muted-copy">После первой игры результаты появятся здесь.</p>}</Card>
    </div></main>
}

function AccountAuth({ initialRegister, onDone }: { initialRegister: boolean; onDone: () => void }) {
  const [register, setRegister] = useState(initialRegister)
  const [phone, setPhone] = useState('+7')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState(avatars[0])
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(''); try { if (register) { await api.register({ phone, password, display_name: name, avatar }); if (avatarFile) await api.uploadAvatar(avatarFile) } else await api.login(phone, password); onDone() } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось войти') } finally { setBusy(false) } }
  return <main className="login-page account-auth"><Link className="back-link" to="/">← На главную</Link><Card className="login-card"><Logo /><div className="login-intro"><Badge tone="accent">{register ? 'Новый аккаунт' : 'Вход'}</Badge><h1>{register ? 'Сохраняйте квизы и результаты' : 'С возвращением'}</h1><p>{register ? 'Номер используется только как логин и пока не подтверждается SMS.' : 'Введите номер телефона и пароль.'}</p></div><form onSubmit={submit}>{register && <Field label="Ваше имя"><input required minLength={2} value={name} onChange={e => setName(e.target.value)} /></Field>}<Field label="Номер телефона"><input type="tel" required value={phone} onChange={e => setPhone(e.target.value)} placeholder="+77001234567" /></Field><Field label="Пароль"><input type="password" required minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} /></Field>{register && <><div className="avatar-picker" aria-label="Выберите аватар">{avatars.map(item => <button type="button" className={!avatarFile && avatar === item ? 'active' : ''} key={item} onClick={() => { setAvatar(item); setAvatarFile(null) }}>{item}</button>)}</div><label className="avatar-upload-choice"><Upload />{avatarFile ? avatarFile.name : 'Или загрузить JPEG, PNG, WebP до 5 МБ'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setAvatarFile(e.target.files?.[0] || null)} /></label></>}{error && <p className="form-error">{error}</p>}<Button type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : register ? <UserRound /> : <KeyRound />} {register ? 'Создать аккаунт' : 'Войти'}</Button><button type="button" className="auth-switch" onClick={() => setRegister(!register)}>{register ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}</button></form>{!register && <small className="demo-hint">Сброс пароля выполняет системный администратор.</small>}</Card></main>
}
