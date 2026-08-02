export type GameStatus = 'lobby' | 'countdown' | 'answering' | 'locked' | 'review' | 'reveal' | 'between_questions' | 'paused' | 'cancelled' | 'finished' | 'archived'

export interface Option { id: string; text: string; is_correct?: boolean; sort_order?: number }
export interface Question {
  id: string; round_id?: string; round_title: string; type: string; text: string
  time_limit_seconds: number; correct_answer?: unknown; accepted_answers?: string[]
  numeric_tolerance?: number | null; shuffle_options?: boolean; explanation?: string
  media_url?: string | null; media_type?: string | null; audio_replays?: number
  sort_order?: number; options: Option[]
}
export interface Round { id: string; title: string; sort_order: number; questions: Question[] }
export interface QuestionnaireItem { id: string; text: string; type: string; sort_order: number; response: string }
export interface Questionnaire { id: string; event_id: string; public_token: string; public_url: string; status: string; items: QuestionnaireItem[] }
export interface EventData {
  id: string; title: string; event_format: 'celebration' | 'battle'; topic: string
  hero_name: string; event_date: string; status: string
  game_mode: string; theme: { accent: string; mode: string; decor: string }
  hero_photo_url?: string | null; allow_late_join: boolean; question_count: number
  active_session_code?: string | null; latest_session_code?: string | null
  sessions: { id: string; join_code: string; status: string; participant_count: number; started_at?: string | null; finished_at?: string | null }[]
  rounds: Round[]; questionnaire: Questionnaire | null
}
export interface Participant { id: string; name: string; avatar: string; role: string; team_id?: string; ready: boolean; connection_status: string; latency_ms?: number; eligible: boolean }
export interface Team { id: string; name: string; avatar: string; color: string; captain_participant_id?: string }
export interface Ranking { id: string; name: string; avatar: string; color?: string; correct_count: number; correct_time_ms: number; rank: number; answer?: unknown; elapsed_ms?: number; is_correct?: boolean | null }
export interface Snapshot {
  type: string; version: number; server_time: string
  session: { id: string; join_code: string; status: GameStatus; deployment_mode: string; current_question_index: number; question_count: number; deadline_at?: string | null; answered_count: number }
  event: { id: string; title: string; event_format: 'celebration' | 'battle'; topic: string; hero_name: string; hero_photo_url?: string; game_mode: string; theme: { accent: string; mode: string; decor: string } }
  question?: Question | null; participants: Participant[]; teams: Team[]; private_result?: Ranking | null; leaderboard: Ranking[]
}
