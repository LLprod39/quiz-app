import { render, screen } from '@testing-library/react'
import { MemoryRouter } from '../lib/router'
import { describe, expect, it } from 'vitest'
import { HomePage } from './HomePage'

describe('HomePage', () => {
  it('shows the room entry and organizer navigation', () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: /создайте квиз/i })).toBeInTheDocument()
    expect(screen.getByText(/тематический квиз-баттл/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/код комнаты/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /организатору/i })).toHaveAttribute('href', '/admin')
  })
})
