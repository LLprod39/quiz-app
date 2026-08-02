import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CountdownNumber } from './Timer'


afterEach(() => vi.useRealTimers())

describe('CountdownNumber', () => {
  it('decreases from the server deadline instead of showing a fixed three', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'))
    render(<CountdownNumber deadline="2026-08-02T12:00:03.000Z" serverTime="2026-08-02T12:00:00.000Z" total={3} />)

    expect(screen.getByText('3')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1100))
    expect(screen.getByText('2')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('shows a waiting state when manual mode has no deadline', () => {
    render(<CountdownNumber deadline={null} total={5} />)
    expect(screen.getByLabelText('Ожидаем организатора')).toHaveTextContent('…')
  })
})
