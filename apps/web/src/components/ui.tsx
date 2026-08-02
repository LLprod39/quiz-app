import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react'
import { Check, Cloud, LoaderCircle, Wifi, WifiOff } from 'lucide-react'
import { useBranding } from '../lib/branding'

export function Logo({ compact = false }: { compact?: boolean }) {
  const { branding } = useBranding()
  return <div className="logo"><span className="logo-mark">{branding.logo_mark}</span>{!compact && <span>{branding.brand_name}<small>{branding.brand_tagline}</small></span>}</div>
}

export function Button({ className = '', variant = 'primary', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return <button className={`button button-${variant} ${className}`} {...props}>{children}</button>
}

export function Card({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return <section className={`card ${className}`}>{children}</section>
}

export function Badge({ children, tone = 'neutral' }: PropsWithChildren<{ tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent' }>) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

export function Empty({ icon = '✦', title, text }: { icon?: string; title: string; text: string }) {
  return <div className="empty"><span>{icon}</span><h3>{title}</h3><p>{text}</p></div>
}

export function ConnectionPill({ state, latency, mode }: { state: string; latency?: number | null; mode?: string }) {
  const online = state === 'online'
  return <div className={`connection ${online ? 'is-online' : ''}`}>{online ? <Wifi size={15} /> : <WifiOff size={15} />}<span>{online ? `${latency ?? '—'} мс` : state === 'connecting' ? 'Подключаемся' : 'Нет связи'}</span>{mode && <><i /><Cloud size={14} /><span>{mode === 'lan' ? 'локально' : 'облако'}</span></>}</div>
}

export function SaveState({ loading, saved }: { loading: boolean; saved?: boolean }) {
  return <span className="save-state">{loading ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{loading ? 'Сохраняем' : saved ? 'Сохранено' : 'Готово'}</span>
}

export function formatTime(ms = 0) { return `${(ms / 1000).toFixed(1).replace('.', ',')} сек.` }
