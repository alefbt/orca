import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWebRuntimeSessionBrowserTab } from './web-runtime-session'
import { resetWebSessionCloseIntentForTests } from './web-session-close-intent'
import {
  ENVIRONMENT_ID,
  WORKTREE_ID,
  makeSnapshot,
  resetBrowserTabCreateEnvironment,
  stagedBrowserTabMocks,
  stagedBrowserWorkspaces,
  stubBrowserTabCreateEnvironment
} from './web-runtime-session-test-harness'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  setState: vi.fn(),
  subscribe: vi.fn(),
  setActiveWorktree: vi.fn(),
  createBrowserTab: vi.fn(),
  closeEmptyGroup: vi.fn(),
  moveUnifiedTabToGroup: vi.fn(),
  setRemoteBrowserPageHandle: vi.fn(),
  focusBrowserTabInWorktree: vi.fn(),
  applyFreshWebSessionTabsSnapshot: vi.fn(),
  acceptReplayedWebSessionTabsSnapshot: vi.fn(),
  resolveHostSessionTabIdForWebSessionTab: vi.fn(),
  trackTerminalPaneSplit: vi.fn(),
  deliverLaunchPromptToAgentTab: vi.fn(),
  seedNativeChatLaunchDraftForAgentTab: vi.fn(),
  getRuntimeEnvironmentIdForWorktree: vi.fn(),
  hasMaterializedWebRuntimeBrowserPage: vi.fn()
}))

vi.mock('../store', () => ({
  useAppStore: {
    getState: mocks.getState,
    setState: mocks.setState,
    subscribe: mocks.subscribe
  }
}))

vi.mock('./web-session-tabs-sync', () => ({
  acceptReplayedWebSessionTabsSnapshot: mocks.acceptReplayedWebSessionTabsSnapshot,
  applyFreshWebSessionTabsSnapshot: mocks.applyFreshWebSessionTabsSnapshot,
  applyWebSessionTabsStorePatch: (buildPatch: (state: unknown) => unknown) =>
    mocks.setState(buildPatch),
  resolveHostSessionTabIdForWebSessionTab: mocks.resolveHostSessionTabIdForWebSessionTab
}))

vi.mock('@/lib/feature-education-telemetry', () => ({
  trackTerminalPaneSplit: mocks.trackTerminalPaneSplit
}))

vi.mock('@/lib/worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: mocks.getRuntimeEnvironmentIdForWorktree
}))

vi.mock('@/lib/agent-launch-prompt-delivery', () => ({
  deliverLaunchPromptToAgentTab: mocks.deliverLaunchPromptToAgentTab,
  seedNativeChatLaunchDraftForAgentTab: mocks.seedNativeChatLaunchDraftForAgentTab
}))

vi.mock('./web-runtime-browser-materialization', () => ({
  hasMaterializedWebRuntimeBrowserPage: mocks.hasMaterializedWebRuntimeBrowserPage
}))

function advertiseKnownPageId(): void {
  mocks.getState.mockReturnValue({
    ...mocks.getState(),
    runtimeStatusByEnvironmentId: new Map([
      [
        ENVIRONMENT_ID,
        {
          status: { capabilities: ['browser.screencast.v1', 'browser.tab-create-known-id.v1'] },
          checkedAt: 1
        }
      ]
    ])
  })
}

afterEach(() => resetWebSessionCloseIntentForTests())

