import type { BrowserClientPageMetadataUnpublished } from './browser-client-page-metadata-publisher'

/**
 * Why this exists at all: a client-hosted page's URL and title only reach its runtime through a
 * metadata publish, so a publish that quietly fails presents downstream as a page that never
 * navigated — the runtime, other clients, and page recovery all keep showing where it started.
 * That failure mode went unnoticed for as long as the publisher discarded its own outcome.
 *
 * Warned once per page and reason: publishes fire on every navigation and title change, and a
 * standing fault would otherwise bury the log it is trying to make visible.
 */
const warnedByPageId = new Map<string, Set<string>>()

export function reportUnpublishedBrowserClientPageMetadata(
  browserPageId: string,
  detail: BrowserClientPageMetadataUnpublished
): void {
  const key = detail.reason === 'failed' ? `failed:${detail.errorCode}` : detail.reason
  let warned = warnedByPageId.get(browserPageId)
  if (!warned) {
    warned = new Set()
    warnedByPageId.set(browserPageId, warned)
  }
  if (warned.has(key)) {
    return
  }
  warned.add(key)
  console.warn('[browser-client-page] metadata publish did not land:', { browserPageId, ...detail })
}

export function forgetBrowserClientPageMetadataReports(browserPageId: string): void {
  warnedByPageId.delete(browserPageId)
}

export function resetBrowserClientPageMetadataReportsForTests(): void {
  warnedByPageId.clear()
}
