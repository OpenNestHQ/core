import { afterEach, describe, expect, it, vi } from 'vitest'
import { newId } from './id'

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('newId', () => {
  it('works where crypto.randomUUID is missing (plain HTTP on a LAN IP)', () => {
    // Browsers only expose randomUUID in secure contexts; getRandomValues
    // is always there.
    vi.stubGlobal('crypto', {
      getRandomValues: globalThis.crypto.getRandomValues.bind(
        globalThis.crypto,
      ),
    })
    const a = newId()
    const b = newId()
    expect(a).toMatch(UUID_V4)
    expect(b).toMatch(UUID_V4)
    expect(a).not.toBe(b)
  })

  it('uses crypto.randomUUID when available', () => {
    expect(newId()).toMatch(UUID_V4)
  })
})
