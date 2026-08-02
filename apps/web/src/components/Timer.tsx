import { useEffect, useMemo, useState } from 'react'

function useRemaining(deadline?: string | null, total = 30, serverTime?: string | null) {
  const [now, setNow] = useState(Date.now())
  const [offset, setOffset] = useState(0)
  const serverOffset = useMemo(() => serverTime ? new Date(serverTime).getTime() - Date.now() : 0, [serverTime])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    const advance = (event: Event) => setOffset(value => value + Number((event as CustomEvent).detail || 0))
    window.addEventListener('game-time-advance', advance)
    return () => { window.clearInterval(timer); window.removeEventListener('game-time-advance', advance) }
  }, [])
  return deadline ? Math.max(0, new Date(deadline).getTime() - (now + serverOffset) - offset) : total * 1000
}

export function Timer({ deadline, total = 30, large = false, serverTime }: { deadline?: string | null; total?: number; large?: boolean; serverTime?: string | null }) {
  const remaining = useRemaining(deadline, total, serverTime)
  const seconds = Math.ceil(remaining / 1000)
  const percent = Math.min(100, (remaining / (total * 1000)) * 100)
  const urgent = seconds <= 5
  return <div className={`timer ${large ? 'timer-large' : ''} ${urgent ? 'is-urgent' : ''}`} style={{ '--timer-progress': `${percent}%` } as React.CSSProperties} aria-label={`Осталось ${seconds} секунд`}><span>{seconds}</span><small>сек</small></div>
}

export function CountdownNumber({ deadline, total = 3, serverTime, className = '' }: { deadline?: string | null; total?: number; serverTime?: string | null; className?: string }) {
  const remaining = useRemaining(deadline, total, serverTime)
  const seconds = deadline ? Math.max(0, Math.ceil(remaining / 1000)) : null
  return <div className={className} aria-label={seconds === null ? 'Ожидаем организатора' : `Начало через ${seconds} секунд`}>{seconds ?? '…'}</div>
}
