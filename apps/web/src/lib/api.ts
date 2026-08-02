import type { EventData, Question, Snapshot } from '../types'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

async function request<T>(path: string, options: RequestInit = {}, admin = false): Promise<T> {
  const token = localStorage.getItem('admin_token')
  const headers = new Headers(options.headers)
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (admin && token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: 'Ошибка соединения' }))
    throw new ApiError(response.status, body.detail || 'Ошибка запроса')
  }
  return response.json()
}

export const api = {
  login: (email: string, password: string) => request<{ access_token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  events: () => request<EventData[]>('/events', {}, true),
  createEvent: (data: unknown) => request<EventData>('/events', { method: 'POST', body: JSON.stringify(data) }, true),
  updateEvent: (id: string, data: Partial<EventData>) => request<EventData>(`/events/${id}`, { method: 'PUT', body: JSON.stringify(data) }, true),
  archiveEvent: (id: string) => request<{ status: string }>(`/events/${id}/archive`, { method: 'POST' }, true),
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
