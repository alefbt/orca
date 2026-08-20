import { describe, expect, it, vi } from 'vitest'
import type { RuntimeBrowserClientPlacement } from '../../shared/runtime-browser-placement'
import { RuntimeBrowserPageRegistry } from './runtime-browser-page-registry'
import { recoverUnavailableRuntimeBrowserClientPages } from './runtime-browser-client-page-recovery'

const oldPlacement = Object.freeze({
  kind: 'client' as const,
  browserHostClientId: 'host-a',
  browserHostGeneration: 4,
  pageHostGeneration: 7
})
const newPlacement = Object.freeze({ ...oldPlacement, pageHostGeneration: 8 })

describe('runtime browser client page recovery', () => {
  it('closes an unavailable generation before creating and navigating the next generation', async () => {
    const { authority, commands, notifyWorkspace, pages } = harness()

    await recoverUnavailableRuntimeBrowserClientPages({
      lease: lease([inventory('outcomeUnknown')]),
      authority,
      pages,
      notifyWorkspace
    })

    expect(commands).toEqual([
      { browserPageId: 'page-a', type: 'closePage', pageHostGeneration: 7 },
      { browserPageId: 'page-a', type: 'navigate', pageHostGeneration: 8 }
    ])
    expect(authority.createClientPage).toHaveBeenCalledWith(
      expect.objectContaining({
        browserPageId: 'page-a',
        browserHostClientId: 'host-a',
        pairedDeviceId: 'device-a',
        browserProfileId: 'profile-a',
        executionHostKey: 'native:runtime-a:1'
      })
    )
    expect(pages.getPage('page-a')).toMatchObject({
      placement: newPlacement,
      url: 'https://client-latest.internal/',
      loading: false
    })
    expect(notifyWorkspace).toHaveBeenCalledOnce()
  })

  it('retains an exact active generation without commands or metadata churn', async () => {
    const { authority, commands, notifyWorkspace, pages } = harness()

    await recoverUnavailableRuntimeBrowserClientPages({
      lease: lease([inventory('active')]),
      authority,
      pages,
      notifyWorkspace
    })

    expect(commands).toEqual([])
    expect(authority.createClientPage).not.toHaveBeenCalled()
    expect(pages.getPage('page-a')?.placement).toEqual(oldPlacement)
    expect(notifyWorkspace).not.toHaveBeenCalled()
  })

  it('treats negotiated missing inventory as absence and still allocates a fresh generation', async () => {
    const { authority, commands, pages } = harness()

    await recoverUnavailableRuntimeBrowserClientPages({
      lease: lease([]),
      authority,
      pages,
      notifyWorkspace: vi.fn()
    })

    expect(commands).toEqual([{ browserPageId: 'page-a', type: 'navigate', pageHostGeneration: 8 }])
    expect(pages.getPage('page-a')?.placement).toEqual(newPlacement)
  })

  it('degrades a failed navigation to that page instead of failing the attach', async () => {
    const { authority, notifyWorkspace, pages } = harness({
      pageIds: ['page-a', 'page-b'],
      navigateFailures: ['page-a']
    })
    const releaseUnrecoverablePage = vi.fn()

    await expect(
      recoverUnavailableRuntimeBrowserClientPages({
        lease: lease([]),
        authority,
        pages,
        notifyWorkspace,
        releaseUnrecoverablePage
      })
    ).resolves.toBeUndefined()

    expect(pages.getPage('page-b')).toMatchObject({
      placement: { pageHostGeneration: 10 },
      loading: false
    })
    // The page kept a live placement, so it stays listed and a later attach can retry it.
    expect(pages.getPage('page-a')?.placement).toMatchObject({ pageHostGeneration: 8 })
    expect(releaseUnrecoverablePage).not.toHaveBeenCalled()
  })

  it('releases a page whose recovery left it without any placement', async () => {
    const { authority, notifyWorkspace, pages } = harness({
      pageIds: ['page-a', 'page-b'],
      creationFailures: ['page-a']
    })
    const releaseUnrecoverablePage = vi.fn()

    await recoverUnavailableRuntimeBrowserClientPages({
      lease: lease([]),
      authority,
      pages,
      notifyWorkspace,
      releaseUnrecoverablePage
    })

    expect(releaseUnrecoverablePage).toHaveBeenCalledOnce()
    expect(releaseUnrecoverablePage).toHaveBeenCalledWith(
      expect.objectContaining({ browserPageId: 'page-a' })
    )
    expect(pages.getPage('page-b')).toMatchObject({ placement: { pageHostGeneration: 10 } })
  })

  it('stops recovering pages once the attach is aborted', async () => {
    const abort = new AbortController()
    const { authority, pages } = harness({
      pageIds: ['page-a', 'page-b', 'page-c', 'page-d', 'page-e'],
      onCommand: () => abort.abort()
    })

    await recoverUnavailableRuntimeBrowserClientPages({
      lease: lease([]),
      authority,
      pages,
      notifyWorkspace: vi.fn(),
      signal: abort.signal
    })

    expect(authority.createClientPage).toHaveBeenCalledTimes(4)
    expect(pages.getPage('page-e')?.placement).toMatchObject({ pageHostGeneration: 15 })
  })
})

