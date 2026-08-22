import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readBrowserClientHostId,
  resetBrowserClientHostIdForTests
} from './browser-client-host-identity'

afterEach(() => {
  vi.unstubAllGlobals()
  resetBrowserClientHostIdForTests()
})

describe('readBrowserClientHostId', () => {
  it('reads the id its main process reports', () => {
    vi.stubGlobal('api', { browser: { readClientHostId: () => 'browser-host-a' } })

    expect(readBrowserClientHostId()).toBe('browser-host-a')
  })

  // Why the read is not repeated: it is a blocking round trip to main, and the id it returns is
  // fixed for the life of the process.
  it('asks main once and answers from the cache after that', () => {
    const readClientHostId = vi.fn(() => 'browser-host-a')
    vi.stubGlobal('api', { browser: { readClientHostId } })

    expect([readBrowserClientHostId(), readBrowserClientHostId()]).toEqual([
      'browser-host-a',
      'browser-host-a'
    ])
    expect(readClientHostId).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a client whose api cannot answer', { browser: {} }],
    ['a client with no api at all', undefined],
    ['a main process that declines the read', { browser: { readClientHostId: () => null } }]
  ])('reports no host id for %s', (_label, api) => {
    vi.stubGlobal('api', api)

    expect(readBrowserClientHostId()).toBeNull()
  })

  // Why null is not cached: it means the answer was unavailable, not that this client will never
  // host — a caller that asked too early must not be told "never" for the rest of the session.
  it('keeps asking until main answers', () => {
    const readClientHostId = vi
      .fn<() => string | null>()
      .mockImplementationOnce(() => {
        throw new Error('no handler yet')
      })
      .mockImplementationOnce(() => null)
      .mockImplementation(() => 'browser-host-a')
    vi.stubGlobal('api', { browser: { readClientHostId } })

    expect([
      readBrowserClientHostId(),
      readBrowserClientHostId(),
      readBrowserClientHostId()
    ]).toEqual([null, null, 'browser-host-a'])
  })
})
