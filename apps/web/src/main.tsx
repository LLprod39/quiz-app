import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from './lib/router'
import App from './App'
import { useGameStore } from './store/game'
import { BrandingProvider } from './lib/branding'
import './styles.css'

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
}

window.render_game_to_text = () => {
  const state = useGameStore.getState()
  const snapshot = state.snapshot
  return JSON.stringify({
    coordinate_system: 'DOM interface; origin top-left, x right, y down',
    route: location.pathname,
    connection: state.connection,
    status: snapshot?.session.status ?? null,
    room: snapshot?.session.join_code ?? null,
    question: snapshot?.question?.text ?? null,
    question_index: snapshot?.session.current_question_index ?? -1,
    answered: snapshot?.session.answered_count ?? 0,
    participants: snapshot?.participants.map(p => ({ name: p.name, ready: p.ready })) ?? [],
    private_result: snapshot?.private_result ?? null,
    leaderboard: snapshot?.leaderboard ?? [],
  })
}
window.advanceTime = ms => window.dispatchEvent(new CustomEvent('game-time-advance', { detail: ms }))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrandingProvider><BrowserRouter><App /></BrowserRouter></BrandingProvider>,
)
