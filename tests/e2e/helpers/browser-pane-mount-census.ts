import type { Page } from '@stablyai/playwright-test'

/**
 * Every `<webview>` a browser pane ever attached, in order, with the partition it was born with.
 *
 * Why a census instead of a DOM read: Electron partitions are immutable after creation, so the
 * pane replaces a guest whenever the partition it should use changes. A guest that mounts on the
 * wrong session and is swapped out a frame later leaves no trace for `querySelector` — only an
 * observer running from before the first mount can prove it never happened.
 *
 * The SSH-routing gate's own cards are recorded on the same timeline so a spec can assert the
 * ordering between "gate is still preparing" and "a guest attached".
 */
export type BrowserPaneMountCensusEntry =
  | { kind: 'webview'; overlayTabId: string | null; partition: string | null; at: number }
  | { kind: 'gate-preparing' | 'gate-error'; overlayTabId: string | null; at: number }

const GATE_PREPARING_TEXT = 'Connecting through the SSH host'
const GATE_ERROR_TEXT = 'SSH browser routing unavailable'
const CENSUS_KEY = '__orcaBrowserPaneMountCensus'

/** Must run before the first browser tab of interest is created. Idempotent per page. */
export async function installBrowserPaneMountCensus(page: Page): Promise<void> {
  await page.evaluate(
    ({ censusKey, preparingText, errorText }) => {
      const scope = window as unknown as Record<string, unknown>
      if (scope[censusKey]) {
        return
      }
      const census: BrowserPaneMountCensusEntry[] = []
      scope[censusKey] = census
      const overlayTabIdOf = (node: Element): string | null =>
        node
          .closest('[data-browser-overlay-tab-id]')
          ?.getAttribute('data-browser-overlay-tab-id') ?? null
      const record = (node: Node): void => {
        if (!(node instanceof Element)) {
          return
        }
        const webviews = node.tagName === 'WEBVIEW' ? [node] : [...node.querySelectorAll('webview')]
        for (const webview of webviews) {
          census.push({
            kind: 'webview',
            overlayTabId: overlayTabIdOf(webview),
            partition: webview.getAttribute('partition'),
            at: Date.now()
          })
        }
        const text = node.textContent ?? ''
        if (text.includes(preparingText)) {
          census.push({
            kind: 'gate-preparing',
            overlayTabId: overlayTabIdOf(node),
            at: Date.now()
          })
        }
        if (text.includes(errorText)) {
          census.push({ kind: 'gate-error', overlayTabId: overlayTabIdOf(node), at: Date.now() })
        }
      }
      const observer = new MutationObserver((records) => {
        for (const mutation of records) {
          for (const added of mutation.addedNodes) {
            record(added)
          }
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
    },
    { censusKey: CENSUS_KEY, preparingText: GATE_PREPARING_TEXT, errorText: GATE_ERROR_TEXT }
  )
}

export async function readBrowserPaneMountCensus(
  page: Page
): Promise<BrowserPaneMountCensusEntry[]> {
  return page.evaluate((censusKey) => {
    const census = (window as unknown as Record<string, unknown>)[censusKey]
    return Array.isArray(census) ? ([...census] as BrowserPaneMountCensusEntry[]) : []
  }, CENSUS_KEY)
}
