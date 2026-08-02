import { describe, expect, it } from 'vitest'
import { createId } from './id'

describe('createId', () => {
  it('creates a UUID when randomUUID is unavailable on LAN HTTP', () => {
    let value = 0
    const cryptoWithoutRandomUuid = {
      getRandomValues: <T extends ArrayBufferView | null>(array: T) => {
        const bytes = array as Uint8Array
        bytes.forEach((_, index) => { bytes[index] = value++ })
        return array
      },
    }

    expect(createId(cryptoWithoutRandomUuid)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})
