// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BrowserCertificateFailure,
  BrowserPage
} from '../../../../shared/browser-workspace-types'
import type {
  BrowserContextMenuRequestedEvent,
  BrowserPermissionDeniedEvent
} from '../../../../shared/browser-guest-events'

const toastMocks = vi.hoisted(() => ({
  loading: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  message: vi.fn()
}))
vi.mock('sonner', () => ({ toast: toastMocks }))

const mocks = vi.hoisted(() => ({ attach: vi.fn() }))
vi.mock('./browser-client-page-renderer-installation', () => ({
  attachBrowserClientPageToViewport: mocks.attach
}))

import { useAppStore } from '@/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { installClientHostedPaneApi, paneChannel } from './client-hosted-browser-pane-test-rig'
import { ClientHostedBrowserPagePane } from './ClientHostedBrowserPagePane'

const PLACEMENT = {
  kind: 'client' as const,
  browserHostClientId: 'host-a',
  browserHostGeneration: 3,
  pageHostGeneration: 7
}

// Why: the chords are Cmd on macOS and Ctrl everywhere else, so the platform cannot be left to
// whatever the test runner reports.
const MAC_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'

let contextMenu = paneChannel<BrowserContextMenuRequestedEvent>()
let contextMenuDismissed = paneChannel<{ browserPageId: string }>()
let permissionDenied = paneChannel<BrowserPermissionDeniedEvent>()
let findRequests = paneChannel<void>()
let historyNavigate = paneChannel<'back' | 'forward'>()
let reloadRequests = paneChannel<void>()
let hardReloadRequests = paneChannel<void>()
let zoomRequests = paneChannel<'in' | 'out' | 'reset'>()
let openDevTools = vi.fn(async () => true)
let proceedCertificate = vi.fn(async () => ({ ok: true as const }))
let openUrl = vi.fn(async () => {})
let writeClipboardText = vi.fn(async () => {})

beforeEach(() => {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: MAC_USER_AGENT })
  contextMenu = paneChannel()
  contextMenuDismissed = paneChannel()
  permissionDenied = paneChannel()
  findRequests = paneChannel()
  historyNavigate = paneChannel()
  reloadRequests = paneChannel()
  hardReloadRequests = paneChannel()
  zoomRequests = paneChannel()
  openDevTools = vi.fn(async () => true)
  proceedCertificate = vi.fn(async () => ({ ok: true as const }))
  openUrl = vi.fn(async () => {})
  writeClipboardText = vi.fn(async () => {})
  installClientHostedPaneApi({
    browser: {
      onContextMenuRequested: contextMenu.subscribe,
      onContextMenuDismissed: contextMenuDismissed.subscribe,
      onPermissionDenied: permissionDenied.subscribe,
      openDevTools,
      proceedCertificate
    },
    ui: {
      onFindInBrowserPage: (_source: unknown, callback: () => void) =>
        findRequests.subscribe(callback),
      onBrowserHistoryNavigate: historyNavigate.subscribe,
      onReloadBrowserPage: (callback: () => void) => reloadRequests.subscribe(callback),
      onHardReloadBrowserPage: (callback: () => void) => hardReloadRequests.subscribe(callback),
      onZoomBrowserPage: zoomRequests.subscribe,
      writeClipboardText
    },
    shell: { openUrl }
  })
  useAppStore.setState({ browserCertificateFailuresByPageId: {} })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ClientHostedBrowserPagePane chrome parity', () => {
  it('opens the shared context menu for its own page and acts on the retained guest', () => {
    const { webview } = renderPane()

    act(() => contextMenu.emit(contextMenuEvent({ browserPageId: 'page-b' })))
    expect(screen.queryByTestId('browser-context-menu')).toBeNull()

    act(() => contextMenu.emit(contextMenuEvent()))
    expect(screen.getByTestId('browser-context-menu')).not.toBeNull()

    act(() => screen.getByRole('menuitem', { name: 'Back' }).click())
    expect(webview.goBack).toHaveBeenCalledTimes(1)

    act(() => contextMenu.emit(contextMenuEvent()))
    act(() => screen.getByRole('menuitem', { name: 'Inspect Page' }).click())
    expect(openDevTools).toHaveBeenCalledWith({ browserPageId: 'page-a' })

    act(() => contextMenu.emit(contextMenuEvent()))
    act(() => screen.getByRole('menuitem', { name: 'Copy Page URL' }).click())
    expect(writeClipboardText).toHaveBeenCalledWith('https://example.internal/app')
  })

  it('opens Find from the chord in chrome and from the chord forwarded out of the guest', () => {
    renderPane()
    expect(screen.queryByPlaceholderText('Find in page...')).toBeNull()

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true })
      )
    })
    expect(screen.getByPlaceholderText('Find in page...')).not.toBeNull()

    act(() => screen.getByTitle('Close').click())
    expect(screen.queryByPlaceholderText('Find in page...')).toBeNull()

    act(() => findRequests.emit(undefined))
    expect(screen.getByPlaceholderText('Find in page...')).not.toBeNull()
  })

  it('reloads and hard-reloads the retained guest from the forwarded chords', () => {
    const { webview } = renderPane()

    act(() => reloadRequests.emit(undefined))
    expect(webview.reload).toHaveBeenCalledTimes(1)
    expect(webview.reloadIgnoringCache).not.toHaveBeenCalled()

    act(() => hardReloadRequests.emit(undefined))
    expect(webview.reloadIgnoringCache).toHaveBeenCalledTimes(1)
  })

  it('walks history from the forwarded chords', () => {
    const { webview } = renderPane()

    act(() => historyNavigate.emit('back'))
    act(() => historyNavigate.emit('forward'))

    expect(webview.goBack).toHaveBeenCalledTimes(1)
    expect(webview.goForward).toHaveBeenCalledTimes(1)
  })

  it('zooms the retained guest and shows the level while the chord lands', () => {
    const { webview } = renderPane()
    // The HUD is aria-hidden until a zoom lands, so it has to be queried past that gate.
    const indicator = screen.getByRole('status', { hidden: true })
    expect(indicator.getAttribute('aria-hidden')).toBe('true')

    act(() => zoomRequests.emit('in'))

    expect(webview.setZoomLevel).toHaveBeenCalledTimes(1)
    expect(webview.setZoomLevel.mock.calls[0]![0]).toBeGreaterThan(0)
    expect(indicator.getAttribute('aria-hidden')).toBe('false')
    expect(indicator.textContent).not.toBe('100%')
  })

  it('offers Proceed Anyway on a certificate failure and sends it to the local session', () => {
    const loadError = {
      code: -202,
      description: 'ERR_CERT_AUTHORITY_INVALID',
      validatedUrl: 'https://selfsigned.internal/'
    }
    useAppStore.setState({
      browserCertificateFailuresByPageId: { 'page-a': certificateFailure() }
    })
    renderPane({ loadError })

    act(() => screen.getByText('Proceed Anyway (Unsafe)').click())

    expect(proceedCertificate).toHaveBeenCalledWith({
      browserPageId: 'page-a',
      challengeId: 'challenge-1'
    })
  })

  it('drops the retained guest from layout while the failure overlay stands', () => {
    const { webview } = renderPane()
    expect(webview.style.display).toBe('flex')

    cleanup()
    const failed = renderPane({
      loadError: { code: -105, description: 'ERR_NAME_NOT_RESOLVED', validatedUrl: 'https://x/' }
    })
    expect(failed.webview.style.display).toBe('none')
  })

  it('says so when the page asks for a permission Orca denied', () => {
    renderPane()

    act(() =>
      permissionDenied.emit({
        browserPageId: 'page-a',
        permission: 'media',
        origin: 'https://example.internal'
      })
    )

    expect(toastMocks.message).toHaveBeenCalledWith(
      'https://example.internal asked for camera or microphone access, and Orca denied it.',
      { id: 'browser-permission-denied:page-a:media' }
    )
  })

  it('ignores a permission denial belonging to another page', () => {
    renderPane()

    act(() =>
      permissionDenied.emit({
        browserPageId: 'page-b',
        permission: 'media',
        origin: 'https://example.internal'
      })
    )

    expect(toastMocks.message).not.toHaveBeenCalled()
  })
})

