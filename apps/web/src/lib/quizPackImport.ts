export function cleanQuizPackJsonInput(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/\\([()])/g, '$1')
}
