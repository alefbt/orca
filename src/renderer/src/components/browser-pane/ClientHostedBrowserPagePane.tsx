import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { Globe } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type {
  BrowserLoadError,
  BrowserPage as BrowserPageState
} from '../../../../shared/browser-workspace-types'
import { redactKagiSessionToken, toHttpsRecoveryUrl } from '../../../../shared/browser-url'
import type { RuntimeBrowserClientPlacement } from '../../../../shared/runtime-browser-placement'
import {
  createBrowserClientPageMetadataPublisher,
  type BrowserClientPageMetadataSnapshot
} from './browser-client-page-metadata-publisher'
import { attachBrowserClientPageToViewport } from './browser-client-page-renderer-installation'
import { useBrowserClientHostedDownloadNotices } from './browser-client-hosted-download-notices'
import { useBrowserClientHostedPopupNotices } from './browser-client-hosted-popup-notices'
import { useClientHostedBrowserIntroTour } from './use-client-hosted-browser-intro-tour'
import {
  ReopenBrowserPageOnServerButton,
  reopenOnServerCaveat
} from './ReopenBrowserPageOnServerButton'
import { BrowserNavigationControlRow } from './assemble-chrome/browser-navigation-control-row'
import { RemoteRuntimeEgressIndicator } from './assemble-chrome/browser-egress-indicator'
import { BrowserLoadFailureOverlay } from './navigate/browser-load-failure-overlay'
import { resolveBrowserAddressBarSubmission } from './navigate/browser-address-bar-navigation'
import { resolveBrowserWebviewLoadFailure } from './navigate/browser-webview-load-failure'
import { toDisplayUrl } from './describe-page/browser-page-url-display'
import type {
  BrowserPageFailLoadEvent,
  BrowserPageUrlSetter,
  BrowserTabPageState
} from './describe-page/browser-page-types'

