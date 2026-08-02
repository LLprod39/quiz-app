import { create } from 'zustand'
import type { Snapshot } from '../types'
import { api, wsUrl } from '../lib/api'

interface GameStore {
  snapshot: Snapshot | null
  connection: 'connecting' | 'online' | 'offline'
  latency: number | null
  socket: WebSocket | null
  connect: (code: string, token?: string) => void
  refresh: (code: string, token?: string) => Promise<void>
  disconnect: () => void
}

export const useGameStore = create<GameStore>((set, get) => ({
  snapshot: null,
  connection: 'offline',
  latency: null,
  socket: null,
  connect: (code, token) => {
    get().socket?.close()
    set({ connection: 'connecting' })
    const socket = new WebSocket(wsUrl(code, token))
    socket.onopen = () => {
      set({ connection: 'online' })
      const sent = Date.now()
      socket.send(JSON.stringify({ type: 'ping', sent_at: sent }))
    }
    socket.onmessage = event => {
      const payload = JSON.parse(event.data)
      if (payload.type === 'pong') set({ latency: Date.now() - Number(payload.sent_at) })
      if (payload.type === 'session.snapshot') {
        const current = get().snapshot
        if (!current || payload.version >= current.version) {
          set({ snapshot: payload })
          if (token) api.snapshot(code, token).then(snapshot => set({ snapshot })).catch(() => undefined)
        }
      }
      if (payload.type === 'participant.joined') {
        const current = get().snapshot
        if (current && payload.version > current.version && !current.participants.some(item => item.id === payload.participant.id)) {
          set({ snapshot: { ...current, version: payload.version, participants: [...current.participants, payload.participant] } })
        }
      }
      if (payload.type === 'participant.ready') {
        const current = get().snapshot
        if (current && payload.version >= current.version) {
          set({ snapshot: { ...current, version: payload.version, participants: current.participants.map(item => item.id === payload.participant_id ? { ...item, ready: true, latency_ms: payload.latency_ms } : item) } })
        }
      }
      if (payload.type === 'question.progress') {
        const current = get().snapshot
        if (current && payload.version >= current.version) {
          set({ snapshot: { ...current, version: payload.version, session: { ...current.session, answered_count: payload.answered_count } } })
        }
      }
    }
    socket.onclose = () => {
      if (get().socket !== socket) return
      set({ connection: 'offline', socket: null })
      window.setTimeout(() => get().connect(code, token), 1500)
    }
    set({ socket })
  },
  refresh: async (code, token) => set({ snapshot: await api.snapshot(code, token) }),
  disconnect: () => { get().socket?.close(); set({ socket: null, connection: 'offline' }) },
}))