describe('createWebRuntimeSessionBrowserTab optimistic staging', () => {
  beforeEach(() => {
    stubBrowserTabCreateEnvironment(mocks)
  })

  afterEach(() => {
    resetBrowserTabCreateEnvironment()
  })

  it('shows the tab before the create RPC answers', async () => {
    // Never resolves: everything asserted below has to be true off the click alone.
    const runtimeCall = vi.fn(() => new Promise(() => {}))
    vi.stubGlobal('window', { api: { runtimeEnvironments: { call: runtimeCall } } })

    void createWebRuntimeSessionBrowserTab({
      worktreeId: WORKTREE_ID,
      environmentId: ENVIRONMENT_ID,
      url: 'https://example.com/'
    })
    await Promise.resolve()

    expect(stagedBrowserWorkspaces(mocks)).toEqual([
      { workspaceId: 'staged-workspace-1', pageId: expect.any(String), staged: true }
    ])
    expect(runtimeCall).toHaveBeenCalledOnce()
  })

  it('stages under the very page id it asks the host to mint', async () => {
    advertiseKnownPageId()
    const runtimeCall = vi.fn((_request: { params: { page?: string } }) => new Promise(() => {}))
    vi.stubGlobal('window', { api: { runtimeEnvironments: { call: runtimeCall } } })

    void createWebRuntimeSessionBrowserTab({
      worktreeId: WORKTREE_ID,
      environmentId: ENVIRONMENT_ID
    })
    await Promise.resolve()

    // Sharing the id is what lets the snapshot adopt these rows instead of adding a second tab.
    const requestedPageId = runtimeCall.mock.calls[0]?.[0].params.page
    expect(requestedPageId).toMatch(/^[0-9a-f-]{36}$/)
    expect(stagedBrowserWorkspaces(mocks)[0]?.pageId).toBe(requestedPageId)
    expect(mocks.setRemoteBrowserPageHandle).toHaveBeenCalledWith(requestedPageId, {
      environmentId: ENVIRONMENT_ID,
      remotePageId: requestedPageId,
      staged: true
    })
  })

  it('repoints the staged tab when the host mints its own page id', async () => {
    const runtimeCall = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'create',
        ok: true,
        result: { browserPageId: 'host-minted-page' }
      })
      .mockResolvedValueOnce({ id: 'list', ok: true, result: makeSnapshot() })
    vi.stubGlobal('window', { api: { runtimeEnvironments: { call: runtimeCall } } })

    await expect(
      createWebRuntimeSessionBrowserTab({
        worktreeId: WORKTREE_ID,
        environmentId: ENVIRONMENT_ID
      })
    ).resolves.toBe(true)

    const stagedPageId = stagedBrowserWorkspaces(mocks)[0]?.pageId
    expect(mocks.setRemoteBrowserPageHandle).toHaveBeenLastCalledWith(stagedPageId, {
      environmentId: ENVIRONMENT_ID,
      remotePageId: 'host-minted-page',
      staged: true
    })
    expect(stagedBrowserTabMocks.closeBrowserTab).not.toHaveBeenCalled()
  })

  it('drops the staged tab when a snapshot already mirrored the host page', async () => {
    const runtimeCall = vi
      .fn()
      .mockImplementationOnce(() => {
        // A subscription snapshot beat the create response and mirrored the host page under
        // its own ids; keeping the staged tab too would leave two tabs for one page.
        const state = mocks.getState()
        state.browserPagesByWorkspace['mirrored-workspace'] = [
          { id: 'mirrored-page', workspaceId: 'mirrored-workspace', url: 'https://example.com/' }
        ]
        state.browserTabsByWorktree[WORKTREE_ID] = [
          ...(state.browserTabsByWorktree[WORKTREE_ID] ?? []),
          {
            id: 'mirrored-workspace',
            worktreeId: WORKTREE_ID,
            activePageId: 'mirrored-page',
            pageIds: ['mirrored-page']
          }
        ]
        state.remoteBrowserPageHandlesByPageId['mirrored-page'] = {
          environmentId: ENVIRONMENT_ID,
          remotePageId: 'host-minted-page'
        }
        return Promise.resolve({
          id: 'create',
          ok: true,
          result: { browserPageId: 'host-minted-page' }
        })
      })
      .mockResolvedValueOnce({ id: 'list', ok: true, result: makeSnapshot() })
    vi.stubGlobal('window', { api: { runtimeEnvironments: { call: runtimeCall } } })

    await expect(
      createWebRuntimeSessionBrowserTab({
        worktreeId: WORKTREE_ID,
        environmentId: ENVIRONMENT_ID
      })
    ).resolves.toBe(true)

    expect(stagedBrowserWorkspaces(mocks)).toEqual([
      { workspaceId: 'mirrored-workspace', pageId: 'mirrored-page', staged: false }
    ])
  })

  it('unwinds a staged tab without offering it to the reopen stack', async () => {
    vi.stubGlobal('window', {
      api: {
        runtimeEnvironments: { call: vi.fn().mockRejectedValue(new Error('offline')) }
      }
    })

    await expect(
      createWebRuntimeSessionBrowserTab({
        worktreeId: WORKTREE_ID,
        environmentId: ENVIRONMENT_ID
      })
    ).rejects.toThrow('did not confirm whether the browser tab was created')

    expect(stagedBrowserTabMocks.closeBrowserTab).toHaveBeenCalledWith('staged-workspace-1', {
      reason: 'cleanup'
    })
    // Why: the create path owns retiring the host page, so the local unwind must not fire a
    // second browser.tabClose through the handle.
    expect(
      stagedBrowserTabMocks.removeRemoteBrowserPageHandle.mock.invocationCallOrder[0]
    ).toBeLessThan(stagedBrowserTabMocks.closeBrowserTab.mock.invocationCallOrder[0]!)
    expect(stagedBrowserWorkspaces(mocks)).toEqual([])
  })

  it('keeps three rapid creates as three distinct staged tabs', async () => {
    advertiseKnownPageId()
    const runtimeCall = vi.fn((request: { method: string; params: { page?: string } }) =>
      request.method === 'browser.tabCreate'
        ? Promise.resolve({
            id: 'create',
            ok: true,
            result: { browserPageId: request.params.page }
          })
        : Promise.resolve({ id: 'list', ok: true, result: makeSnapshot() })
    )
    vi.stubGlobal('window', { api: { runtimeEnvironments: { call: runtimeCall } } })

    const creates = [1, 2, 3].map(() =>
      createWebRuntimeSessionBrowserTab({
        worktreeId: WORKTREE_ID,
        environmentId: ENVIRONMENT_ID
      })
    )
    await expect(Promise.all(creates)).resolves.toEqual([true, true, true])

    const workspaces = stagedBrowserWorkspaces(mocks)
    expect(workspaces.map((entry) => entry.workspaceId)).toEqual([
      'staged-workspace-1',
      'staged-workspace-2',
      'staged-workspace-3'
    ])
    expect(new Set(workspaces.map((entry) => entry.pageId)).size).toBe(3)
    expect(stagedBrowserTabMocks.closeBrowserTab).not.toHaveBeenCalled()
  })
})
