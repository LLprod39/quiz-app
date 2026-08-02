import type { EventData, Question, QuizPack, QuizPackDefinition, Snapshot, ThemeConfig } from '../types'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

export async function fetchMicrosoftQuestionSpeech(code: string, questionId: string, signal?: AbortSignal) {
  const response = await fetch(`${API_BASE}/speech/sessions/${encodeURIComponent(code)}/questions/${encodeURIComponent(questionId)}`, { signal })
  if (!response.ok) return null
  return {
    audio: await response.blob(),
    voice: response.headers.get('X-Speech-Voice') || 'Microsoft Speech',
  }
}

async function request<T>(path: string, options: RequestInit = {}, admin = false): Promise<T> {
  const token = localStorage.getItem('admin_token')
  const headers = new Headers(options.headers)
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (admin && token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: 'Ошибка соединения' }))
    const detail = body.detail
    const message = Array.isArray(detail) ? detail.map(item => item?.msg || String(item)).join('; ') : detail || 'Ошибка запроса'
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
  login: (email: string, password: string) => request<{ access_token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  events: () => request<EventData[]>('/events', {}, true),
  createEvent: (data: unknown) => request<EventData>('/events', { method: 'POST', body: JSON.stringify(data) }, true),
  selectEvent: (id: string) => request<EventData>(`/events/${id}/select`, { method: 'POST' }, true),
  updateEvent: (id: string, data: Partial<EventData>) => request<EventData>(`/events/${id}`, { method: 'PUT', body: JSON.stringify(data) }, true),
  updateHostControl: (id: string, data: Pick<EventData, 'host_mode' | 'auto_advance_seconds'>) => request<EventData>(`/events/${id}/host-control`, { method: 'PUT', body: JSON.stringify(data) }, true),
  updateTvDisplay: (id: string, data: Pick<EventData, 'tv_display_mode' | 'tv_chart_style'>) => request<EventData>(`/events/${id}/tv-display`, { method: 'PUT', body: JSON.stringify(data) }, true),
  archiveEvent: (id: string) => request<{ status: string; selected_event_id?: string | null }>(`/events/${id}/archive`, { method: 'POST' }, true),
  restoreEvent: (id: string) => request<EventData>(`/events/${id}/restore`, { method: 'POST' }, true),
  addQuestionnaireItem: (eventId: string, text: string) => request(`/events/${eventId}/questionnaire/items`, { method: 'POST', body: JSON.stringify({ text, type: 'text' }) }, true),
  toQuestion: (itemId: string) => request(`/questionnaire-items/${itemId}/to-question`, { method: 'POST' }, true),
  questionnaire: (token: string) => request<any>(`/questionnaires/${token}`),
  submitQuestionnaire: (token: string, responses: Record<string, string>) => request(`/questionnaires/${token}/submit`, { method: 'POST', body: JSON.stringify({ responses }) }),
  createQuestion: (eventId: string, data: unknown) => request<Question>(`/events/${eventId}/questions`, { method: 'POST', body: JSON.stringify(data) }, true),
  updateQuestion: (id: string, data: unknown) => request<Question>(`/questions/${id}`, { method: 'PUT', body: JSON.stringify(data) }, true),
  addQuestionPresets: (eventId: string) => request<EventData>(`/events/${eventId}/question-presets`, { method: 'POST' }, true),
  deleteQuestion: (id: string) => request(`/questions/${id}`, { method: 'DELETE' }, true),
  openSession: (eventId: string) => request<Snapshot>(`/events/${eventId}/sessions`, { method: 'POST' }, true),
  snapshot: (code: string, token?: string) => request<Snapshot>(`/sessions/${code}${token ? `?device_token=${encodeURIComponent(token)}` : ''}`),
  join: (code: string, data: unknown) => request<any>(`/sessions/${code}/join`, { method: 'POST', body: JSON.stringify(data) }),
  requestTransfer: (code: string, data: unknown) => request<{ request_id: string; claim_token: string }>(`/sessions/${code}/transfer-requests`, { method: 'POST', body: JSON.stringify(data) }),
  claimTransfer: (code: string, requestId: string, claimToken: string) => request<any>(`/sessions/${code}/transfer-requests/${requestId}/claim`, { method: 'POST', body: JSON.stringify({ claim_token: claimToken }) }),
  transferRequests: (code: string) => request<any[]>(`/sessions/${code}/transfer-requests`, {}, true),
  approveTransfer: (code: string, requestId: string) => request(`/sessions/${code}/transfer-requests/${requestId}/approve`, { method: 'POST' }, true),
  ready: (code: string, data: unknown) => request<{ status: string; version: number }>(`/sessions/${code}/ready`, { method: 'POST', body: JSON.stringify(data) }),
  answer: (code: string, data: unknown) => request(`/sessions/${code}/answer`, { method: 'POST', body: JSON.stringify(data) }),
  heroChoice: (code: string, data: unknown) => request(`/sessions/${code}/hero-choice`, { method: 'POST', body: JSON.stringify(data) }),
  action: (code: string, action: string) => request<Snapshot>(`/sessions/${code}/actions`, { method: 'POST', body: JSON.stringify({ action }) }, true),
  results: (code: string) => request<any>(`/sessions/${code}/results`, {}, true),
  upload: (eventId: string, file: File) => { const body = new FormData(); body.append('event_id', eventId); body.append('file', file); return request<{ url: string; type: string }>('/media', { method: 'POST', body }, true) },
}

export function wsUrl(code: string, token?: string): string {
  const explicit = import.meta.env.VITE_WS_BASE
  const base = explicit || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
  return `${base}/ws/${code}${token ? `?token=${encodeURIComponent(token)}` : ''}`
}
