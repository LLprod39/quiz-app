import { useState } from 'react'
import { Check, KeyRound, LoaderCircle } from 'lucide-react'
import { api } from '../lib/api'
import { Link, useParams } from '../lib/router'
import { Button, Card, Field, Logo } from '../components/ui'

export function ResetPasswordPage() {
  const token = useParams().token!
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(''); try { await api.resetPassword(token, password); setDone(true) } catch (err) { setError(err instanceof Error ? err.message : 'Ссылка недействительна') } finally { setBusy(false) } }
  return <main className="login-page"><Card className="login-card"><Logo />{done ? <div className="login-intro"><Check size={42} /><h1>Пароль изменён</h1><p>Все прежние устройства вышли из аккаунта.</p><Link className="button button-primary" to="/account">Войти</Link></div> : <><div className="login-intro"><KeyRound size={36} /><h1>Новый пароль</h1><p>Одноразовая ссылка перестанет работать после сохранения.</p></div><form onSubmit={submit}><Field label="Новый пароль"><input type="password" minLength={8} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} /></Field>{error && <p className="form-error">{error}</p>}<Button type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <KeyRound />} Сохранить пароль</Button></form></>}</Card></main>
}
