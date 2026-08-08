export type GameStatus = 'lobby' | 'countdown' | 'answering' | 'locked' | 'review' | 'reveal' | 'between_questions' | 'paused' | 'cancelled' | 'finished' | 'archived'

export interface Account { id: string; phone: string; display_name: string; avatar: string; avatar_kind: 'preset' | 'upload'; role: 'user' | 'superadmin'; status: string; created_at: string; last_login_at?: string | null }
export interface AccountSession { id: string; device_name: string; browser: string; os: string; ip_address: string; created_at: string; last_seen_at: string; expires_at: string; revoked_at?: string | null; is_current: boolean }
export interface Plan { id: string; code: string; name: string; description: string; price_minor?: number | null; currency: string; is_public: boolean; is_active: boolean; sort_order: number; quotas: Record<string, number | null> }
export interface PlanUsage { plan: Plan; subscription?: { id: string; status: string; current_period_end?: string | null } | null; usage: Record<string, { current: number; limit: number | null }> }
export interface SystemAccount extends Account { plan: Plan; quiz_count: number; active_session_count: number }
export interface SystemDashboard { accounts: number; active_accounts: number; quizzes: number; active_rooms: number; active_devices: number }

export interface Option { id: string; text: string; is_correct?: boolean; sort_order?: number }
export interface SpeechStyleSettings {
  preset: 'classic-host' | 'energetic-battle' | 'calm-family' | 'mystery-round' | 'final-question' | 'custom'
  pace: number; energy: number; pitch: number; expression: number; clarity: number; pause_ms: number; effects: string[]
}
export interface SpeechDefaults { voice_id: string; settings: SpeechStyleSettings }
export interface SpeechVersion {
  id: string; question_id: string; version_number: number; status: 'active' | 'candidate' | 'previous' | 'discarded'
  file_url: string; mime_type: string; source_text: string; source_hash: string
  voice_id: string; voice_presentation: 'female' | 'male'; settings: SpeechStyleSettings
  prompt_version: number; source: string; created_at: string | null; activated_at: string | null
}
export interface QuestionSpeech {
  active: SpeechVersion | null; candidate: SpeechVersion | null; previous: SpeechVersion | null
  versions: SpeechVersion[]; stale: boolean; uses_event_defaults: boolean; effective_settings: SpeechDefaults
}
export interface Question {
  id: string; round_id?: string; round_title: string; type: string; text: string
  time_limit_seconds: number; correct_answer?: unknown; accepted_answers?: string[]
  numeric_tolerance?: number | null; shuffle_options?: boolean; explanation?: string
  media_url?: string | null; media_type?: string | null; audio_replays?: number
  speech?: QuestionSpeech; speech_audio_url?: string | null; speech_audio_type?: string | null
  speech_settings_override?: SpeechDefaults | null
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
  difficulty: string; game_mode?: 'individual' | 'team'; round_title: string; disclaimer: string
  sources: QuizPackSource[]; theme: ThemeConfig
  question_count: number; sample_questions: string[]; is_custom: boolean
}
export type QuizPackDefinition = Record<string, unknown>
export interface EventData {
  id: string; title: string; event_format: 'celebration' | 'battle'; topic: string
  hero_name: string; event_date: string; status: string; is_selected: boolean
  created_at?: string | null; updated_at?: string | null
  game_mode: string; host_mode: 'auto' | 'manual'; auto_advance_seconds: number
  tv_display_mode: 'classic' | 'insights'; tv_chart_style: 'both' | 'pie' | 'bar'; theme: ThemeConfig
  speech_settings?: SpeechDefaults
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
  screen_url?: string
  session: { id: string; join_code: string; status: GameStatus; deployment_mode: string; current_question_index: number; question_count: number; deadline_at?: string | null; answered_count: number; answer_target_count: number }
  event: { id: string; title: string; event_format: 'celebration' | 'battle'; topic: string; hero_name: string; hero_photo_url?: string; game_mode: string; host_mode: 'auto' | 'manual'; auto_advance_seconds: number; tv_display_mode: 'classic' | 'insights'; tv_chart_style: 'both' | 'pie' | 'bar'; theme: ThemeConfig }
  question?: Question | null; participants: Participant[]; teams: Team[]; private_result?: Ranking | null; leaderboard: Ranking[]
  live_answers: LiveAnswer[]; answer_breakdown: AnswerBreakdown[]
}
