import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizePathname, readNavigationLocation, useRememberedNavigationState } from './navigationState'

afterEach(() => {
  history.replaceState({}, '', '/')
  sessionStorage.clear()
})

describe('navigation state', () => {
  it('normalizes trailing slashes for every route', () => {
    expect(normalizePathname('/account/')).toBe('/account')
    expect(normalizePathname('/admin///')).toBe('/admin')
    expect(normalizePathname('/quiz/example/')).toBe('/quiz/example')
    expect(normalizePathname('/')).toBe('/')
  })

  it('updates the browser URL to its canonical route', () => {
    history.replaceState({}, '', '/admin/?mode=test#panel')

    expect(readNavigationLocation(true)).toEqual({ pathname: '/admin', search: '?mode=test' })
    expect(`${location.pathname}${location.search}${location.hash}`).toBe('/admin?mode=test#panel')
  })

  it('restores an internal section after remounting', () => {
    const allowed = ['overview', 'editor'] as const
    function Section() {
      const [section, setSection] = useRememberedNavigationState('test-section', 'overview', allowed)
      return <button onClick={() => setSection('editor')}>{section}</button>
    }

    const first = render(<Section />)
    fireEvent.click(screen.getByRole('button', { name: 'overview' }))
    expect(screen.getByRole('button', { name: 'editor' })).toBeInTheDocument()
    first.unmount()

    render(<Section />)
    expect(screen.getByRole('button', { name: 'editor' })).toBeInTheDocument()
  })
})
