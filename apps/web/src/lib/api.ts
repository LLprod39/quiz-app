import type {
  Account, AccountSession, EventData, Plan, PlanUsage, Question, QuestionSpeech,
  QuizPack, QuizPackDefinition, Snapshot, SpeechDefaults, SpeechStyleSettings,
  SpeechVersion, SystemAccount, SystemDashboard, ThemeConfig,
} from '../types'
import { guestDeviceToken, screenDeviceToken } from './device'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

type ValidationIssue = { loc?: Array<string | number>; msg?: string; type?: string }

const fieldLabels: Record<string, string> = {
  slug: 'Идентификатор шаблона', title: 'Название', topic: 'Тема', icon: 'Иконка', short_description: 'Краткое описание',
  description: 'Описание', estimated_minutes: 'Длительность', difficulty: 'Сложность', game_mode: 'Режим игры', round_title: 'Название раунда',
  disclaimer: 'Примечание', sources: 'Источники', source_urls: 'Ссылки вопроса', url: 'Ссылка источника', license: 'Лицензия',
  license_url: 'Ссылка на лицензию', theme: 'Оформление', decor: 'Эффект оформления', questions: 'Вопросы', wrong_answers: 'Неверные ответы',
}

function issueLocation(issue: ValidationIssue): string {
  const loc = (issue.loc || []).filter(part => part !== 'body')
  const questionIndex = loc.findIndex(part => part === 'questions')
  if (questionIndex >= 0 && typeof loc[questionIndex + 1] === 'number') {
    const field = loc[questionIndex + 2]
    return `Вопрос ${Number(loc[questionIndex + 1]) + 1}${typeof field === 'string' ? ` · ${fieldLabels[field] || field}` : ''}`
  }
  const sourceIndex = loc.findIndex(part => part === 'sources')
  if (sourceIndex >= 0 && typeof loc[sourceIndex + 1] === 'number') {
    const field = loc[sourceIndex + 2]
    return `Источник ${Number(loc[sourceIndex + 1]) + 1}${typeof field === 'string' ? ` · ${fieldLabels[field] || field}` : ''}`
  }
  const field = [...loc].reverse().find(part => typeof part === 'string')
  return typeof field === 'string' ? fieldLabels[field] || field : 'Данные шаблона'
}

function issueMessage(issue: ValidationIssue): string {
  if (issue.type?.startsWith('url_')) return 'укажите обычную HTTPS-ссылку без Markdown-разметки'
  if (issue.type === 'string_too_long') return 'текст слишком длинный'
  if (issue.type === 'literal_error') return 'указано недопустимое значение'
  if (issue.type === 'json_invalid') return 'JSON записан с ошибкой'
  return (issue.msg || 'проверьте значение').replace(/^Value error,\s*/i, '')
}

export function formatApiErrorDetail(detail: unknown): string {
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const quota = detail as { code?: string; limit?: string; current?: number; maximum?: number }
    if (quota.code === 'quota_exceeded') return `Лимит тарифа «${quota.limit}» исчерпан: ${quota.current} из ${quota.maximum}`
  }
  if (!Array.isArray(detail)) return typeof detail === 'string' ? detail : 'Ошибка запроса'
  const lines = [...new Set(detail.map(raw => {
    const issue = raw as ValidationIssue
    return `${issueLocation(issue)}: ${issueMessage(issue)}`
  }))]
  const shown = lines.slice(0, 6)
  if (lines.length > shown.length) shown.push(`И ещё ${lines.length - shown.length} ошибок.`)
  return shown.join('\n') || 'Проверьте данные шаблона'
}

export async function fetchMicrosoftQuestionSpeech(screenToken: string, questionId: string, signal?: AbortSignal) {
  const response = await fetch(`${API_BASE}/speech/screens/${encodeURIComponent(screenToken)}/questions/${encodeURIComponent(questionId)}`, { signal })
  if (!response.ok) return null
  return {
    audio: await response.blob(),
    voice: response.headers.get('X-Speech-Voice') || 'Microsoft Speech',
  }
}

