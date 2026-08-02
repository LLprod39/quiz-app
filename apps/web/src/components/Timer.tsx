import { useEffect, useMemo, useState } from 'react'

export function Timer({ deadline, total = 30, large = false }: { deadline?: string | null; total?: number; large?: boolean }) {
  const [now, setNow] = useState(Date.now())
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    const advance = (event: Event) => setOffset(value => value + Number((event as CustomEvent).detail || 0))
    window.addEventListener('game-time-advance', advance)
    return () => { window.clearInterval(timer); window.removeEventListener('game-time-advance', advance) }
  }, [])
  const remaining = deadline ? Math.max(0, new Date(deadline).getTime() - now - offset) : total * 1000
  const seconds = Math.ceil(remaining / 1000)
  const percent = Math.min(100, (remaining / (total * 1000)) * 100)
  const urgent = seconds <= 5
  return <div className={`timer ${large ? 'timer-large' : ''} ${urgent ? 'is-urgent' : ''}`} style={{ '--timer-progress': `${percent}%` } as React.CSSProperties} aria-label={`Осталось ${seconds} секунд`}><span>{seconds}</span><small>сек</small></div>
}
