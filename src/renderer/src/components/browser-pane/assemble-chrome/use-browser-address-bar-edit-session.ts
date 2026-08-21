import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type RefObject } from 'react'
import { toDisplayUrl } from '../describe-page/browser-page-url-display'
import {
  consumeBrowserAddressBarEditSession,
  type BrowserAddressBarSelection
} from './browser-address-bar-edit-session'

/** What a pane hands its address bar so an interrupted edit is saved and picked back up. */
export type BrowserAddressBarEditSessionBinding = {
  pageId: string
  /** The dropdown state a resumed edit reopens in; null when this mount starts a fresh bar. */
  resumedSuggestionsOpen: boolean | null
}

/**
 * The address bar's draft text, and its continuity across a remount.
 *
 * Panes that host a runtime page get swapped under React: adopting a client-hosted placement
 * replaces the streamed pane with the client-hosted one, and a host restart bumps the key of the
 * client-hosted one. Either way the chrome unmounts, and without this the user's half-typed URL,
 * caret and open suggestion list go with it.
 */
export function useBrowserAddressBarEditSession({
  pageId,
  url,
  addressBarInputRef,
  startAddressBarFocusGrab
}: {
  pageId: string
  /** The page's committed URL; the bar follows it whenever the user is not mid-edit. */
  url: string
  addressBarInputRef: RefObject<HTMLInputElement | null>
  startAddressBarFocusGrab: (selection?: BrowserAddressBarSelection) => () => void
}): {
  addressBarValue: string
  setAddressBarValue: (value: string) => void
  /** Writes the page's own URL into the bar, unless the user is typing in it. */
  setAddressBarValueFromPage: (value: string) => void
  addressBarEditSession: BrowserAddressBarEditSessionBinding
} {
  const [addressBarValue, setAddressBarValue] = useState(() => toDisplayUrl(url))
  const [resumedSuggestionsOpen, setResumedSuggestionsOpen] = useState<boolean | null>(null)

  const setAddressBarValueFromPage = useCallback(
    (next: string): void => {
      if (document.activeElement === addressBarInputRef.current) {
        return
      }
      setAddressBarValue(next)
    },
    [addressBarInputRef]
  )

  // Why layout and not passive: the client-hosted pane's guest-attach effects run in the same
  // commit, and both focusing the webview and syncing the bar to the guest's URL would undo the
  // resume. Grabbing focus here — which also raises the latch the guest-attach effect defers to —
  // settles who owns the bar before any of them look.
  useLayoutEffect(() => {
    const resumed = consumeBrowserAddressBarEditSession(pageId)
    if (!resumed) {
      return
    }
    setAddressBarValue(resumed.draft)
    setResumedSuggestionsOpen(resumed.suggestionsOpen)
    startAddressBarFocusGrab(resumed.selection)
  }, [pageId, startAddressBarFocusGrab])

  useEffect(() => {
    setAddressBarValueFromPage(toDisplayUrl(url))
  }, [setAddressBarValueFromPage, url])

  return {
    addressBarValue,
    setAddressBarValue,
    setAddressBarValueFromPage,
    addressBarEditSession: useMemo(
      () => ({ pageId, resumedSuggestionsOpen }),
      [pageId, resumedSuggestionsOpen]
    )
  }
}