export interface SpeechMvpConfig {
  bridge_url: string
  prompt_version: number
  voices: { id: string; label: string; presentation: 'female' | 'male'; description: string }[]
  presets: Record<string, { label: string; voice_id?: string; pace?: number; energy?: number; pitch?: number; expression?: number; clarity?: number; pause_ms?: number; effects?: string[] }>
  defaults: SpeechDefaults
}

export interface SpeechAutomationTicket {
  status: 'ready' | 'already_ready'
  question_id: string
  active?: SpeechVersion
  text?: string
  source_hash?: string
  voice_id?: string
  voice_presentation?: 'female' | 'male'
  settings?: SpeechStyleSettings
  ticket?: string
  upload_path?: string
  expires_in_seconds?: number
}

export interface LocalSpeechBridgeHealth {
  status: 'ready' | 'setup_required'
  provider?: 'windows_tts' | 'gemini_api' | 'ai_studio_browser'
  windows_tts?: 'enabled' | 'disabled'
  gemini_api?: 'configured' | 'missing_key'
  agent_browser: 'installed' | 'missing'
  chrome: 'connected' | 'unavailable' | 'stopped'
  ai_studio: 'authenticated' | 'login_required' | 'unknown'
  busy: boolean
  stage: 'idle' | 'validating' | 'preparing_task' | 'windows_tts' | 'gemini_api' | 'browser_automation' | 'validating_download' | 'uploading' | 'completed'
}

export async function checkLocalSpeechBridge(bridgeUrl: string): Promise<LocalSpeechBridgeHealth> {
  const response = await fetch(`${bridgeUrl}/health`, { signal: AbortSignal.timeout(3000) })
  const body = await response.json().catch(() => null) as LocalSpeechBridgeHealth | null
  if (!response.ok || !body) throw new Error('Локальный помощник вернул некорректный статус')
  return body
}

export async function runLocalSpeechBridge(
  bridgeUrl: string,
  ticket: SpeechAutomationTicket,
  onProgress?: (health: LocalSpeechBridgeHealth) => void,
) {
  if (ticket.status !== 'ready' || !ticket.ticket || !ticket.upload_path) return { status: 'already_ready' }
  const generation = fetch(`${bridgeUrl}/generate-one`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question_id: ticket.question_id,
      text: ticket.text,
      source_hash: ticket.source_hash,
      voice_id: ticket.voice_id,
      voice_presentation: ticket.voice_presentation,
      settings: ticket.settings,
      upload_url: new URL(ticket.upload_path, window.location.origin).toString(),
      ticket: ticket.ticket,
    }),
  })
  const progressTimer = onProgress ? window.setInterval(() => {
    void checkLocalSpeechBridge(bridgeUrl).then(onProgress).catch(() => undefined)
  }, 700) : undefined
  try {
    const response = await generation
    const body = await response.json().catch(() => ({ error: 'bridge_error', detail: 'Локальный помощник вернул некорректный ответ' }))
    if (!response.ok) throw new Error(body.detail || body.error || 'Локальный помощник не выполнил озвучку')
    return body
  } finally {
    if (progressTimer !== undefined) window.clearInterval(progressTimer)
  }
}

async function request<T>(path: string, options: RequestInit = {}, admin = false): Promise<T> {
  const headers = new Headers(options.headers)
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const csrf = document.cookie.split('; ').find(item => item.startsWith('quiz_csrf='))?.split('=').slice(1).join('=')
  if (csrf && options.method && !['GET', 'HEAD', 'OPTIONS'].includes(options.method)) headers.set('X-CSRF-Token', decodeURIComponent(csrf))
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: 'Ошибка соединения' }))
    const detail = body.detail
    const message = formatApiErrorDetail(detail)
    throw new ApiError(response.status, message)
  }
  return response.json()
}

