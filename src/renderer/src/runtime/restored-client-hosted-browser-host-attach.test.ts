import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ensureBrowserClientHostsForRestoredPages,
  resetRestoredBrowserClientHostAttachForTests
} from './restored-client-hosted-browser-host-attach'

const prepareBrowserClientHostPlacement = vi.fn(async (_args: { selector: string }) => ({
  kind: 'server' as const
}))

function handles(
  entries: Record<string, { environmentId: string; clientHosted?: true }>
): Parameters<typeof ensureBrowserClientHostsForRestoredPages>[0] {
  return {
    remoteBrowserPageHandlesByPageId: Object.fromEntries(
      Object.entries(entries).map(([pageId, entry]) => [
        pageId,
        {
          environmentId: entry.environmentId,
          remotePageId: `remote-${pageId}`,
          restoredFromSession: true as const,
          ...(entry.clientHosted ? { restoredClientHosted: true as const } : {})
        }
      ])
    )
  }
}

function preparedEnvironmentIds(): string[] {
  return prepareBrowserClientHostPlacement.mock.calls.map((call) => call[0].selector)
}

describe('ensureBrowserClientHostsForRestoredPages', () => {
  beforeEach(() => {
    resetRestoredBrowserClientHostAttachForTests()
    prepareBrowserClientHostPlacement.mockClear()
    prepareBrowserClientHostPlacement.mockResolvedValue({ kind: 'server' as const })
    vi.stubGlobal('window', {
      api: { runtimeEnvironments: { prepareBrowserClientHostPlacement } }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Why: the host is started lazily on the create path only, so after a relaunch this desktop hosts
  // nothing and the runtime never gets the attach that would recover the retained pages.
  it('starts the browser client host once for an environment with restored client-hosted rows', async () => {
    await ensureBrowserClientHostsForRestoredPages(
      handles({
        'page-1': { environmentId: 'env-1', clientHosted: true },
        'page-2': { environmentId: 'env-1', clientHosted: true }
      })
    )

    expect(preparedEnvironmentIds()).toEqual(['env-1'])
  })

  it('starts a host for every environment that has restored client-hosted rows', async () => {
    await ensureBrowserClientHostsForRestoredPages(
      handles({
        'page-1': { environmentId: 'env-1', clientHosted: true },
        'page-2': { environmentId: 'env-2', clientHosted: true }
      })
    )

    expect(preparedEnvironmentIds().sort()).toEqual(['env-1', 'env-2'])
  })

  // Why: a server-hosted page is the runtime's to run; starting a host for it would claim hosting
  // duty this desktop was never asked for.
  it('starts no host for restored rows the server hosts', async () => {
    await ensureBrowserClientHostsForRestoredPages(
      handles({ 'page-1': { environmentId: 'env-1' } })
    )

    expect(preparedEnvironmentIds()).toEqual([])
  })

  it('does not start the same environment twice across calls', async () => {
    const restored = handles({ 'page-1': { environmentId: 'env-1', clientHosted: true } })
    await ensureBrowserClientHostsForRestoredPages(restored)
    await ensureBrowserClientHostsForRestoredPages(restored)

    expect(preparedEnvironmentIds()).toEqual(['env-1'])
  })

  // Why: this runs inside the startup chain, and a rejected preparation there would abort hydration
  // and boot the app in degraded no-save mode.
  it('swallows a failed preparation without retrying it', async () => {
    prepareBrowserClientHostPlacement.mockRejectedValue(new Error('runtime_manually_disconnected'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const restored = handles({ 'page-1': { environmentId: 'env-1', clientHosted: true } })

    await expect(ensureBrowserClientHostsForRestoredPages(restored)).resolves.toBeUndefined()
    await ensureBrowserClientHostsForRestoredPages(restored)

    expect(preparedEnvironmentIds()).toEqual(['env-1'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
