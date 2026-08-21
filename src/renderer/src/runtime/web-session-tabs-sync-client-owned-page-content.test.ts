import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserPage, BrowserWorkspace } from '../../../shared/browser-workspace-types'
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'
import type { Tab } from '../../../shared/tab-types'
import type { RuntimeBrowserClientPlacement } from '../../../shared/runtime-browser-placement'
import { applyWebSessionTabsSnapshot, type WebSessionTabsSyncState } from './web-session-tabs-sync'
import {
  ENV,
  NOW,
  WT,
  makeSnapshot,
  makeState,
  resetWebSessionTabsSyncTestState
} from './web-session-tabs-sync-test-harness'

vi.mock('../store', () => ({
  useAppStore: {
    setState: vi.fn()
  }
}))

const REMOTE_PAGE = 'host-browser-page'
const HOST_TAB = 'host-browser-unified'
const LOCAL_WORKSPACE = 'local-browser-workspace'
const LOCAL_PAGE = 'local-browser-page'
const LOCAL_UNIFIED_TAB = 'local-browser-unified'
const GROUP = 'host-group-1'

const CLIENT_PLACEMENT: RuntimeBrowserClientPlacement = {
  kind: 'client',
  browserHostClientId: 'browser-host-a',
  browserHostGeneration: 1,
  pageHostGeneration: 1
}

/** Where the local guest actually is after the user navigated it. */
const GUEST_URL = 'https://www.google.com/maps/@37.7,-122.4,12z'
const GUEST_TITLE = 'Google Maps'
/** What the host still believes: the create-time url, and the registry's untouched title default. */
const HOST_STALE_URL = 'https://maps.google.com/'
const HOST_FALLBACK_TITLE = 'Browser'

/** The local row as the guest webview left it: navigated, settled, one entry of history behind it. */
function localPage(overrides: Partial<BrowserPage> = {}): BrowserPage {
  return {
    id: LOCAL_PAGE,
    workspaceId: LOCAL_WORKSPACE,
    worktreeId: WT,
    url: GUEST_URL,
    title: GUEST_TITLE,
    loading: false,
    faviconUrl: null,
    canGoBack: true,
    canGoForward: true,
    loadError: null,
    createdAt: NOW - 10,
    ...overrides
  }
}

function localWorkspace(page: BrowserPage): BrowserWorkspace {
  return {
    id: LOCAL_WORKSPACE,
    worktreeId: WT,
    activePageId: page.id,
    pageIds: [page.id],
    url: page.url,
    title: page.title,
    loading: page.loading,
    faviconUrl: page.faviconUrl,
    canGoBack: page.canGoBack,
    canGoForward: page.canGoForward,
    loadError: page.loadError,
    createdAt: page.createdAt
  }
}

function localUnifiedTab(page: BrowserPage): Tab {
  return {
    id: LOCAL_UNIFIED_TAB,
    entityId: LOCAL_WORKSPACE,
    groupId: GROUP,
    worktreeId: WT,
    contentType: 'browser',
    label: page.title,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: page.createdAt,
    isPreview: false,
    isPinned: false
  }
}

function stateWithLocalRow(page: BrowserPage = localPage()): WebSessionTabsSyncState {
  const workspace = localWorkspace(page)
  const unifiedTab = localUnifiedTab(page)
  return makeState({
    browserTabsByWorktree: { [WT]: [workspace] },
    browserPagesByWorkspace: { [workspace.id]: [page] },
    remoteBrowserPageHandlesByPageId: {
      [page.id]: { environmentId: ENV, remotePageId: REMOTE_PAGE, placement: CLIENT_PLACEMENT }
    },
    unifiedTabsByWorktree: { [WT]: [unifiedTab] },
    groupsByWorktree: {
      [WT]: [
        {
          id: GROUP,
          worktreeId: WT,
          activeTabId: unifiedTab.id,
          tabOrder: [unifiedTab.id],
          recentTabIds: [unifiedTab.id]
        }
      ]
    }
  })
}

/** The snapshot the host republishes on tab focus / workspace switch, frozen at create time. */
function staleHostSnapshot(
  overrides: Partial<RuntimeMobileSessionTabsResult['tabs'][number] & { placement: unknown }> = {}
): RuntimeMobileSessionTabsResult {
  return makeSnapshot(
    [
      {
        type: 'browser',
        id: HOST_TAB,
        title: HOST_FALLBACK_TITLE,
        browserWorkspaceId: REMOTE_PAGE,
        browserPageId: REMOTE_PAGE,
        url: HOST_STALE_URL,
        loading: true,
        canGoBack: false,
        canGoForward: false,
        placement: CLIENT_PLACEMENT,
        isActive: true,
        ...overrides
      } as RuntimeMobileSessionTabsResult['tabs'][number]
    ],
    { activeTabId: HOST_TAB, activeTabType: 'browser' }
  )
}

