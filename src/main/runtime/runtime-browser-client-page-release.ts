import type { RuntimeBrowserClientPlacement } from '../../shared/runtime-browser-placement'
import { getRuntimeBrowserPageRegistry } from './runtime-browser-page-registry'

export type RuntimeBrowserClientPageReleaseHost = {
  notifyMobileSessionTabsChanged?(workspaceId: string): void
  retireRuntimeOwnedBrowserSessionTab?(workspaceId: string, browserPageId: string): void
}

/**
 * Drops the runtime's record of a client page no host can serve any more.
 *
 * The client-side acknowledgement that normally retires a page never arrives once its lease is
 * fenced, so without this the tab stays listed and un-closeable for the life of the runtime.
 * A page already re-placed under another lease keeps its record: the placement no longer matches.
 */
export function releaseRuntimeBrowserClientPageRecord(
  runtime: RuntimeBrowserClientPageReleaseHost,
  browserPageId: string,
  placement: RuntimeBrowserClientPlacement
): boolean {
  const pages = getRuntimeBrowserPageRegistry(runtime)
  const page = pages.getPage(browserPageId)
  if (!page || !pages.retirePage(browserPageId, placement)) {
    return false
  }
  if (runtime.retireRuntimeOwnedBrowserSessionTab) {
    runtime.retireRuntimeOwnedBrowserSessionTab(page.workspaceId, browserPageId)
  } else {
    runtime.notifyMobileSessionTabsChanged?.(page.workspaceId)
  }
  return true
}
