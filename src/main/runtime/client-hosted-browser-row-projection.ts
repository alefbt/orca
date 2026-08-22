import type { ClientHostedBrowserRow } from '../../shared/client-hosted-browser-rows'
import type { RuntimeBrowserClientPage } from './runtime-browser-page-registry'

export type ClientHostedBrowserRowSources = {
  /** False once the lease that placed the page is gone — the page is retained but undriveable. */
  hasLivePlacement(browserPageId: string): boolean
  resolveDeviceName(pairedDeviceId: string): string | null
}

export function projectClientHostedBrowserRows(
  pages: readonly RuntimeBrowserClientPage[],
  sources: ClientHostedBrowserRowSources
): ClientHostedBrowserRow[] {
  return pages.map((page) => {
    const hostAbsent = !sources.hasLivePlacement(page.browserPageId)
    return {
      browserPageId: page.browserPageId,
      worktreeId: page.workspaceId,
      url: page.url,
      title: page.title,
      // Why: an absent host cannot finish a load, so a carried-over spinner would never settle.
      loading: hostAbsent ? false : page.loading,
      browserHostClientId: page.placement.browserHostClientId,
      hostDeviceName: page.pairedDeviceId ? sources.resolveDeviceName(page.pairedDeviceId) : null,
      hostAbsent
    }
  })
}
