import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BRANDING } from '../lib/branding'
import { api } from '../lib/api'
import { MemoryRouter } from '../lib/router'
import { useGameStore } from '../store/game'
import type { Account, EventData, Snapshot } from '../types'
import { LivePanel, OrganizerPage, PackCatalogPanel } from './OrganizerPage'

const event = {
  id: 'event-1', title: 'Тестовый квиз', event_format: 'battle', topic: 'Кино', hero_name: '', event_date: '', status: 'ready', is_selected: true,
  game_mode: 'individual', host_mode: 'auto', auto_advance_seconds: 5, tv_display_mode: 'classic', tv_chart_style: 'both', theme: DEFAULT_BRANDING, hero_photo_url: null, allow_late_join: true, question_count: 2,
  active_session_code: 'ABC123', latest_session_code: 'ABC123', sessions: [], rounds: [], questionnaire: null,
} satisfies EventData

const question = {
  id: 'question-2', round_id: 'round-1', round_title: 'Раунд 1', type: 'single', text: 'Последний вопрос',
  time_limit_seconds: 30, options: [{ id: 'a', text: 'Ответ' }],
}

function snapshot(status: Snapshot['session']['status']): Snapshot {
  return {
    type: 'session.snapshot', version: status === 'finished' ? 2 : 1, server_time: new Date().toISOString(),
    session: { id: 'session-1', join_code: 'ABC123', status, deployment_mode: 'lan', current_question_index: 1, question_count: 2, answered_count: 2, answer_target_count: 2 },
    event: { id: event.id, title: event.title, event_format: event.event_format, topic: event.topic, hero_name: '', game_mode: event.game_mode, host_mode: 'auto', auto_advance_seconds: 5, tv_display_mode: 'classic', tv_chart_style: 'both', theme: DEFAULT_BRANDING },
    question, participants: [{ id: 'p1', name: 'Анна', avatar: '🎈', role: 'guest', ready: true, connection_status: 'online', eligible: true }, { id: 'p2', name: 'Иван', avatar: '🚀', role: 'guest', ready: true, connection_status: 'online', eligible: true }],
    teams: [], private_result: null, leaderboard: [], live_answers: [], answer_breakdown: [],
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
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

describe('PackCatalogPanel GPT builder', () => {
  it('creates a topic prompt and saves pasted JSON as a permanent template', async () => {
    const customPack = {
      slug: 'countries-world', title: 'Страны мира', topic: 'География', icon: '🌍', short_description: 'Готовый квиз о странах мира.',
      description: 'Готовый тематический квиз о странах, столицах и географии.', estimated_minutes: 30, difficulty: 'Средняя', game_mode: 'team' as const,
      round_title: 'Вокруг света', disclaimer: 'Факты проверены.', sources: [], theme: DEFAULT_BRANDING, question_count: 20, sample_questions: [], is_custom: true,
    }
    vi.spyOn(api, 'quizPacks').mockResolvedValueOnce([]).mockResolvedValueOnce([customPack])
    vi.spyOn(api, 'quizPackPrompt').mockResolvedValue({ prompt: 'Найди надёжные источники и верни JSON', topic: 'Страны мира', question_count: 20 })
    const importTemplate = vi.spyOn(api, 'importQuizPack').mockResolvedValue(customPack)

    render(<MemoryRouter><PackCatalogPanel onInstalled={vi.fn()} /></MemoryRouter>)
    await waitFor(() => expect(api.quizPacks).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /создать шаблон с gpt/i }))
    fireEvent.change(screen.getByLabelText('Тема квиза'), { target: { value: 'Страны мира' } })
    fireEvent.click(screen.getByRole('button', { name: /^создать промпт$/i }))
    expect(await screen.findByDisplayValue('Найди надёжные источники и верни JSON')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /у меня есть json/i }))
    fireEvent.change(screen.getByPlaceholderText(/schema_version/), { target: { value: '```json\n{"schema_version":1,"slug":"countries-world"}\n```' } })
    fireEvent.click(screen.getByRole('button', { name: /проверить и сохранить/i }))

    await waitFor(() => expect(importTemplate).toHaveBeenCalledWith({ schema_version: 1, slug: 'countries-world' }))
    expect(await screen.findByText(/шаблон «страны мира» сохранён/i)).toBeInTheDocument()
    expect(screen.getByText('Мой шаблон')).toBeInTheDocument()
  })
})

describe('OrganizerPage system section access', () => {
  const organizerEvent = { ...event, active_session_code: null, latest_session_code: null }
  const account = (role: Account['role']): Account => ({
    id: `account-${role}`, phone: '+77000000000', display_name: 'Администратор', avatar: '👑',
    avatar_kind: 'preset', role, status: 'active', created_at: new Date().toISOString(),
  })

  it('shows system management inside /admin for a superadmin', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(account('superadmin'))
    vi.spyOn(api, 'events').mockResolvedValue([organizerEvent])

    render(<MemoryRouter><OrganizerPage /></MemoryRouter>)

    expect((await screen.findAllByRole('button', { name: 'Система' })).length).toBeGreaterThan(0)
  })

  it('does not expose system management to a regular account', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(account('user'))
    const eventsRequest = vi.spyOn(api, 'events').mockResolvedValue([organizerEvent])

    render(<MemoryRouter><OrganizerPage /></MemoryRouter>)
    await waitFor(() => expect(eventsRequest).toHaveBeenCalled())

    expect(screen.queryAllByRole('button', { name: 'Система' })).toHaveLength(0)
  })
})
