import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserPage, BrowserWorkspace } from '../../../shared/browser-workspace-types'
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'
import type { Tab } from '../../../shared/tab-types'
import {
  recordWebSessionBrowserPlacement,
  resetWebSessionBrowserPlacementsForTests
} from './web-session-browser-placement'
import { applyWebSessionTabsSnapshot, type WebSessionTabsSyncState } from './web-session-tabs-sync'
import {
  ENV,
  NOW,
  WT,
  layoutHasGroup,
  makeSnapshot,
  makeState,
  resetWebSessionTabsSyncTestState
} from './web-session-tabs-sync-test-harness'

vi.mock('../store', () => ({
  useAppStore: {
    setState: vi.fn()
  }
}))

/** The group the create targeted — where staging first put the tab. */
const CREATE_GROUP = 'client-group-create'
/** The group the user split the staged tab into while the create was still in flight. */
const SPLIT_GROUP = 'client-group-split'

const REMOTE_PAGE_ID = 'staged-page'
const PAGE_ID = 'staged-page'
const WORKSPACE_ID = 'staged-workspace'
const UNIFIED_TAB_ID = 'staged-unified-tab'
const SIBLING_TAB_ID = 'sibling-unified-tab'

function stagedWorkspace(title: string, url: string): BrowserWorkspace {
  return {
    id: WORKSPACE_ID,
    worktreeId: WT,
    activePageId: PAGE_ID,
    pageIds: [PAGE_ID],
    url,
    title,
    loading: false,
    faviconUrl: null,
    canGoBack: false,
    canGoForward: false,
    loadError: null,
    createdAt: NOW
  }
}

function stagedPage(title: string, url: string): BrowserPage {
  return {
    id: PAGE_ID,
    workspaceId: WORKSPACE_ID,
    worktreeId: WT,
    url,
    title,
    loading: false,
    faviconUrl: null,
    canGoBack: false,
    canGoForward: false,
    loadError: null,
    createdAt: NOW,
    browserRuntimeEnvironmentId: ENV,
    viewportPresetId: null
  }
}

function stagedUnifiedTab(groupId: string, title: string): Tab {
  return {
    id: UNIFIED_TAB_ID,
    entityId: WORKSPACE_ID,
    groupId,
    worktreeId: WT,
    contentType: 'browser',
    label: title,
    customLabel: null,
    color: null,
    sortOrder: NOW,
    createdAt: NOW,
    isPreview: false,
    isPinned: false
  }
}

/** A terminal row that keeps the create group non-empty, exactly as the strip would. */
function siblingTerminalTab(): Tab {
  return {
    id: SIBLING_TAB_ID,
    entityId: SIBLING_TAB_ID,
    groupId: CREATE_GROUP,
    worktreeId: WT,
    contentType: 'terminal',
    label: 'Terminal',
    customLabel: null,
    color: null,
    sortOrder: NOW - 1,
    createdAt: NOW - 1,
    isPreview: false,
    isPinned: false
  }
}

/**
 * The client state one instant before adoption: the tab was staged into CREATE_GROUP, and the
 * user has since split it into SPLIT_GROUP. `groupId` says where the user left it.
 */
function makeStagedState(args: {
  groupId: string
  title: string
  url: string
}): WebSessionTabsSyncState {
  const split = args.groupId === SPLIT_GROUP
  return makeState({
    activeGroupIdByWorktree: { [WT]: args.groupId },
    activeTabType: 'browser',
    activeTabTypeByWorktree: { [WT]: 'browser' },
    groupsByWorktree: {
      [WT]: [
        {
          id: CREATE_GROUP,
          worktreeId: WT,
          activeTabId: split ? SIBLING_TAB_ID : UNIFIED_TAB_ID,
          tabOrder: split ? [SIBLING_TAB_ID] : [SIBLING_TAB_ID, UNIFIED_TAB_ID]
        },
        ...(split
          ? [
              {
                id: SPLIT_GROUP,
                worktreeId: WT,
                activeTabId: UNIFIED_TAB_ID,
                tabOrder: [UNIFIED_TAB_ID]
              }
            ]
          : [])
      ]
    },
    layoutByWorktree: {
      [WT]: split
        ? {
            type: 'split',
            direction: 'horizontal',
            first: { type: 'leaf', groupId: CREATE_GROUP },
            second: { type: 'leaf', groupId: SPLIT_GROUP }
          }
        : { type: 'leaf', groupId: CREATE_GROUP }
    },
    browserTabsByWorktree: { [WT]: [stagedWorkspace(args.title, args.url)] },
    browserPagesByWorkspace: { [WORKSPACE_ID]: [stagedPage(args.title, args.url)] },
    remoteBrowserPageHandlesByPageId: {
      [PAGE_ID]: { environmentId: ENV, remotePageId: REMOTE_PAGE_ID, staged: true }
    },
    unifiedTabsByWorktree: {
      [WT]: [siblingTerminalTab(), stagedUnifiedTab(args.groupId, args.title)]
    }
  })
}

