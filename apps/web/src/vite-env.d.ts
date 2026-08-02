/// <reference types="vite/client" />

declare interface Window {
  render_game_to_text: () => string
  advanceTime: (ms: number) => void
}
