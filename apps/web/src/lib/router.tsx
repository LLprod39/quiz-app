import { createContext, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type PropsWithChildren } from 'react'

type LocationValue = { pathname: string; search: string; navigate: (to: string, replace?: boolean) => void }
const RouterContext = createContext<LocationValue | null>(null)

export function BrowserRouter({ children }: PropsWithChildren) {
  const [current, setCurrent] = useState(() => ({ pathname: window.location.pathname, search: window.location.search }))
  useEffect(() => { const update = () => setCurrent({ pathname: location.pathname, search: location.search }); addEventListener('popstate', update); return () => removeEventListener('popstate', update) }, [])
  const navigate = (to: string, replace = false) => { replace ? history.replaceState({}, '', to) : history.pushState({}, '', to); setCurrent({ pathname: location.pathname, search: location.search }); scrollTo(0, 0) }
  return <RouterContext.Provider value={{ ...current, navigate }}>{children}</RouterContext.Provider>
}

export const MemoryRouter = BrowserRouter

export function useLocation() { const value = useContext(RouterContext); if (!value) throw new Error('Router is missing'); return value }
export function useNavigate() { return useLocation().navigate }
export function useSearchParams(): [URLSearchParams] { return [new URLSearchParams(useLocation().search)] }
export function useParams(): Record<string, string | undefined> {
  const parts = useLocation().pathname.split('/').filter(Boolean)
  if (['join', 'play', 'screen'].includes(parts[0])) return { code: parts[1] }
  if (parts[0] === 'hero') return { token: parts[1] }
  if (parts[0] === 'quiz') return { slug: parts[1] }
  return {}
}

export function Link({ to, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const navigate = useNavigate()
  return <a href={to} {...props} onClick={event => { onClick?.(event); if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(to) } }} />
}

export function Navigate({ to, replace = false }: { to: string; replace?: boolean }) { const navigate = useNavigate(); useEffect(() => navigate(to, replace), [to, replace]); return null }
