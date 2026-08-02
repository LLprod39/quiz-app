import { useLocation } from './lib/router'
import { HomePage } from './pages/HomePage'
import { OrganizerPage } from './pages/OrganizerPage'
import { JoinPage } from './pages/JoinPage'
import { GuestPage } from './pages/GuestPage'
import { ScreenPage } from './pages/ScreenPage'
import { HeroPage } from './pages/HeroPage'

export default function App() {
  const { pathname, navigate } = useLocation()
  if (pathname === '/') return <HomePage />
  if (pathname === '/admin') return <OrganizerPage />
  if (pathname === '/join' || /^\/join\/[^/]+$/.test(pathname)) return <JoinPage />
  if (/^\/play\/[^/]+$/.test(pathname)) return <GuestPage />
  if (/^\/screen\/[^/]+$/.test(pathname)) return <ScreenPage />
  if (/^\/hero\/[^/]+$/.test(pathname)) return <HeroPage />
  queueMicrotask(() => navigate('/', true))
  return null
}