export const api = {
  branding: () => request<ThemeConfig>('/branding'),
  quizPacks: () => request<QuizPack[]>('/quiz-packs'),
  quizPack: (slug: string) => request<QuizPack>(`/quiz-packs/${encodeURIComponent(slug)}`),
  quizPackPrompt: (data: { topic: string; question_count: number; difficulty: string }) => request<{ prompt: string; topic: string; question_count: number }>('/quiz-packs/gpt-prompt', { method: 'POST', body: JSON.stringify(data) }, true),
  importQuizPack: (data: QuizPackDefinition) => request<QuizPack>('/quiz-packs/import', { method: 'POST', body: JSON.stringify(data) }, true),
  quizPackDefinition: (slug: string) => request<QuizPackDefinition>(`/quiz-packs/${encodeURIComponent(slug)}/definition`, {}, true),
  updateQuizPackDefinition: (slug: string, data: QuizPackDefinition) => request<QuizPack>(`/quiz-packs/${encodeURIComponent(slug)}/definition`, { method: 'PUT', body: JSON.stringify(data) }, true),
  deleteQuizPack: (slug: string) => request<{ status: string; slug: string }>(`/quiz-packs/${encodeURIComponent(slug)}`, { method: 'DELETE' }, true),
  installQuizPack: (slug: string, replaceActive = false) => request<EventData>(`/quiz-packs/${encodeURIComponent(slug)}/install`, { method: 'POST', body: JSON.stringify({ replace_active: replaceActive }) }, true),
  register: (data: { phone: string; password: string; display_name: string; avatar: string }) => request<{ account: Account; csrf_token: string }>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (phone: string, password: string) => request<{ account: Account; csrf_token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ phone, password }) }),
  me: () => request<Account>('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),
  logoutAll: () => request('/auth/logout-all', { method: 'POST' }),
  changePassword: (current_password: string, new_password: string) => request('/auth/password', { method: 'PUT', body: JSON.stringify({ current_password, new_password }) }),
  resetPassword: (token: string, new_password: string) => request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, new_password }) }),
  accountUsage: () => request<PlanUsage>('/account/usage'),
  updateProfile: (data: { display_name: string; avatar?: string }) => request<Account>('/account/profile', { method: 'PUT', body: JSON.stringify(data) }),
  uploadAvatar: (file: File) => { const body = new FormData(); body.append('file', file); return request<Account>('/account/avatar', { method: 'POST', body }) },
  accountHistory: () => request<any[]>('/account/history'),
  accountSessions: () => request<AccountSession[]>('/account/sessions'),
  renameAccountSession: (id: string, device_name: string) => request<AccountSession>(`/account/sessions/${id}`, { method: 'PUT', body: JSON.stringify({ device_name }) }),
  revokeAccountSession: (id: string) => request(`/account/sessions/${id}`, { method: 'DELETE' }),
  publicPlans: () => request<Plan[]>('/plans'),
  unclaimedResults: () => request<any[]>('/account/unclaimed-results', { headers: { 'X-Guest-Device-Token': guestDeviceToken() } }),
  claimResults: () => request<{ count: number }>('/account/claim-results', { method: 'POST', headers: { 'X-Guest-Device-Token': guestDeviceToken() } }),
  events: () => request<EventData[]>('/events', {}, true),
  createEvent: (data: unknown) => request<EventData>('/events', { method: 'POST', body: JSON.stringify(data) }, true),
  selectEvent: (id: string) => request<EventData>(`/events/${id}/select`, { method: 'POST' }, true),
  updateEvent: (id: string, data: Partial<EventData>) => request<EventData>(`/events/${id}`, { method: 'PUT', body: JSON.stringify(data) }, true),
  updateHostControl: (id: string, data: Pick<EventData, 'host_mode' | 'auto_advance_seconds'>) => request<EventData>(`/events/${id}/host-control`, { method: 'PUT', body: JSON.stringify(data) }, true),
  updateTvDisplay: (id: string, data: Pick<EventData, 'tv_display_mode' | 'tv_chart_style'>) => request<EventData>(`/events/${id}/tv-display`, { method: 'PUT', body: JSON.stringify(data) }, true),
  updateSpeechDefaults: (id: string, data: SpeechDefaults) => request<SpeechDefaults>(`/events/${id}/speech-settings`, { method: 'PUT', body: JSON.stringify(data) }, true),
  archiveEvent: (id: string) => request<{ status: string; selected_event_id?: string | null }>(`/events/${id}/archive`, { method: 'POST' }, true),
  restoreEvent: (id: string) => request<EventData>(`/events/${id}/restore`, { method: 'POST' }, true),
  addQuestionnaireItem: (eventId: string, text: string) => request(`/events/${eventId}/questionnaire/items`, { method: 'POST', body: JSON.stringify({ text, type: 'text' }) }, true),
  toQuestion: (itemId: string) => request(`/questionnaire-items/${itemId}/to-question`, { method: 'POST' }, true),
  questionnaire: (token: string) => request<any>(`/questionnaires/${token}`),
  submitQuestionnaire: (token: string, responses: Record<string, string>) => request(`/questionnaires/${token}/submit`, { method: 'POST', body: JSON.stringify({ responses }) }),
  createQuestion: (eventId: string, data: unknown) => request<Question>(`/events/${eventId}/questions`, { method: 'POST', body: JSON.stringify(data) }, true),
  updateQuestion: (id: string, data: unknown) => request<Question>(`/questions/${id}`, { method: 'PUT', body: JSON.stringify(data) }, true),
  speechMvpConfig: () => request<SpeechMvpConfig>('/speech/mvp/config', {}, true),
  questionSpeech: (id: string) => request<QuestionSpeech>(`/questions/${id}/speech`, {}, true),
  updateQuestionSpeechDefaults: (id: string, data: SpeechDefaults & { use_event_defaults: boolean }) => request<QuestionSpeech>(`/questions/${id}/speech-settings`, { method: 'PUT', body: JSON.stringify(data) }, true),
  speechTicket: (id: string, data: SpeechDefaults & { force?: boolean }) => request<SpeechAutomationTicket>(`/questions/${id}/speech/automation-ticket`, { method: 'POST', body: JSON.stringify(data) }, true),
  activateSpeech: (questionId: string, versionId: string) => request<QuestionSpeech>(`/questions/${questionId}/speech/versions/${versionId}/activate`, { method: 'POST' }, true),
  restoreSpeech: (questionId: string, versionId: string) => request<QuestionSpeech>(`/questions/${questionId}/speech/versions/${versionId}/restore`, { method: 'POST' }, true),
  deleteSpeech: (questionId: string, versionId: string, confirmActive = false) => request<QuestionSpeech>(`/questions/${questionId}/speech/versions/${versionId}?confirm_active=${confirmActive}`, { method: 'DELETE' }, true),
  addQuestionPresets: (eventId: string) => request<EventData>(`/events/${eventId}/question-presets`, { method: 'POST' }, true),
  deleteQuestion: (id: string) => request(`/questions/${id}`, { method: 'DELETE' }, true),
  openSession: (eventId: string) => request<Snapshot>(`/events/${eventId}/sessions`, { method: 'POST' }, true),
  snapshot: (code: string, token?: string) => request<Snapshot>(`/sessions/${code}${token ? `?device_token=${encodeURIComponent(token)}` : ''}`),
  guestProfile: () => request<{ display_name: string; avatar: string }>('/guest-device/profile', { headers: { 'X-Guest-Device-Token': guestDeviceToken() } }),
  join: (code: string, data: unknown) => request<any>(`/sessions/${code}/join`, { method: 'POST', body: JSON.stringify(data), headers: { 'X-Guest-Device-Token': guestDeviceToken() } }),
  requestTransfer: (code: string, data: unknown) => request<{ request_id: string; claim_token: string }>(`/sessions/${code}/transfer-requests`, { method: 'POST', body: JSON.stringify(data) }),
  claimTransfer: (code: string, requestId: string, claimToken: string) => request<any>(`/sessions/${code}/transfer-requests/${requestId}/claim`, { method: 'POST', body: JSON.stringify({ claim_token: claimToken }) }),
  transferRequests: (code: string) => request<any[]>(`/sessions/${code}/transfer-requests`, {}, true),
  approveTransfer: (code: string, requestId: string) => request(`/sessions/${code}/transfer-requests/${requestId}/approve`, { method: 'POST' }, true),
  ready: (code: string, data: unknown) => request<{ status: string; version: number }>(`/sessions/${code}/ready`, { method: 'POST', body: JSON.stringify(data) }),
  answer: (code: string, data: unknown) => request(`/sessions/${code}/answer`, { method: 'POST', body: JSON.stringify(data) }),
  heroChoice: (code: string, data: unknown) => request(`/sessions/${code}/hero-choice`, { method: 'POST', body: JSON.stringify(data) }),
  action: (code: string, action: string) => request<Snapshot>(`/sessions/${code}/actions`, { method: 'POST', body: JSON.stringify({ action }) }, true),
  results: (code: string) => request<any>(`/sessions/${code}/results`, {}, true),
  regenerateScreenAccess: (code: string) => request<{ screen_url: string; generation: number }>(`/sessions/${code}/screen-access`, { method: 'POST' }, true),
  screenState: (token: string) => request<Snapshot>(`/screens/${encodeURIComponent(token)}`, { headers: { 'X-Screen-Installation': screenDeviceToken() } }),
  screenDevices: (code: string) => request<any[]>(`/sessions/${code}/screens`, {}, true),
  upload: (eventId: string, file: File) => { const body = new FormData(); body.append('event_id', eventId); body.append('file', file); return request<{ url: string; type: string }>('/media', { method: 'POST', body }, true) },
  mediaAssets: () => request<any[]>('/media-assets'),
  deleteMediaAsset: (id: string) => request(`/media-assets/${id}`, { method: 'DELETE' }),
  systemDashboard: () => request<SystemDashboard>('/system/dashboard'),
  systemAccounts: (filters: { q?: string; status?: string; role?: string; plan?: string } | string = {}) => {
    const values = typeof filters === 'string' ? { q: filters } : filters
    const params = new URLSearchParams(Object.entries(values).filter(([, value]) => Boolean(value)) as [string, string][])
    return request<SystemAccount[]>(`/system/accounts${params.size ? `?${params}` : ''}`)
  },
  systemAccount: (id: string) => request<any>(`/system/accounts/${id}`),
  updateSystemAccount: (id: string, data: unknown) => request<SystemAccount>(`/system/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  createResetLink: (id: string) => request<{ reset_url: string }>(`/system/accounts/${id}/reset-link`, { method: 'POST' }),
  revokeSystemSession: (accountId: string, sessionId: string) => request(`/system/accounts/${accountId}/sessions/${sessionId}/revoke`, { method: 'POST' }),
  systemPlans: () => request<Plan[]>('/system/plans'),
  createSystemPlan: (data: unknown) => request<Plan>('/system/plans', { method: 'POST', body: JSON.stringify(data) }),
  updateSystemPlan: (id: string, data: unknown) => request<Plan>(`/system/plans/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  assignSubscription: (id: string, data: unknown) => request(`/system/accounts/${id}/subscription`, { method: 'POST', body: JSON.stringify(data) }),
  systemQuizzes: () => request<any[]>('/system/quizzes'),
  transferSystemQuiz: (id: string, owner_id: string) => request(`/system/quizzes/${id}/transfer`, { method: 'POST', body: JSON.stringify({ owner_id }) }),
  archiveSystemQuiz: (id: string) => request(`/system/quizzes/${id}/archive`, { method: 'POST' }),
  stopSystemSession: (id: string) => request(`/system/sessions/${id}/stop`, { method: 'POST' }),
  systemTemplates: () => request<any[]>('/system/quiz-packs'),
  publishSystemTemplate: (id: string) => request(`/system/quiz-packs/${id}/publish`, { method: 'POST' }),
  unpublishSystemTemplate: (id: string) => request(`/system/quiz-packs/${id}/publication`, { method: 'DELETE' }),
  systemDevices: () => request<any>('/system/devices'),
  systemAudit: () => request<any[]>('/system/audit'),
}

export function wsUrl(code: string, token?: string): string {
  const explicit = import.meta.env.VITE_WS_BASE
  const base = explicit || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
  return `${base}/ws/${code}${token ? `?token=${encodeURIComponent(token)}` : ''}`
}

export function screenWsUrl(token: string): string {
  const explicit = import.meta.env.VITE_WS_BASE
  const base = explicit || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
  return `${base}/ws/screens/${encodeURIComponent(token)}`
}
