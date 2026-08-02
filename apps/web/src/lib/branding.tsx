import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, PropsWithChildren } from 'react'
import type { ThemeConfig } from '../types'
import { api } from './api'

export const DEFAULT_BRANDING: ThemeConfig = {
  accent: '#ff6b6b',
  secondary: '#8b5cf6',
  background: '#111120',
  panel: '#1a1a2b',
  panel_2: '#222237',
  text: '#f7f2eb',
  muted: '#aaa8b7',
  mode: 'dark',
  decor: 'confetti',
  theme_preset: 'coral-night',
  brand_name: 'Quiz App',
  brand_tagline: 'викторина для своих',
  logo_mark: 'QA',
  landing_eyebrow: 'Любой повод. Любая тема. Одна игра.',
  landing_title: 'Создайте квиз,',
  landing_highlight: 'который запомнят',
  landing_description: 'Праздник о близком человеке или тематический квиз-баттл о кино, музыке, спорте и чём угодно. Игроки отвечают с телефонов, а игра оживает на большом экране.',
  organizer_link_label: 'Организатору',
  join_code_label: 'Код комнаты',
  join_button_label: 'Войти в игру',
  trust_no_registration: 'Без регистрации',
  trust_players: 'До 100+ игроков',
  trust_offline: 'Работает без интернета',
  step_format: 'Выберите формат и тему',
  step_join: 'Игроки войдут по QR-коду',
  step_show: 'Устройте настоящее шоу',
}

export const THEME_PRESETS: { id: string; name: string; description: string; colors: Partial<ThemeConfig> }[] = [
  { id: 'coral-night', name: 'Коралловая ночь', description: 'Тёплая и праздничная', colors: { accent: '#ff6b6b', secondary: '#8b5cf6', background: '#111120', panel: '#1a1a2b', panel_2: '#222237', text: '#f7f2eb', muted: '#aaa8b7', decor: 'confetti' } },
  { id: 'electric-violet', name: 'Электрический фиолетовый', description: 'Ярко и энергично', colors: { accent: '#a78bfa', secondary: '#ec4899', background: '#0e0b1d', panel: '#19132c', panel_2: '#251c3d', text: '#faf7ff', muted: '#aaa2bf', decor: 'neon' } },
  { id: 'emerald-stage', name: 'Изумрудная сцена', description: 'Свежо и уверенно', colors: { accent: '#34d399', secondary: '#22d3ee', background: '#071612', panel: '#0f241e', panel_2: '#17342c', text: '#effdf8', muted: '#95b8ab', decor: 'glow' } },
  { id: 'midnight-blue', name: 'Полночный синий', description: 'Спокойно и технологично', colors: { accent: '#60a5fa', secondary: '#818cf8', background: '#08101f', panel: '#101c31', panel_2: '#182a46', text: '#f2f7ff', muted: '#97a6bd', decor: 'minimal' } },
  { id: 'sunset-show', name: 'Закатное шоу', description: 'Тёпло и эффектно', colors: { accent: '#fb923c', secondary: '#f43f5e', background: '#1a0d12', panel: '#2a151b', panel_2: '#3a2024', text: '#fff7ed', muted: '#c2a39e', decor: 'confetti' } },
]

type BrandingContextValue = { branding: ThemeConfig; refreshBranding: () => Promise<void> }
const BrandingContext = createContext<BrandingContextValue>({ branding: DEFAULT_BRANDING, refreshBranding: async () => undefined })

function rgb(hex: string) {
  const value = hex.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(value)) return '255, 107, 107'
  return `${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}`
}

export function themeStyle(theme: ThemeConfig): CSSProperties {
  return {
    '--accent': theme.accent,
    '--accent-rgb': rgb(theme.accent),
    '--secondary': theme.secondary,
    '--secondary-rgb': rgb(theme.secondary),
    '--bg': theme.background,
    '--panel': theme.panel,
    '--panel-2': theme.panel_2,
    '--text': theme.text,
    '--muted': theme.muted,
  } as CSSProperties
}

export function BrandingProvider({ children }: PropsWithChildren) {
  const [branding, setBranding] = useState(DEFAULT_BRANDING)
  const refreshBranding = useCallback(async () => {
    try {
      const loaded = await api.branding()
      setBranding({ ...DEFAULT_BRANDING, ...loaded })
    } catch {
      setBranding(current => current || DEFAULT_BRANDING)
    }
  }, [])

  useEffect(() => { void refreshBranding() }, [refreshBranding])
  useEffect(() => { document.title = branding.brand_name }, [branding.brand_name])

  const style = useMemo(() => themeStyle(branding), [branding])

  return <BrandingContext.Provider value={{ branding, refreshBranding }}><div className={`app-theme decor-${branding.decor}`} style={style}>{children}</div></BrandingContext.Provider>
}

export function useBranding() { return useContext(BrandingContext) }
