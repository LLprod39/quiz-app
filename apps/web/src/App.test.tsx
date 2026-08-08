import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { api } from './lib/api'
import { MemoryRouter } from './lib/router'

afterEach(() => {
  vi.restoreAllMocks()
  history.replaceState({}, '', '/')
})

describe('App routes', () => {
  it('keeps the account page open when the URL has a trailing slash', async () => {
    history.replaceState({}, '', '/account/')
    vi.spyOn(api, 'me').mockRejectedValue(new Error('Not authenticated'))

    render(<MemoryRouter><App /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: /с возвращением/i })).toBeInTheDocument()
    expect(location.pathname).toBe('/account')
  })
})