function applyStaleSnapshot(
  state: WebSessionTabsSyncState,
  snapshot = staleHostSnapshot()
): Partial<WebSessionTabsSyncState> {
  return applyWebSessionTabsSnapshot(state, snapshot, ENV, NOW) as Partial<WebSessionTabsSyncState>
}

function syncedPage(patch: Partial<WebSessionTabsSyncState>): BrowserPage | undefined {
  return patch.browserPagesByWorkspace?.[LOCAL_WORKSPACE]?.[0]
}

describe('client-placed browser rows own their page content', () => {
  beforeEach(resetWebSessionTabsSyncTestState)

  // The reported bug: host title is the registry's 'Browser' default and its url never moved off
  // create time, so the staged-title hold's url-equality arm fails the moment the guest navigates.
  it('keeps the local title when a stale host snapshot republishes the Browser fallback', () => {
    const patch = applyStaleSnapshot(stateWithLocalRow())

    expect(syncedPage(patch)?.title).toBe(GUEST_TITLE)
  })

  it('keeps the local title on the workspace and the unified tab label', () => {
    const patch = applyStaleSnapshot(stateWithLocalRow())

    expect(patch.browserTabsByWorktree?.[WT]?.[0]?.title).toBe(GUEST_TITLE)
    expect(
      patch.unifiedTabsByWorktree?.[WT]?.find((tab) => tab.contentType === 'browser')?.label
    ).toBe(GUEST_TITLE)
  })

  it('keeps the local url instead of rewinding to the host create-time url', () => {
    const patch = applyStaleSnapshot(stateWithLocalRow())

    expect(syncedPage(patch)?.url).toBe(GUEST_URL)
  })

  it('keeps the local loading flag instead of the host create-time value', () => {
    const patch = applyStaleSnapshot(stateWithLocalRow())

    expect(syncedPage(patch)?.loading).toBe(false)
  })

  it('keeps local canGoBack instead of the host default', () => {
    const patch = applyStaleSnapshot(stateWithLocalRow())

    expect(syncedPage(patch)?.canGoBack).toBe(true)
  })

  it('keeps local canGoForward instead of the host default', () => {
    const patch = applyStaleSnapshot(stateWithLocalRow())

    expect(syncedPage(patch)?.canGoForward).toBe(true)
  })

  // Why a real title is covered separately: a host that has learned the title publishes a
  // non-fallback string, which the staged-title hold would have accepted. Ownership, not staleness.
  it('keeps the local title even when the host publishes a real but older title', () => {
    const patch = applyStaleSnapshot(
      stateWithLocalRow(),
      staleHostSnapshot({ title: 'Google Maps — Directions', url: GUEST_URL })
    )

    expect(syncedPage(patch)?.title).toBe(GUEST_TITLE)
  })

  it('takes host content for a client-placed page this client holds no row for', () => {
    const patch = applyStaleSnapshot(makeState())
    const page = patch.browserPagesByWorkspace?.[REMOTE_PAGE]?.[0]

    expect(page).toMatchObject({
      title: HOST_FALLBACK_TITLE,
      url: HOST_STALE_URL,
      loading: true,
      canGoBack: false,
      canGoForward: false
    })
  })

  it('takes host content for a streamed page even when a local row exists', () => {
    const patch = applyStaleSnapshot(
      stateWithLocalRow(),
      staleHostSnapshot({ placement: undefined, title: 'Example Domain' })
    )

    expect(syncedPage(patch)).toMatchObject({
      title: 'Example Domain',
      url: HOST_STALE_URL,
      loading: true,
      canGoBack: false,
      canGoForward: false
    })
  })

  // The staged-title hold still owns the pre-adoption window and every non-client placement.
  it('still holds the local title for a streamed page parked at the same url', () => {
    const patch = applyStaleSnapshot(
      stateWithLocalRow(),
      staleHostSnapshot({ placement: undefined, title: HOST_FALLBACK_TITLE, url: GUEST_URL })
    )

    expect(syncedPage(patch)?.title).toBe(GUEST_TITLE)
  })
})