export function ClientHostedBrowserPagePane({
  browserTab,
  runtimeEnvironmentId,
  worktreeId,
  placement,
  isActive,
  onUpdatePageState,
  onSetUrl
}: {
  browserTab: BrowserPageState
  runtimeEnvironmentId: string
  worktreeId: string
  placement: RuntimeBrowserClientPlacement
  isActive: boolean
  onUpdatePageState: (tabId: string, updates: BrowserTabPageState) => void
  onSetUrl: BrowserPageUrlSetter
}): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const addressBarInputRef = useRef<HTMLInputElement | null>(null)
  const activeLoadFailureRef = useRef<BrowserLoadError | null>(null)
  const [addressBarValue, setAddressBarValue] = useState(toDisplayUrl(browserTab.url))
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const updatePageStateFromGuest = useEffectEvent(onUpdatePageState)
  const setUrlFromGuest = useEffectEvent(onSetUrl)
  const { browserHostClientId, browserHostGeneration, pageHostGeneration } = placement

  useBrowserClientHostedDownloadNotices(browserTab.id)
  useBrowserClientHostedPopupNotices(browserTab.id)
  useClientHostedBrowserIntroTour(isActive && !attachmentError)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    let attachment: ReturnType<typeof attachBrowserClientPageToViewport>
    try {
      attachment = attachBrowserClientPageToViewport(
        { browserPageId: browserTab.id, pageHostGeneration },
        viewport
      )
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'browser_client_page_unavailable')
      return
    }
    if (!attachment) {
      setAttachmentError('browser_client_page_renderer_unavailable')
      return
    }
    const webview = attachment.webview
    const publisher = createBrowserClientPageMetadataPublisher({
      environmentId: runtimeEnvironmentId,
      browserPageId: browserTab.id,
      placement: {
        kind: 'client',
        browserHostClientId,
        browserHostGeneration,
        pageHostGeneration
      },
      nextRevision: attachment.nextMetadataRevision,
      call: (args) => window.api.runtimeEnvironments.call(args)
    })
    webviewRef.current = webview
    setAttachmentError(null)
    const syncNavigation = (event?: Event): void => {
      const eventUrl = (event as (Event & { url?: string }) | undefined)?.url
      const metadata = readClientPageMetadata(webview, eventUrl)
      setUrlFromGuest(browserTab.id, metadata.url, {
        preserveLoadError: true
      })
      updatePageStateFromGuest(browserTab.id, {
        title: metadata.title,
        loading: metadata.loading,
        canGoBack: metadata.canGoBack,
        canGoForward: metadata.canGoForward,
        // Why: did-stop-loading fires after did-fail-load, so an unconditional null here
        // would wipe the failure the overlay is about to show.
        loadError: activeLoadFailureRef.current
      })
      publisher.publish(metadata)
      setAddressBarValue(toDisplayUrl(metadata.url))
    }
    const onStart = (): void => {
      activeLoadFailureRef.current = null
      updatePageStateFromGuest(browserTab.id, { loading: true, loadError: null })
      publisher.publish(readClientPageMetadata(webview, undefined, true))
    }
    const onFailLoad = (event: Event): void => {
      const loadError = resolveBrowserWebviewLoadFailure(event as BrowserPageFailLoadEvent, {
        fallbackUrl: webview.getURL()
      })
      if (!loadError) {
        return
      }
      activeLoadFailureRef.current = loadError
      updatePageStateFromGuest(browserTab.id, { loading: false, loadError })
    }
    webview.addEventListener('did-start-loading', onStart)
    webview.addEventListener('did-stop-loading', syncNavigation)
    webview.addEventListener('did-navigate', syncNavigation)
    webview.addEventListener('did-navigate-in-page', syncNavigation)
    webview.addEventListener('page-title-updated', syncNavigation)
    webview.addEventListener('did-fail-load', onFailLoad)
    syncNavigation()
    return () => {
      webview.removeEventListener('did-start-loading', onStart)
      webview.removeEventListener('did-stop-loading', syncNavigation)
      webview.removeEventListener('did-navigate', syncNavigation)
      webview.removeEventListener('did-navigate-in-page', syncNavigation)
      webview.removeEventListener('page-title-updated', syncNavigation)
      webview.removeEventListener('did-fail-load', onFailLoad)
      if (webviewRef.current === webview) {
        webviewRef.current = null
      }
      publisher.dispose()
      attachment.detach()
    }
  }, [
    browserTab.id,
    browserHostClientId,
    browserHostGeneration,
    pageHostGeneration,
    runtimeEnvironmentId
  ])

  useEffect(() => {
    if (isActive) {
      webviewRef.current?.focus()
    }
  }, [isActive])

  useEffect(() => {
    setAddressBarValue(toDisplayUrl(browserTab.url))
  }, [browserTab.url])

  const navigateToUrl = useCallback(
    (value: string) => {
      const submission = resolveBrowserAddressBarSubmission(value)
      if (submission.status === 'invalid') {
        onUpdatePageState(browserTab.id, { loadError: submission.loadError })
        return
      }
      const webview = webviewRef.current
      if (!webview) {
        return
      }
      activeLoadFailureRef.current = null
      setAddressBarValue(toDisplayUrl(submission.url))
      onUpdatePageState(browserTab.id, { loading: true, loadError: null })
      // Why: loadURL rejects on any failed navigation; did-fail-load owns error reporting.
      void webview.loadURL(submission.url).catch(() => {})
    },
    [browserTab.id, onUpdatePageState]
  )

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col bg-background">
      <div data-contextual-tour-target="client-hosted-browser-controls">
        <BrowserNavigationControlRow
          controls={{
            canGoBack: browserTab.canGoBack,
            canGoForward: browserTab.canGoForward,
            loading: browserTab.loading,
            goBack: () => webviewRef.current?.goBack(),
            goForward: () => webviewRef.current?.goForward(),
            reload: () => webviewRef.current?.reload(),
            navigate: navigateToUrl
          }}
          addressBarValue={addressBarValue}
          onAddressBarChange={setAddressBarValue}
          onSubmitAddressBar={() => navigateToUrl(addressBarValue)}
          addressBarInputRef={addressBarInputRef}
          addressBarLeadingIcon={
            <RemoteRuntimeEgressIndicator
              runtimeEnvironmentId={runtimeEnvironmentId}
              presentation="client-hosted"
            />
          }
        />
      </div>
      <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-hidden bg-background">
        {!attachmentError && browserTab.loadError ? (
          <BrowserLoadFailureOverlay
            loadError={browserTab.loadError}
            currentUrl={toDisplayUrl(browserTab.url)}
            httpsRecoveryUrl={toHttpsRecoveryUrl(browserTab.url)}
            onRetry={() => webviewRef.current?.reload()}
            onTryHttps={navigateToUrl}
            onCopy={(url) => void window.api.ui.writeClipboardText(url)}
          />
        ) : null}
        {attachmentError ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <div className="flex max-w-sm flex-col items-center gap-2">
              <Globe className="size-5 text-muted-foreground" />
              <div className="text-sm font-medium text-foreground">
                {translate(
                  'browser.clientHosted.unavailableTitle',
                  'Client-hosted browser unavailable'
                )}
              </div>
              <div className="text-xs leading-5 text-muted-foreground">
                {translate(
                  'browser.clientHosted.unavailableDescription',
                  'This page is attached to a different desktop or is no longer available.'
                )}
              </div>
              <div className="text-xs leading-5 text-muted-foreground">
                {reopenOnServerCaveat()}
              </div>
              <ReopenBrowserPageOnServerButton
                environmentId={runtimeEnvironmentId}
                worktreeId={worktreeId}
                lastCommittedUrl={browserTab.url}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function readClientPageMetadata(
  webview: Electron.WebviewTag,
  eventUrl?: string,
  loading?: boolean
): BrowserClientPageMetadataSnapshot {
  const url = redactKagiSessionToken(eventUrl || webview.getURL() || 'about:blank')
  return {
    url,
    title: webview.getTitle() || url || 'Browser',
    loading: loading ?? webview.isLoading(),
    canGoBack: webview.canGoBack(),
    canGoForward: webview.canGoForward()
  }
}
