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
export interface ThemeConfig {
  accent: string; secondary: string; background: string; panel: string; panel_2: string
  text: string; muted: string; mode: 'dark'; decor: 'confetti' | 'glow' | 'minimal' | 'neon'
  theme_preset: string; brand_name: string; brand_tagline: string; logo_mark: string
  landing_eyebrow: string; landing_title: string; landing_highlight: string; landing_description: string
  organizer_link_label: string; join_code_label: string; join_button_label: string
  trust_no_registration: string; trust_players: string; trust_offline: string
  step_format: string; step_join: string; step_show: string
}
export interface QuizPackSource { name: string; url: string; license: string; license_url: string }
export interface QuizPack {
  slug: string; title: string; topic: string; icon: string
  short_description: string; description: string; estimated_minutes: number
  difficulty: string; round_title: string; disclaimer: string
  sources: QuizPackSource[]; theme: ThemeConfig
  question_count: number; sample_questions: string[]
}
export interface EventData {
  id: string; title: string; event_format: 'celebration' | 'battle'; topic: string
  hero_name: string; event_date: string; status: string; is_selected: boolean
  created_at?: string | null; updated_at?: string | null
  game_mode: string; host_mode: 'auto' | 'manual'; auto_advance_seconds: number
  tv_display_mode: 'classic' | 'insights'; tv_chart_style: 'both' | 'pie' | 'bar'; theme: ThemeConfig
  hero_photo_url?: string | null; allow_late_join: boolean; question_count: number
  active_session_code?: string | null; latest_session_code?: string | null
  sessions: { id: string; join_code: string; status: string; participant_count: number; started_at?: string | null; finished_at?: string | null }[]
  rounds: Round[]; questionnaire: Questionnaire | null
}
export interface Participant { id: string; name: string; avatar: string; role: string; team_id?: string; ready: boolean; connection_status: string; latency_ms?: number; eligible: boolean }
export interface Team { id: string; name: string; avatar: string; color: string; captain_participant_id?: string }
export interface Ranking { id: string; name: string; avatar: string; color?: string; correct_count: number; correct_time_ms: number; rank: number; answer?: unknown; elapsed_ms?: number; is_correct?: boolean | null }
export interface LiveAnswer { id: string; name: string; avatar: string; answer: string; submitted_at?: string | null }
export interface AnswerBreakdown { label: string; count: number; percent: number; color: string }
export interface Snapshot {
  type: string; version: number; server_time: string
  session: { id: string; join_code: string; status: GameStatus; deployment_mode: string; current_question_index: number; question_count: number; deadline_at?: string | null; answered_count: number; answer_target_count: number }
  event: { id: string; title: string; event_format: 'celebration' | 'battle'; topic: string; hero_name: string; hero_photo_url?: string; game_mode: string; host_mode: 'auto' | 'manual'; auto_advance_seconds: number; tv_display_mode: 'classic' | 'insights'; tv_chart_style: 'both' | 'pie' | 'bar'; theme: ThemeConfig }
  question?: Question | null; participants: Participant[]; teams: Team[]; private_result?: Ranking | null; leaderboard: Ranking[]
  live_answers: LiveAnswer[]; answer_breakdown: AnswerBreakdown[]
}
