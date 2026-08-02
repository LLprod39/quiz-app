import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BRANDING } from '../lib/branding'
import { api } from '../lib/api'
import { useGameStore } from '../store/game'
import type { EventData, Snapshot } from '../types'
import { LivePanel } from './OrganizerPage'

const event = {
  id: 'event-1', title: 'Тестовый квиз', event_format: 'battle', topic: 'Кино', hero_name: '', event_date: '', status: 'ready', is_selected: true,
  game_mode: 'individual', host_mode: 'auto', auto_advance_seconds: 5, theme: DEFAULT_BRANDING, hero_photo_url: null, allow_late_join: true, question_count: 2,
  active_session_code: 'ABC123', latest_session_code: 'ABC123', sessions: [], rounds: [], questionnaire: null,
} satisfies EventData

const question = {
  id: 'question-2', round_id: 'round-1', round_title: 'Раунд 1', type: 'single', text: 'Последний вопрос',
  time_limit_seconds: 30, options: [{ id: 'a', text: 'Ответ' }],
}

function snapshot(status: Snapshot['session']['status']): Snapshot {
  return {
    type: 'session.snapshot', version: status === 'finished' ? 2 : 1, server_time: new Date().toISOString(),
    session: { id: 'session-1', join_code: 'ABC123', status, deployment_mode: 'lan', current_question_index: 1, question_count: 2, answered_count: 2 },
    event: { id: event.id, title: event.title, event_format: event.event_format, topic: event.topic, hero_name: '', game_mode: event.game_mode, host_mode: 'auto', auto_advance_seconds: 5, theme: DEFAULT_BRANDING },
    question, participants: [{ id: 'p1', name: 'Анна', avatar: '🎈', role: 'guest', ready: true, connection_status: 'online', eligible: true }, { id: 'p2', name: 'Иван', avatar: '🚀', role: 'guest', ready: true, connection_status: 'online', eligible: true }],
    teams: [], private_result: null, leaderboard: [],
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  useGameStore.setState({ snapshot: null, connection: 'offline', latency: null, socket: null })
})

describe('LivePanel final flow', () => {
  it('shows a clear results action when the game is already finished', () => {
    vi.spyOn(api, 'transferRequests').mockResolvedValue([])
    const onResults = vi.fn()
    render(<LivePanel event={event} session={snapshot('finished')} onOpen={vi.fn()} onResults={onResults} onChanged={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Игра завершена' })).toBeInTheDocument()
    expect(screen.getByText(/результаты сохранены в истории/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /открыть результаты/i }))
    expect(onResults).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: /завершить досрочно/i })).not.toBeInTheDocument()
  })

  it('opens results automatically after showing the final', async () => {
    vi.spyOn(api, 'transferRequests').mockResolvedValue([])
    vi.spyOn(api, 'action').mockResolvedValue(snapshot('finished'))
    const onResults = vi.fn()
    render(<LivePanel event={event} session={snapshot('reveal')} onOpen={vi.fn()} onResults={onResults} onChanged={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /показать финал/i }))
    await waitFor(() => expect(onResults).toHaveBeenCalledOnce())
    expect(api.action).toHaveBeenCalledWith('ABC123', 'next')
  })
})
