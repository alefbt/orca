// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserPage } from '../../../../shared/browser-workspace-types'
import type { RuntimeStatus } from '../../../../shared/runtime-types'

const mocks = vi.hoisted(() => ({ attach: vi.fn(), createBrowserTab: vi.fn(async () => true) }))

vi.mock('./browser-client-page-renderer-installation', () => ({
  attachBrowserClientPageToViewport: mocks.attach
}))
vi.mock('@/runtime/web-runtime-session', () => ({
  createWebRuntimeSessionBrowserTab: mocks.createBrowserTab
}))
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), loading: vi.fn(), message: vi.fn() }
}))

import { useAppStore } from '@/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { installClientHostedPaneApi } from './client-hosted-browser-pane-test-rig'
import { ClientHostedBrowserPagePane } from './ClientHostedBrowserPagePane'
import { RESTORED_CLIENT_HOSTED_RECOVERY_WINDOW_MS } from './restored-client-hosted-recovery-window'

const PAGE_ID = 'page-a'
const ENVIRONMENT_ID = 'environment-a'

function page(): BrowserPage {
  return {
    id: PAGE_ID,
    workspaceId: 'workspace-a',
    worktreeId: 'worktree-a',
    url: 'https://remote.internal/saved',
    title: 'Saved',
    loading: false,
    faviconUrl: null,
    canGoBack: false,
    canGoForward: false,
    loadError: null,
    createdAt: 1
  }
}

function seedStore(options: { restored: boolean; reachable: boolean }): void {
  useAppStore.setState({
    remoteBrowserPageHandlesByPageId: options.restored
      ? {
          [PAGE_ID]: {
            environmentId: ENVIRONMENT_ID,
            remotePageId: 'remote-page-a',
            restoredFromSession: true,
            restoredClientHosted: true
          }
        }
      : {
          [PAGE_ID]: {
            environmentId: ENVIRONMENT_ID,
            remotePageId: 'remote-page-a',
            staged: true,
            stagedClientHosted: true
          }
        },
    runtimeStatusByEnvironmentId: new Map(
      options.reachable
        ? [[ENVIRONMENT_ID, { status: { runtimeId: 'runtime-a' } as RuntimeStatus, checkedAt: 1 }]]
        : [[ENVIRONMENT_ID, { status: null, checkedAt: 1 }]]
    )
  })
}

function paneElement(): React.JSX.Element {
  return (
    <TooltipProvider>
      <ClientHostedBrowserPagePane
        browserTab={page()}
        workspaceId="workspace-a"
        chromeShortcutScope="focused"
        runtimeEnvironmentId={ENVIRONMENT_ID}
        worktreeId="worktree-a"
        placement={null}
        isActive
        onUpdatePageState={vi.fn()}
        onSetUrl={vi.fn()}
      />
    </TooltipProvider>
  )
}

function renderPane(): ReturnType<typeof render> {
  return render(paneElement())
}

// Scoped to the navigation row: the unavailable notice's reopen button keeps its own pending
// spinner in the DOM at all times, hidden by class, so an unscoped query is always true.
function spinnerShown(): boolean {
  return (
    document.querySelector(
      '[data-contextual-tour-target="client-hosted-browser-controls"] .animate-spin'
    ) !== null
  )
}

function noticeShown(): boolean {
  return screen.queryByText('Client-hosted browser unavailable') !== null
}