/** The create-time record the mainstream new-tab path leaves behind (browser.ts passes clientTargetGroupId). */
function recordCreatePlacement(): void {
  recordWebSessionBrowserPlacement({
    environmentId: ENV,
    worktreeId: WT,
    remotePageId: REMOTE_PAGE_ID,
    groupId: CREATE_GROUP
  })
}

function hostTab(title: string, url: string): RuntimeMobileSessionTabsResult['tabs'][number] {
  return {
    type: 'browser',
    id: `host-tab-${REMOTE_PAGE_ID}`,
    title,
    browserWorkspaceId: `host-workspace-${REMOTE_PAGE_ID}`,
    browserPageId: REMOTE_PAGE_ID,
    url,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    isActive: false
  }
}

function applyPatch(
  state: WebSessionTabsSyncState,
  snapshot: RuntimeMobileSessionTabsResult
): WebSessionTabsSyncState {
  return {
    ...state,
    ...(applyWebSessionTabsSnapshot(state, snapshot, ENV, NOW) as Partial<WebSessionTabsSyncState>)
  }
}

function groupOf(state: WebSessionTabsSyncState, unifiedTabId: string): string | undefined {
  return (state.groupsByWorktree[WT] ?? []).find((group) => group.tabOrder.includes(unifiedTabId))
    ?.id
}

describe('staged browser rows stay authoritative through adoption', () => {
  beforeEach(() => {
    resetWebSessionTabsSyncTestState()
    resetWebSessionBrowserPlacementsForTests()
  })

  it('keeps a split the user made during the staging window', () => {
    recordCreatePlacement()
    const state = makeStagedState({
      groupId: SPLIT_GROUP,
      title: 'New Tab',
      url: 'about:blank'
    })

    const next = applyPatch(state, makeSnapshot([hostTab('', 'about:blank')]))

    // The create-time record still points at CREATE_GROUP; the user's later split must outrank it.
    expect(groupOf(next, UNIFIED_TAB_ID)).toBe(SPLIT_GROUP)
    expect(layoutHasGroup(next.layoutByWorktree[WT], SPLIT_GROUP)).toBe(true)
  })

  it('still honours the create record for a row the client never placed', () => {
    recordCreatePlacement()
    // No local row at all: the host mirrored the page under its own ids, so the record is the
    // only truth about where this client wanted it.
    const state = makeState({
      activeGroupIdByWorktree: { [WT]: CREATE_GROUP },
      groupsByWorktree: {
        [WT]: [
          {
            id: CREATE_GROUP,
            worktreeId: WT,
            activeTabId: SIBLING_TAB_ID,
            tabOrder: [SIBLING_TAB_ID]
          },
          { id: SPLIT_GROUP, worktreeId: WT, activeTabId: null, tabOrder: [] }
        ]
      },
      layoutByWorktree: {
        [WT]: {
          type: 'split',
          direction: 'horizontal',
          first: { type: 'leaf', groupId: CREATE_GROUP },
          second: { type: 'leaf', groupId: SPLIT_GROUP }
        }
      },
      unifiedTabsByWorktree: { [WT]: [siblingTerminalTab()] }
    })

    const next = applyPatch(state, makeSnapshot([hostTab('Example', 'https://example.com/')]))

    const adopted = (next.unifiedTabsByWorktree[WT] ?? []).find(
      (tab) => tab.contentType === 'browser'
    )
    expect(adopted).toBeDefined()
    expect(groupOf(next, adopted?.id ?? '')).toBe(CREATE_GROUP)
  })

  it('keeps the staged title until the page really navigates', () => {
    const state = makeStagedState({
      groupId: CREATE_GROUP,
      title: 'New Tab',
      url: 'about:blank'
    })

    // A fresh about:blank page publishes no title; the default must not overwrite the staged one.
    const next = applyPatch(state, makeSnapshot([hostTab('', 'about:blank')]))

    expect(next.browserPagesByWorkspace[WORKSPACE_ID]?.[0]?.title).toBe('New Tab')
    expect(next.browserTabsByWorktree[WT]?.[0]?.title).toBe('New Tab')
  })

  it('takes the title from a real navigation', () => {
    const state = makeStagedState({
      groupId: CREATE_GROUP,
      title: 'New Tab',
      url: 'about:blank'
    })

    const next = applyPatch(state, makeSnapshot([hostTab('Example Domain', 'https://example.com/')]))

    expect(next.browserPagesByWorkspace[WORKSPACE_ID]?.[0]?.title).toBe('Example Domain')
  })

  it('falls back to the default title for a page this client never staged', () => {
    const state = makeState({
      activeGroupIdByWorktree: { [WT]: CREATE_GROUP },
      groupsByWorktree: {
        [WT]: [
          {
            id: CREATE_GROUP,
            worktreeId: WT,
            activeTabId: SIBLING_TAB_ID,
            tabOrder: [SIBLING_TAB_ID]
          }
        ]
      },
      layoutByWorktree: { [WT]: { type: 'leaf', groupId: CREATE_GROUP } },
      unifiedTabsByWorktree: { [WT]: [siblingTerminalTab()] }
    })

    const next = applyPatch(state, makeSnapshot([hostTab('', 'about:blank')]))

    const workspace = next.browserTabsByWorktree[WT]?.[0]
    expect(workspace?.title).toBe('Browser')
  })
})
