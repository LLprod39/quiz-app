import { describe, expect, it } from 'vitest'
import { formatApiErrorDetail } from './api'

describe('formatApiErrorDetail', () => {
  it('turns verbose validation details into short useful instructions', () => {
    const result = formatApiErrorDetail([
      { loc: ['body', 'questions', 0, 'source_urls', 0], type: 'url_parsing', msg: 'Input should be a valid URL' },
      { loc: ['body', 'sources', 0, 'license'], type: 'string_too_long', msg: 'String should have at most 120 characters' },
      { loc: ['body', 'theme', 'decor'], type: 'literal_error', msg: 'Input should be confetti or glow' },
    ])

    expect(result).toContain('Вопрос 1 · Ссылки вопроса: укажите обычную HTTPS-ссылку без Markdown-разметки')
    expect(result).toContain('Источник 1 · Лицензия: текст слишком длинный')
    expect(result).toContain('Эффект оформления: указано недопустимое значение')
    expect(result).not.toContain('Input should')
  })
})
