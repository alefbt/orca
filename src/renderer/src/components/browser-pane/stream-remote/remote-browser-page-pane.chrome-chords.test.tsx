// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { BrowserPage } from '../../../../../shared/browser-workspace-types'
import { REMOTE_BROWSER_STREAM_LIVE } from './remote-browser-stream-status'

// Everything the streamed pane wraps is inert here; this suite is about which chords the pane
// answers itself instead of forwarding to the remote page as raw keystrokes.
const mocks = vi.hoisted(() => ({
  runRemoteNavigation: vi.fn(async () => {}),
  handleRemoteScreenshotKeyDown: vi.fn(),
  remoteError: { current: null as string | null }
}))

vi.mock('@/runtime/runtime-rpc-client', () => ({
  runtimeEnvironmentSupportsCapability: vi.fn(async () => false),
  callRuntimeRpc: vi.fn(async () => ({}))
}))
vi.mock('@/lib/workspace-browser-tab-open', () => ({
  openWorkspaceBrowserTab: vi.fn(async () => {})
}))
vi.mock('../annotate/markup-clipboard-delivery', () => ({
  deliverMarkupToClipboard: vi.fn(async () => {})
}))
vi.mock('../annotate/useMarkupMode', () => ({
  useMarkupMode: () => ({
    isActive: false,
    baseImage: null,
    state: 'idle',
    start: vi.fn(),
    cancel: vi.fn(),
    complete: vi.fn()
  })
}))
vi.mock('./use-remote-browser-page-lifecycle', () => ({
  useRemoteBrowserPageLifecycle: () => ({
    lifecycle: { session: {}, tokens: {} },
    streamStatus: REMOTE_BROWSER_STREAM_LIVE,
    frameUrl: 'blob:frame',
    frameMetadata: null,
    runtimeWorktree: 'worktree-a',
    runtimeTarget: () => null,
    createRemoteOperationToken: () => null,
    isCurrentRemoteOperationToken: () => false,
    clearStreamFrame: vi.fn(),
    closeMissingRemotePage: vi.fn(),
    mountedRef: { current: true },
    isActiveRef: { current: true },
    streamBridgeRef: { current: null },
    streamFrameUrlRef: { current: null },
    pendingFrameDecodeRef: { current: 0 },
    remoteViewportSizeRef: { current: null },
    remoteCssViewportSizeRef: { current: null },
    remoteViewportTimerRef: { current: null },
    setFrameUrl: vi.fn(),
    setFrameMetadata: vi.fn()
  })
}))
vi.mock('./use-remote-browser-page-stream', () => ({
  useRemoteBrowserPageStream: () => ({ reconnectRemoteStream: vi.fn() })
}))
vi.mock('./use-remote-browser-page-input', () => ({
  useRemoteBrowserPageInputQueue: () => ({
    enqueueRemoteInput: vi.fn(),
    clearPendingRemoteWheel: vi.fn(),
    resetRemoteInputQueue: vi.fn(),
    pendingRemoteWheelRef: { current: null },
    remoteWheelFrameRef: { current: null },
    remoteWheelInFlightRef: { current: false }
  }),
  useRemoteBrowserPageInput: () => ({
    getRemoteImagePoint: () => null,
    handleRemotePointerDown: vi.fn(),
    handleRemotePointerUp: vi.fn(),
    handleRemoteScreenshotKeyDown: mocks.handleRemoteScreenshotKeyDown
  })
}))
vi.mock('./use-remote-browser-page-wheel', () => ({ useRemoteBrowserPageWheel: vi.fn() }))
vi.mock('./remote-browser-page-context-menu', () => ({
  RemoteBrowserPageContextMenu: () => null,
  useRemoteBrowserPageContextMenu: () => ({
    contextMenu: null,
    setContextMenu: vi.fn(),
    handleRemoteContextMenu: vi.fn()
  })
}))
vi.mock('./use-remote-browser-page-navigation', () => ({
  useRemoteBrowserPageNavigation: () => ({
    addressBarValue: 'https://example.internal/app',
    setAddressBarValue: vi.fn(),
    applyRemoteTabInfo: vi.fn(),
    scheduleRemoteTabInfoRefresh: vi.fn(),
    runRemoteNavigation: mocks.runRemoteNavigation,
    navigateToUrl: vi.fn(),
    submitAddressBar: vi.fn()
  })
}))

