import { describe, expect, it } from 'vitest'
import { cleanQuizPackJsonInput } from './quizPackImport'

describe('cleanQuizPackJsonInput', () => {
  it('removes code fences and invalid escaped URL parentheses', () => {
    const cleaned = cleanQuizPackJsonInput('```json\n{"url":"https://example.org/wiki/Test\\)"}\n```')
    expect(JSON.parse(cleaned)).toEqual({ url: 'https://example.org/wiki/Test)' })
  })
})
