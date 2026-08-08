import { useState, type Dispatch, type SetStateAction } from 'react'

const STORAGE_PREFIX = 'quiz-app:navigation:'

export type NavigationLocation = { pathname: string; search: string }

export function normalizePathname(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '')
  return normalized || '/'
}

export function readNavigationLocation(canonicalize = false): NavigationLocation {
  const pathname = normalizePathname(window.location.pathname)
  if (canonicalize && pathname !== window.location.pathname) {
    history.replaceState(history.state, '', `${pathname}${window.location.search}${window.location.hash}`)
  }
  return { pathname, search: window.location.search }
}

export function useRememberedNavigationState<T extends string>(
  key: string,
  initialValue: T,
  allowedValues: readonly T[],
): [T, Dispatch<SetStateAction<T>>] {
  const storageKey = `${STORAGE_PREFIX}${key}`
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = sessionStorage.getItem(storageKey)
      return saved && allowedValues.includes(saved as T) ? saved as T : initialValue
    } catch {
      return initialValue
    }
  })

  const setRememberedValue: Dispatch<SetStateAction<T>> = next => {
    setValue(current => {
      const candidate = typeof next === 'function' ? (next as (value: T) => T)(current) : next
      const resolved = allowedValues.includes(candidate) ? candidate : initialValue
      try { sessionStorage.setItem(storageKey, resolved) } catch { /* Storage can be unavailable in private mode. */ }
      return resolved
    })
  }

  return [value, setRememberedValue]
}