// The real viewport hands the screencast <img> the key handler that forwards keystrokes to the
// host; keeping that wiring is what makes "no longer forwarded" a real assertion.
vi.mock('./remote-browser-page-viewport', () => ({
  RemoteBrowserPageViewport: ({
    remoteViewportRef,
    imageRef,
    handleRemoteScreenshotKeyDown,
    remoteError
  }: {
    remoteViewportRef: React.RefObject<HTMLDivElement | null>
    imageRef: React.RefObject<HTMLImageElement | null>
    handleRemoteScreenshotKeyDown: (event: React.KeyboardEvent<HTMLImageElement>) => void
    remoteError: string | null
  }) => {
    mocks.remoteError.current = remoteError
    return (
      <div ref={remoteViewportRef} tabIndex={-1} data-testid="viewport">
        <img
          ref={imageRef}
          tabIndex={0}
          data-testid="frame"
          alt=""
          onKeyDown={handleRemoteScreenshotKeyDown}
        />
      </div>
    )
  }
}))

import { RemoteBrowserPagePane } from './remote-browser-page-pane'

beforeEach(() => {
  // Why: the chords are Cmd on macOS and Ctrl everywhere else, so the platform cannot be left to
  // whatever the test runner reports.
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
  })
  mocks.remoteError.current = null
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { ui: { onFocusBrowserAddressBar: () => () => {} } }
  })
  render(
    <TooltipProvider>
      <RemoteBrowserPagePane
        browserTab={page()}
        workspaceId="workspace-a"
        chromeShortcutScope="focused"
        runtimeEnvironmentId="environment-a"
        worktreeId="worktree-a"
        isActive
        onUpdatePageState={vi.fn()}
        onSetUrl={vi.fn()}
      />
    </TooltipProvider>
  )
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('streamed browser pane chrome chords', () => {
  it('reloads through the remote navigation action instead of forwarding the keystroke', () => {
    act(() => {
      fireEvent.keyDown(screen.getByTestId('frame'), { key: 'r', metaKey: true })
    })

    expect(mocks.runRemoteNavigation).toHaveBeenCalledWith('browser.reload')
    // Why: browser.keypress dispatches into the page, which cannot drive Chrome's reload — the
    // forwarded chord was a silent no-op.
    expect(mocks.handleRemoteScreenshotKeyDown).not.toHaveBeenCalled()
  })

  it('also reloads for the hard-reload chord, which the runtime has no separate action for', () => {
    act(() => {
      fireEvent.keyDown(screen.getByTestId('frame'), { key: 'r', metaKey: true, shiftKey: true })
    })

    expect(mocks.runRemoteNavigation).toHaveBeenCalledWith('browser.reload')
    expect(mocks.handleRemoteScreenshotKeyDown).not.toHaveBeenCalled()
  })

  it('reloads from the chrome too, not only from the focused frame', () => {
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'r', metaKey: true, bubbles: true, cancelable: true })
      )
    })

    expect(mocks.runRemoteNavigation).toHaveBeenCalledWith('browser.reload')
  })

  it('leaves reload alone while the user is typing in the address bar', () => {
    const addressBar = screen.getByRole('combobox')
    addressBar.focus()

    act(() => {
      fireEvent.keyDown(addressBar, { key: 'r', metaKey: true })
    })

    expect(mocks.runRemoteNavigation).not.toHaveBeenCalled()
  })

  it('says find is unavailable rather than forwarding a chord that does nothing', () => {
    act(() => {
      fireEvent.keyDown(screen.getByTestId('frame'), { key: 'f', metaKey: true })
    })

    expect(mocks.remoteError.current).toBe(
      'Find in page is not available while this page streams from the remote host.'
    )
    expect(mocks.handleRemoteScreenshotKeyDown).not.toHaveBeenCalled()
    expect(mocks.runRemoteNavigation).not.toHaveBeenCalled()
  })

  it('still forwards ordinary typing to the remote page', () => {
    act(() => {
      fireEvent.keyDown(screen.getByTestId('frame'), { key: 'r' })
    })

    expect(mocks.handleRemoteScreenshotKeyDown).toHaveBeenCalledTimes(1)
    expect(mocks.runRemoteNavigation).not.toHaveBeenCalled()
  })
})

function page(): BrowserPage {
  return {
    id: 'page-a',
    workspaceId: 'workspace-a',
    worktreeId: 'worktree-a',
    url: 'https://example.internal/app',
    title: 'App',
    loading: false,
    faviconUrl: null,
    canGoBack: false,
    canGoForward: false,
    loadError: null,
    createdAt: 1
  }
}
