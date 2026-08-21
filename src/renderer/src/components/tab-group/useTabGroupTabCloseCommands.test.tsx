// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../../../shared/tab-types'

const mocks = vi.hoisted(() => ({
  closeWebRuntimeSessionTab: vi.fn(async (_args: { environmentId: string | null }) => true),
  isWebRuntimeSessionActive: vi.fn(() => true),
  closeTerminalTab: vi.fn(),
  destroyWorkspaceWebviews: vi.fn(),
  requestEditorFileClose: vi.fn(),
  getRuntimeEnvironmentIdForWorktree: vi.fn(() => null as string | null)
}))

vi.mock('../../runtime/web-runtime-session', () => ({
  closeWebRuntimeSessionTab: mocks.closeWebRuntimeSessionTab,
  isWebRuntimeSessionActive: mocks.isWebRuntimeSessionActive
}))
vi.mock('../terminal/terminal-tab-actions', () => ({ closeTerminalTab: mocks.closeTerminalTab }))
vi.mock('../../store/slices/browser-webview-cleanup', () => ({
  destroyWorkspaceWebviews: mocks.destroyWorkspaceWebviews
}))
vi.mock('../editor/editor-autosave', () => ({
  requestEditorFileClose: mocks.requestEditorFileClose
}))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: mocks.getRuntimeEnvironmentIdForWorktree
}))

import { useAppStore } from '../../store'
import { useTabGroupTabCloseCommands } from './useTabGroupTabCloseCommands'

const BROWSER_TAB = {
  id: 'unified-browser',
  contentType: 'browser',
  entityId: 'workspace-a',
  groupId: 'group-1'
} as Tab

let closeUnifiedTab: ReturnType<typeof vi.fn>
let closeBrowserTab: ReturnType<typeof vi.fn>

beforeEach(() => {
  // clearAllMocks leaves implementations in place, so a per-test mockReturnValue would leak.
  mocks.isWebRuntimeSessionActive.mockReturnValue(true)
  mocks.getRuntimeEnvironmentIdForWorktree.mockReturnValue(null)
  closeUnifiedTab = vi.fn()
  closeBrowserTab = vi.fn()
  useAppStore.setState({
    closeUnifiedTab,
    closeBrowserTab,
    closeTab: vi.fn(),
    closeFile: vi.fn(),
    setActiveWorktree: vi.fn(),
    reconcileWorktreeTabModel: vi.fn(() => ({ renderableTabCount: 1 })),
    unifiedTabsByWorktree: { 'worktree-a': [BROWSER_TAB] },
    browserPagesByWorkspace: {
      'workspace-a': [
        { id: 'page-1', workspaceId: 'workspace-a' },
        { id: 'page-2', workspaceId: 'workspace-a' }
      ]
    },
    remoteBrowserPageHandlesByPageId: {
      'page-1': { environmentId: 'env-a', remotePageId: 'remote-1' },
      'page-2': { environmentId: 'env-b', remotePageId: 'remote-2' }
    }
  } as never)
})

afterEach(() => vi.clearAllMocks())

function commands(): ReturnType<typeof useTabGroupTabCloseCommands> {
  return renderHook(() =>
    useTabGroupTabCloseCommands({ worktreeId: 'worktree-a', groupTabs: [BROWSER_TAB] })
  ).result.current
}

function closedEnvironmentIds(): string[] {
  return mocks.closeWebRuntimeSessionTab.mock.calls
    .map((call) => call[0].environmentId ?? '(unset)')
    .sort()
}

// Why: a workspace whose pages span two environments resolved as "ambiguous", and both close
// paths fell through without doing anything — the X was inert with no error and no teardown.
describe('closing a browser workspace owned by more than one runtime environment', () => {
  it('closes it on every owning host from the single-tab close', () => {
    commands().closeItem('unified-browser')

    expect(closedEnvironmentIds()).toEqual(['env-a', 'env-b'])
    expect(mocks.destroyWorkspaceWebviews).not.toHaveBeenCalled()
  })

  it('closes it on every owning host from the bulk close', () => {
    commands().closeMany(['unified-browser'])

    expect(closedEnvironmentIds()).toEqual(['env-a', 'env-b'])
  })

  it('tears it down locally when neither host is connected', () => {
    mocks.isWebRuntimeSessionActive.mockReturnValue(false)

    commands().closeItem('unified-browser')

    expect(mocks.closeWebRuntimeSessionTab).not.toHaveBeenCalled()
    expect(mocks.destroyWorkspaceWebviews).toHaveBeenCalled()
    expect(closeBrowserTab).toHaveBeenCalledWith('workspace-a')
    expect(closeUnifiedTab).toHaveBeenCalledWith('unified-browser')
  })

  // Why: a mirror of a host tab has no page of its own, so nothing names an owner — without the
  // focused runtime standing in, the X removed nothing and the host re-mirrored the tab.
  it('removes a pageless host mirror through the focused runtime', () => {
    useAppStore.setState({
      browserPagesByWorkspace: {},
      remoteBrowserPageHandlesByPageId: {}
    } as never)
    mocks.getRuntimeEnvironmentIdForWorktree.mockReturnValue('env-focused')

    commands().closeItem('unified-browser')

    expect(closedEnvironmentIds()).toEqual(['env-focused'])
    expect(closeUnifiedTab).toHaveBeenCalledWith('unified-browser')
    expect(mocks.destroyWorkspaceWebviews).not.toHaveBeenCalled()
  })

  it('routes the bulk close through the same plan for a pageless host mirror', () => {
    useAppStore.setState({
      browserPagesByWorkspace: {},
      remoteBrowserPageHandlesByPageId: {}
    } as never)
    mocks.getRuntimeEnvironmentIdForWorktree.mockReturnValue('env-focused')

    commands().closeMany(['unified-browser'])

    expect(closedEnvironmentIds()).toEqual(['env-focused'])
    expect(closeUnifiedTab).toHaveBeenCalledWith('unified-browser')
  })

  it('still leaves a lone owner tab for host sync to remove', () => {
    useAppStore.setState({
      remoteBrowserPageHandlesByPageId: {
        'page-1': { environmentId: 'env-a', remotePageId: 'remote-1' },
        'page-2': { environmentId: 'env-a', remotePageId: 'remote-2' }
      }
    } as never)

    commands().closeItem('unified-browser')

    expect(closedEnvironmentIds()).toEqual(['env-a'])
    expect(closeUnifiedTab).not.toHaveBeenCalled()
    expect(mocks.destroyWorkspaceWebviews).not.toHaveBeenCalled()
  })
})