describe('restored client-hosted recovery window', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.attach.mockReset()
    installClientHostedPaneApi()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    useAppStore.setState({
      remoteBrowserPageHandlesByPageId: {},
      runtimeStatusByEnvironmentId: new Map()
    })
  })

  it('keeps waiting while the window is still open', () => {
    seedStore({ restored: true, reachable: true })
    renderPane()

    act(() => vi.advanceTimersByTime(RESTORED_CLIENT_HOSTED_RECOVERY_WINDOW_MS - 1))

    expect(spinnerShown()).toBe(true)
    expect(noticeShown()).toBe(false)
  })

  it('stops waiting and offers the reopen escape once the window elapses', () => {
    seedStore({ restored: true, reachable: true })
    renderPane()

    act(() => vi.advanceTimersByTime(RESTORED_CLIENT_HOSTED_RECOVERY_WINDOW_MS))

    expect(noticeShown()).toBe(true)
    expect(spinnerShown()).toBe(false)
    expect(screen.getByRole('button', { name: 'Reopen on server' })).not.toBeNull()
  })

  // Why the row itself is checked: deleting it is the failure mode this replaced. The user decides.
  it('leaves the page row in place when it gives up', () => {
    seedStore({ restored: true, reachable: true })
    renderPane()

    act(() => vi.advanceTimersByTime(RESTORED_CLIENT_HOSTED_RECOVERY_WINDOW_MS))

    expect(useAppStore.getState().remoteBrowserPageHandlesByPageId[PAGE_ID]).not.toBeUndefined()
  })

  // Why: nobody has asked the host yet, and the environment's own disconnected state says so.
  it('keeps waiting indefinitely while the environment is unreachable', () => {
    seedStore({ restored: true, reachable: false })
    renderPane()

    act(() => vi.advanceTimersByTime(RESTORED_CLIENT_HOSTED_RECOVERY_WINDOW_MS * 10))

    expect(spinnerShown()).toBe(true)
    expect(noticeShown()).toBe(false)
  })

  // Why the staged case is pinned separately: it also mounts with a null placement, but its host is
  // mid-create rather than absent, and the create path has its own bound.
  it('leaves a staged page that is not restored alone', () => {
    seedStore({ restored: false, reachable: true })
    renderPane()

    act(() => vi.advanceTimersByTime(RESTORED_CLIENT_HOSTED_RECOVERY_WINDOW_MS * 10))

    expect(spinnerShown()).toBe(true)
    expect(noticeShown()).toBe(false)
  })

  // Why revocable: the window is a bound on waiting, not a verdict on the page. A slow recovery
  // that lands after it must put the user back on their page rather than on a dead notice.
  it('takes the notice back when the placement finally arrives', () => {
    seedStore({ restored: true, reachable: true })
    renderPane()
    act(() => vi.advanceTimersByTime(RESTORED_CLIENT_HOSTED_RECOVERY_WINDOW_MS))
    expect(noticeShown()).toBe(true)

    act(() => {
      useAppStore.setState({
        remoteBrowserPageHandlesByPageId: {
          [PAGE_ID]: { environmentId: ENVIRONMENT_ID, remotePageId: 'remote-page-a' }
        }
      })
    })

    expect(noticeShown()).toBe(false)
  })

  // Why re-entry gets its own case: a host fence clears the placement and re-runs recovery, so the
  // pane returns to waiting. A window that stayed spent would answer the second wait instantly.
  it('waits again when a recovered page loses its placement', () => {
    seedStore({ restored: true, reachable: true })
    const view = renderPane()
    act(() => vi.advanceTimersByTime(RESTORED_CLIENT_HOSTED_RECOVERY_WINDOW_MS))
    act(() => {
      useAppStore.setState({
        remoteBrowserPageHandlesByPageId: {
          [PAGE_ID]: { environmentId: ENVIRONMENT_ID, remotePageId: 'remote-page-a' }
        }
      })
    })
    expect(noticeShown()).toBe(false)

    act(() => {
      useAppStore.setState({
        remoteBrowserPageHandlesByPageId: {
          [PAGE_ID]: {
            environmentId: ENVIRONMENT_ID,
            remotePageId: 'remote-page-a',
            restoredFromSession: true,
            restoredClientHosted: true
          }
        }
      })
      view.rerender(paneElement())
    })

    expect(noticeShown()).toBe(false)
    act(() => vi.advanceTimersByTime(RESTORED_CLIENT_HOSTED_RECOVERY_WINDOW_MS - 1))
    expect(noticeShown()).toBe(false)
    act(() => vi.advanceTimersByTime(1))
    expect(noticeShown()).toBe(true)
  })

  // Why the number is asserted and not only derived from: every boundary case above stays green if
  // the window shrinks to a millisecond, and a window shorter than one recovery attempt would call
  // healthy pages dead.
  it('waits longer than the runtime spends creating one client page', () => {
    const RUNTIME_CLIENT_PAGE_CREATION_CEILING_MS = 30_000

    expect(RESTORED_CLIENT_HOSTED_RECOVERY_WINDOW_MS).toBe(45_000)
    expect(RESTORED_CLIENT_HOSTED_RECOVERY_WINDOW_MS).toBeGreaterThan(
      RUNTIME_CLIENT_PAGE_CREATION_CEILING_MS
    )
  })
})