function harness(
  options: {
    pageIds?: readonly string[]
    navigateFailures?: readonly string[]
    creationFailures?: readonly string[]
    onCommand?: () => void
  } = {}
) {
  const pageIds = options.pageIds ?? ['page-a']
  const pages = new RuntimeBrowserPageRegistry()
  const placements = new Map<string, RuntimeBrowserClientPlacement | undefined>()
  pageIds.forEach((browserPageId, index) => {
    const placement = Object.freeze({ ...oldPlacement, pageHostGeneration: 7 + index * 2 })
    placements.set(browserPageId, placement)
    pages.publishClientPage({
      browserPageId,
      workspaceId: 'workspace-a',
      browserProfileId: 'profile-a',
      executionHostKey: 'native:runtime-a:1',
      placement,
      url: 'https://server-known.internal/',
      loading: true,
      active: index === 0
    })
  })
  const commands: { browserPageId: string; type: string; pageHostGeneration: number }[] = []
  const authority = {
    authorityRuntimeId: 'runtime-a',
    authorityEpoch: 'epoch-a',
    getPlacement: vi.fn((browserPageId: string) => placements.get(browserPageId)),
    beginPageRetirement: vi.fn((browserPageId: string, expected: RuntimeBrowserClientPlacement) => {
      if (expected !== placements.get(browserPageId)) {
        throw new Error('browser_page_placement_stale')
      }
      return { browserPageId, placement: expected }
    }),
    completePageRetirement: vi.fn((retirement: { browserPageId: string }) => {
      placements.set(retirement.browserPageId, undefined)
      return true
    }),
    createClientPage: vi.fn(async (input: { browserPageId: string }) => {
      if (options.creationFailures?.includes(input.browserPageId)) {
        throw new Error('browser_host_page_creation_timeout')
      }
      const index = pageIds.indexOf(input.browserPageId)
      const placement = Object.freeze({ ...newPlacement, pageHostGeneration: 8 + index * 2 })
      placements.set(input.browserPageId, placement)
      return placement
    }),
    issueClientPageCommand: vi.fn(
      (input: { browserPageId: string; pageHostGeneration: number }, command: { type: string }) => {
        commands.push({
          browserPageId: input.browserPageId,
          type: command.type,
          pageHostGeneration: input.pageHostGeneration
        })
        options.onCommand?.()
        const failed =
          command.type === 'navigate' && options.navigateFailures?.includes(input.browserPageId)
        return {
          event: {},
          result: Promise.resolve(
            failed
              ? { status: 'failed' as const, errorCode: 'browser_client_page_navigation_failed' }
              : { status: 'completed' as const }
          )
        }
      }
    )
  }
  return { authority, commands, notifyWorkspace: vi.fn(), pages }
}

function lease(pageInventory: ReturnType<typeof inventory>[]) {
  return {
    authorityRuntimeId: 'runtime-a',
    authorityEpoch: 'epoch-a',
    browserHostClientId: 'host-a',
    browserHostGeneration: 4,
    pairedDeviceId: 'device-a',
    pageCommandProtocolVersion: 1 as const,
    pageInventoryProtocolVersion: 1 as const,
    pageReconciliationProtocolVersion: 1 as const,
    pageInventory
  }
}

function inventory(state: 'active' | 'outcomeUnknown') {
  return {
    authorityRuntimeId: 'runtime-a',
    authorityEpoch: 'epoch-a',
    browserHostClientId: 'host-a',
    browserHostGeneration: 4,
    browserPageId: 'page-a',
    pageHostGeneration: 7,
    browserProfileId: 'profile-a',
    executionHostKey: 'native:runtime-a:1',
    state,
    currentUrl: 'https://client-latest.internal/'
  } as const
}
