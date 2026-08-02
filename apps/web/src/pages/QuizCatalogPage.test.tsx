import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BRANDING } from '../lib/branding'
import { api } from '../lib/api'
import { MemoryRouter } from '../lib/router'
import type { QuizPack } from '../types'
import { QuizCatalogPage } from './QuizCatalogPage'

const pack: QuizPack = {
  slug: 'marvel-universe', title: 'Marvel Quiz Battle', topic: 'Marvel', icon: '🦸',
  short_description: '20 вопросов о героях.', description: 'Готовый командный квиз о вселенной Marvel.',
  estimated_minutes: 35, difficulty: 'Средняя', round_title: 'Marvel',
  disclaimer: 'Фанатский образовательный квиз.', theme: { ...DEFAULT_BRANDING, brand_name: 'Marvel Quiz Battle', logo_mark: 'MV', accent: '#ef4444' },
  sources: [{ name: 'Wikidata', url: 'https://www.wikidata.org/', license: 'CC0 1.0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/' }],
  question_count: 20, sample_questions: ['Как называется молот Тора?', 'Как зовут Человека-паука?'],
}

afterEach(() => { vi.restoreAllMocks(); history.replaceState({}, '', '/') })

describe('QuizCatalogPage', () => {
  it('shows standalone quiz packs in the public catalog', async () => {
    history.replaceState({}, '', '/quizzes')
    vi.spyOn(api, 'quizPacks').mockResolvedValue([pack])
    render(<MemoryRouter><QuizCatalogPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Marvel Quiz Battle' })).toBeInTheDocument()
    expect(screen.getByText('20 вопросов')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /подробнее/i })).toHaveAttribute('href', '/quiz/marvel-universe')
  })

  it('uses the pack identity and exposes its sources on a dedicated page', async () => {
    history.replaceState({}, '', '/quiz/marvel-universe')
    vi.spyOn(api, 'quizPack').mockResolvedValue(pack)
    render(<MemoryRouter><QuizCatalogPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Marvel Quiz Battle', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Как называется молот Тора?')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /wikidata/i })).toHaveAttribute('href', 'https://www.wikidata.org/')
    await waitFor(() => expect(document.title).toBe('Marvel Quiz Battle'))
  })
})
