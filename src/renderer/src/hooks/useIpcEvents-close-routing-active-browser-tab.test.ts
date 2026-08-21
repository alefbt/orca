import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useIpcEventsForCloseRouting,
  type CloseActiveTabListener
} from './ipc-events-close-routing-test-harness'

const { closeWebRuntimeSessionTab, destroyWorkspaceWebviews, isWebRuntimeSessionActive } =
  vi.hoisted(() => ({
    closeWebRuntimeSessionTab: vi.fn(),
    destroyWorkspaceWebviews: vi.fn(),
    isWebRuntimeSessionActive: vi.fn(() => true)
  }))

vi.mock('@/runtime/web-runtime-session', () => ({
  closeWebRuntimeSessionTab,
  createWebRuntimeSessionTerminal: vi.fn(),
  isWebRuntimeSessionActive
}))
vi.mock('@/store/slices/browser-webview-cleanup', () => ({ destroyWorkspaceWebviews }))

type ActiveBrowserTabState = {
  closeBrowserTab: ReturnType<typeof vi.fn>
  closeUnifiedTab: ReturnType<typeof vi.fn>
  fire: () => void
}

/** Mount useIpcEvents over one active browser workspace and hand back the menu's Close Tab. */
async function mountWithActiveBrowserWorkspace(handle: {
  environmentId?: string
  staged?: true
}): Promise<ActiveBrowserTabState> {
  const closeBrowserTab = vi.fn()
  const closeUnifiedTab = vi.fn()
  const listenerRef: { current: CloseActiveTabListener | null } = { current: null }
  await useIpcEventsForCloseRouting({
    closeActiveTabListenerRef: listenerRef,
    getState: () => ({
      activeTabType: 'browser',
      activeBrowserTabId: 'workspace-1',
      activeWorktreeId: 'wt-1',
      browserTabsByWorktree: { 'wt-1': [{ id: 'workspace-1' }] },
      browserPagesByWorkspace: {
        'workspace-1': [{ id: 'page-1', workspaceId: 'workspace-1' }]
      },
      remoteBrowserPageHandlesByPageId: handle.environmentId
        ? {
            'page-1': {
              environmentId: handle.environmentId,
              remotePageId: 'remote-1',
              ...(handle.staged ? { staged: true } : {})
            }
          }
        : {},
      unifiedTabsByWorktree: {
        'wt-1': [{ id: 'unified-1', contentType: 'browser', entityId: 'workspace-1' }]
      },
      closeBrowserTab,
      closeUnifiedTab
    })
  })
  const fire = listenerRef.current
  if (!fire) {
    throw new Error('onCloseActiveTab was never registered')
  }
  return { closeBrowserTab, closeUnifiedTab, fire }
}

// Why: the menu's Close Tab used to answer ownership with "is this worktree's runtime connected",
// which is a different question from "does the host hold this workspace's pages" — and it fired an
// inert session.tabs.close at everything else.
describe('useIpcEvents Close Tab on the active browser tab', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    isWebRuntimeSessionActive.mockReturnValue(true)
  })

  it('closes a host-owned workspace on its runtime and leaves the mirror to tab sync', async () => {
    const { closeBrowserTab, closeUnifiedTab, fire } = await mountWithActiveBrowserWorkspace({
      environmentId: 'env-a'
    })

    fire()

    expect(closeWebRuntimeSessionTab).toHaveBeenCalledWith({
      worktreeId: 'wt-1',
      tabId: 'workspace-1',
      environmentId: 'env-a',
      reason: 'user'
    })
    expect(closeBrowserTab).not.toHaveBeenCalled()
    expect(closeUnifiedTab).not.toHaveBeenCalled()
  })

  // Why: a connected runtime does not make a client-local workspace the host's to close.
  it('tears a local-only workspace down here even while the runtime is connected', async () => {
    const { closeBrowserTab, fire } = await mountWithActiveBrowserWorkspace({})

    fire()

    expect(closeWebRuntimeSessionTab).not.toHaveBeenCalled()
    expect(destroyWorkspaceWebviews).toHaveBeenCalled()
    expect(closeBrowserTab).toHaveBeenCalledWith('workspace-1', undefined)
  })

  // Why: a staged page names a runtime that has not minted it yet, so the host close is inert and
  // the in-flight create's snapshot puts the tab back.
  it('unwinds a staged workspace as a cleanup close instead of closing it on the host', async () => {
    const { closeBrowserTab, fire } = await mountWithActiveBrowserWorkspace({
      environmentId: 'env-a',
      staged: true
    })

    fire()

    expect(closeWebRuntimeSessionTab).not.toHaveBeenCalled()
    expect(closeBrowserTab).toHaveBeenCalledWith('workspace-1', { reason: 'cleanup' })
  })
})
