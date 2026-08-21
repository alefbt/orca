// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toastMocks = vi.hoisted(() => ({
  loading: vi.fn(),
  success: vi.fn(),
  error: vi.fn()
}))

vi.mock('sonner', () => ({ toast: toastMocks }))

import type {
  BrowserDownloadFinishedEvent,
  BrowserDownloadProgressEvent,
  BrowserDownloadRequestedEvent
} from '../../../../shared/browser-guest-events'
import { TooltipProvider } from '@/components/ui/tooltip'
import { installClientHostedPaneApi, paneChannel } from './client-hosted-browser-pane-test-rig'
import { ClientHostedBrowserPagePane } from './ClientHostedBrowserPagePane'

let requested = paneChannel<BrowserDownloadRequestedEvent>()
let progress = paneChannel<BrowserDownloadProgressEvent>()
let finished = paneChannel<BrowserDownloadFinishedEvent>()

beforeEach(() => {
  requested = paneChannel<BrowserDownloadRequestedEvent>()
  progress = paneChannel<BrowserDownloadProgressEvent>()
  finished = paneChannel<BrowserDownloadFinishedEvent>()
  // Only the preload boundary is faked: the pane subscribes through the real window.api surface.
  installClientHostedPaneApi({
    browser: {
      onDownloadRequested: requested.subscribe,
      onDownloadProgress: progress.subscribe,
      onDownloadFinished: finished.subscribe
    }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPane(browserPageId = 'page-a'): void {
  render(
    <TooltipProvider>
      <ClientHostedBrowserPagePane
        browserTab={
          {
            id: browserPageId,
            url: 'https://example.internal/reports',
            title: 'Reports',
            loading: false,
            canGoBack: false,
            canGoForward: false
          } as never
        }
        workspaceId="workspace-a"
        chromeShortcutScope="focused"
        runtimeEnvironmentId="environment-a"
        worktreeId="worktree-a"
        placement={{
          kind: 'client',
          browserHostClientId: 'client-a',
          browserHostGeneration: 3,
          pageHostGeneration: 7
        }}
        isActive
        onUpdatePageState={vi.fn()}
        onSetUrl={vi.fn()}
      />
    </TooltipProvider>
  )
}

function emitRequested(overrides: Partial<BrowserDownloadRequestedEvent> = {}): void {
  const event = {
    browserPageId: 'page-a',
    downloadId: 'download-1',
    origin: 'https://example.internal',
    filename: 'report.pdf',
    totalBytes: 1024,
    mimeType: 'application/pdf',
    savePath: '/tmp/staging/download',
    status: 'downloading',
    ...overrides
  } as BrowserDownloadRequestedEvent
  act(() => requested.emit(event))
}

function emitFinished(overrides: Partial<BrowserDownloadFinishedEvent> = {}): void {
  const event = {
    browserPageId: 'page-a',
    downloadId: 'download-1',
    status: 'completed',
    savePath: null,
    error: null,
    ...overrides
  } as BrowserDownloadFinishedEvent
  act(() => finished.emit(event))
}

describe('ClientHostedBrowserPagePane download notices', () => {
  it('subscribes to the download lifecycle for the page it renders', () => {
    renderPane()

    expect(requested.listenerCount()).toBe(1)
    expect(finished.listenerCount()).toBe(1)
  })

  it('names the remote workspace destination when the download lands there', () => {
    renderPane()

    emitRequested()
    expect(toastMocks.loading).toHaveBeenCalledWith('Downloading report.pdf…', {
      id: 'browser-download:download-1'
    })

    emitFinished({
      remoteDestination: {
        workspaceRelativePath: '.orca/browser-downloads/report.pdf',
        hostLabel: 'build-box'
      }
    })

    expect(toastMocks.success).toHaveBeenCalledWith(
      'Saved to .orca/browser-downloads/report.pdf on build-box',
      { id: 'browser-download:download-1' }
    )
  })

  it('surfaces the fail-closed remote error instead of dropping it', () => {
    renderPane()
    emitRequested()

    emitFinished({
      status: 'failed',
      error: 'Could not save the download to the remote workspace.'
    })

    expect(toastMocks.error).toHaveBeenCalledWith(
      'Could not save the download to the remote workspace.',
      { id: 'browser-download:download-1' }
    )
  })

  it('reports a canceled download rather than leaving the spinner running', () => {
    renderPane()
    emitRequested()

    emitFinished({ status: 'canceled' })

    expect(toastMocks.error).toHaveBeenCalledWith('Download canceled.', {
      id: 'browser-download:download-1'
    })
  })

  it('ignores downloads belonging to another page', () => {
    renderPane('page-a')

    emitRequested({ browserPageId: 'page-b', downloadId: 'download-2' })
    emitFinished({ browserPageId: 'page-b', downloadId: 'download-2' })

    expect(toastMocks.loading).not.toHaveBeenCalled()
    expect(toastMocks.success).not.toHaveBeenCalled()
  })
})