function certificateFailure(): BrowserCertificateFailure {
  return {
    browserPageId: 'page-a',
    challengeId: 'challenge-1',
    origin: 'https://selfsigned.internal',
    error: 'ERR_CERT_AUTHORITY_INVALID',
    errorCode: -202,
    canProceed: true
  } as BrowserCertificateFailure
}

function contextMenuEvent(
  overrides: Partial<BrowserContextMenuRequestedEvent> = {}
): BrowserContextMenuRequestedEvent {
  return {
    browserPageId: 'page-a',
    x: 10,
    y: 10,
    screenX: 10,
    screenY: 10,
    pageUrl: 'https://example.internal/app',
    linkUrl: null,
    selectionText: '',
    canGoBack: true,
    canGoForward: false,
    ...overrides
  } as BrowserContextMenuRequestedEvent
}

function renderPane(overrides: Partial<BrowserPage> = {}): {
  webview: Electron.WebviewTag & { setZoomLevel: ReturnType<typeof vi.fn> }
} {
  const webview = createWebview()
  mocks.attach.mockReturnValue({
    webview,
    detach: vi.fn(),
    nextMetadataRevision: vi.fn(() => 1)
  })
  render(
    <TooltipProvider>
      <ClientHostedBrowserPagePane
        browserTab={page(overrides)}
        workspaceId="workspace-a"
        chromeShortcutScope="focused"
        runtimeEnvironmentId="environment-a"
        worktreeId="worktree-a"
        placement={PLACEMENT}
        isActive
        onUpdatePageState={vi.fn()}
        onSetUrl={vi.fn()}
      />
    </TooltipProvider>
  )
  return { webview }
}

function page(overrides: Partial<BrowserPage> = {}): BrowserPage {
  return {
    id: 'page-a',
    workspaceId: 'workspace-a',
    worktreeId: 'worktree-a',
    url: 'https://example.internal/app',
    title: 'App',
    loading: false,
    faviconUrl: null,
    canGoBack: true,
    canGoForward: false,
    loadError: null,
    createdAt: 1,
    ...overrides
  }
}

function createWebview(): Electron.WebviewTag & { setZoomLevel: ReturnType<typeof vi.fn> } {
  const webview = document.createElement('webview') as Electron.WebviewTag & {
    setZoomLevel: ReturnType<typeof vi.fn>
  }
  Object.assign(webview, {
    getURL: vi.fn(() => 'https://example.internal/app'),
    getTitle: vi.fn(() => 'App'),
    isLoading: vi.fn(() => false),
    canGoBack: vi.fn(() => true),
    canGoForward: vi.fn(() => false),
    getWebContentsId: vi.fn(() => 42),
    getZoomLevel: vi.fn(() => 0),
    setZoomLevel: vi.fn(),
    focus: vi.fn(),
    blur: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    reloadIgnoringCache: vi.fn(),
    stop: vi.fn(),
    findInPage: vi.fn(),
    stopFindInPage: vi.fn(),
    loadURL: vi.fn(async () => {})
  })
  return webview
}
