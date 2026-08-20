import { describe, expect, it } from 'vitest'
import { browserNetworkExecutionHostStorageIdentity } from './browser-execution-host-storage-identity'
import { browserNetworkExecutionHostKey } from './browser-network-execution-route'

const storageKey = 'a'.repeat(64)
const otherStorageKey = 'b'.repeat(64)

describe('browserNetworkExecutionHostStorageIdentity', () => {
  it('ignores the per-boot components the route key fences on', () => {
    expect(
      browserNetworkExecutionHostStorageIdentity(
        { kind: 'native', runtimeId: 'runtime-a', revision: 1 },
        storageKey
      )
    ).toBe(
      browserNetworkExecutionHostStorageIdentity(
        { kind: 'native', runtimeId: 'runtime-a', revision: 2 },
        storageKey
      )
    )
    expect(
      browserNetworkExecutionHostStorageIdentity(
        { kind: 'wsl', runtimeId: 'runtime-a', revision: 1, distro: 'Ubuntu' },
        storageKey
      )
    ).toBe(
      browserNetworkExecutionHostStorageIdentity(
        { kind: 'wsl', runtimeId: 'runtime-a', revision: 2, distro: 'Ubuntu' },
        storageKey
      )
    )
    expect(
      browserNetworkExecutionHostStorageIdentity(
        { kind: 'ssh', targetId: 'ssh-1', providerEpoch: 'epoch-a', connectionGeneration: 1 },
        storageKey
      )
    ).toBe(
      browserNetworkExecutionHostStorageIdentity(
        { kind: 'ssh', targetId: 'ssh-1', providerEpoch: 'epoch-b', connectionGeneration: 2 },
        storageKey
      )
    )
  })

  // Why: runtimeId is a per-process randomUUID, so hashing it minted a fresh partition on
  // every remote-server restart and dropped the user's cookies.
  it('survives the authority runtime restarting under a new runtimeId', () => {
    expect(
      browserNetworkExecutionHostStorageIdentity(
        { kind: 'native', runtimeId: 'runtime-a', revision: 1 },
        storageKey
      )
    ).toBe(
      browserNetworkExecutionHostStorageIdentity(
        { kind: 'native', runtimeId: 'runtime-b', revision: 9 },
        storageKey
      )
    )
    expect(
      browserNetworkExecutionHostStorageIdentity(
        { kind: 'wsl', runtimeId: 'runtime-a', revision: 1, distro: 'Ubuntu' },
        storageKey
      )
    ).toBe(
      browserNetworkExecutionHostStorageIdentity(
        { kind: 'wsl', runtimeId: 'runtime-b', revision: 9, distro: 'Ubuntu' },
        storageKey
      )
    )
  })

  it('separates every boundary that changes storage or egress', () => {
    const identities = [
      browserNetworkExecutionHostStorageIdentity(
        { kind: 'native', runtimeId: 'runtime-a', revision: 1 },
        storageKey
      ),
      browserNetworkExecutionHostStorageIdentity(
        { kind: 'native', runtimeId: 'runtime-a', revision: 1 },
        otherStorageKey
      ),
      browserNetworkExecutionHostStorageIdentity(
        { kind: 'wsl', runtimeId: 'runtime-a', revision: 1, distro: 'Ubuntu' },
        storageKey
      ),
      browserNetworkExecutionHostStorageIdentity(
        { kind: 'wsl', runtimeId: 'runtime-a', revision: 1, distro: 'Debian' },
        storageKey
      ),
      browserNetworkExecutionHostStorageIdentity(
        { kind: 'wsl', runtimeId: 'runtime-a', revision: 1, distro: 'Ubuntu' },
        otherStorageKey
      ),
      browserNetworkExecutionHostStorageIdentity(
        { kind: 'ssh', targetId: 'ssh-1', providerEpoch: 'epoch-a', connectionGeneration: 1 },
        storageKey
      ),
      browserNetworkExecutionHostStorageIdentity(
        { kind: 'ssh', targetId: 'ssh-2', providerEpoch: 'epoch-a', connectionGeneration: 1 },
        storageKey
      )
    ]

    expect(new Set(identities).size).toBe(identities.length)
  })

  it('keeps delimiter-bearing components structurally distinct', () => {
    expect(
      browserNetworkExecutionHostStorageIdentity(
        { kind: 'wsl', runtimeId: 'a', revision: 1, distro: 'b","c' },
        'a'
      )
    ).not.toBe(
      browserNetworkExecutionHostStorageIdentity(
        { kind: 'wsl', runtimeId: 'a', revision: 1, distro: 'c' },
        'a","b'
      )
    )
  })

  it('is never mistaken for a route fencing key', () => {
    const host = {
      kind: 'native',
      runtimeId: 'runtime-a',
      revision: 7
    } as const

    expect(browserNetworkExecutionHostStorageIdentity(host, storageKey)).not.toBe(
      browserNetworkExecutionHostKey(host)
    )
  })
})
