import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DEFAULT_BRANDING } from '../lib/branding'
import type { Snapshot } from '../types'
import { TvInsightsScreen } from './ScreenPage'

const snapshot: Snapshot = {
  type: 'session.snapshot',
  version: 7,
  server_time: '2026-08-02T12:00:00Z',
  session: {
    id: 'session-1', join_code: 'ABC123', status: 'answering', deployment_mode: 'lan',
    current_question_index: 0, question_count: 20, deadline_at: '2026-08-02T12:00:30Z', answered_count: 2, answer_target_count: 3,
  },
  event: {
    id: 'event-1', title: 'Marvel Quiz Battle', event_format: 'battle', content_mode: 'quiz', topic: 'Marvel', hero_name: '',
    game_mode: 'individual', host_mode: 'auto', auto_advance_seconds: 5, tv_display_mode: 'insights', tv_chart_style: 'both', theme: DEFAULT_BRANDING,
  },
  question: {
    id: 'question-1', round_title: 'Герои', type: 'single', text: 'Из какого металла сделан щит?', time_limit_seconds: 30,
    options: [{ id: 'a', text: 'Вибраниум' }, { id: 'b', text: 'Адамантий' }],
  },
  participants: [], teams: [], private_result: null, leaderboard: [],
  live_answers: [
    { id: 'answer-1', name: 'Анна', avatar: '🌻', answer: 'Вибраниум' },
    { id: 'answer-2', name: 'Иван', avatar: '🚀', answer: 'Адамантий' },
  ],
  answer_breakdown: [
    { label: 'Вибраниум', count: 1, percent: 50, color: '#ff6b6b' },
    { label: 'Адамантий', count: 1, percent: 50, color: '#a78bfa' },
  ],
}

describe('TvInsightsScreen', () => {
  it('shows named live answers together with both chart types', () => {
    render(<TvInsightsScreen snapshot={snapshot} />)

    expect(screen.getByText('Анна')).toBeInTheDocument()
    expect(screen.getByText('Иван')).toBeInTheDocument()
    expect(screen.getByLabelText('Круговая диаграмма ответов')).toBeInTheDocument()
    expect(screen.getByLabelText('Столбчатая диаграмма ответов')).toBeInTheDocument()
    expect(screen.getByText('2 из 3')).toBeInTheDocument()
  })
})
