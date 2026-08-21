import type { AppState } from '@/store/types'
import { clearBrowserAddressBarEditSession } from '@/components/browser-pane/assemble-chrome/browser-address-bar-edit-session'
import { clearBrowserPageDeferredNavigation } from '@/components/browser-pane/navigate/browser-page-deferred-navigation'
import {
  planBrowserWorkspaceTabClose,
  type BrowserWorkspaceTabClosePlan
} from './browser-workspace-tab-close-plan'
import { closeWebRuntimeSessionTab, isWebRuntimeSessionActive } from './web-runtime-session'

/**
 * The one place a browser workspace's tab is closed on the runtimes that own it. Every close entry
 * point (tab strip, tab-group menu, bulk close) goes through here so none of them can grow its own
 * ownership policy — a divergent one silently skipped the pageless host mirror and left the X inert.
 */
export function closeBrowserWorkspaceTabOnHosts({
  state,
  worktreeId,
  workspaceId,
  visibleTabId,
  focusedEnvironmentId
}: {
  state: Pick<AppState, 'browserPagesByWorkspace' | 'remoteBrowserPageHandlesByPageId'>
  worktreeId: string
  workspaceId: string
  /** The tab id the host knows this mirror by. */
  visibleTabId: string
  focusedEnvironmentId: string | null | undefined
}): BrowserWorkspaceTabClosePlan {
  const plan = planBrowserWorkspaceTabClose({
    state,
    workspaceId,
    focusedEnvironmentId,
    isEnvironmentActive: isWebRuntimeSessionActive
  })
  // Why here: chrome the user was mid-way through — a half-typed URL, a URL submitted against a
  // page the host had not minted yet — is parked outside React under the page id, waiting for the
  // pane that owns it. A close is the one exit where nobody is coming to collect it.
  for (const page of state.browserPagesByWorkspace[workspaceId] ?? []) {
    clearBrowserAddressBarEditSession(page.id)
    clearBrowserPageDeferredNavigation(page.id)
  }
  for (const environmentId of plan.hostEnvironmentIds) {
    void closeWebRuntimeSessionTab({
      worktreeId,
      tabId: visibleTabId,
      environmentId,
      reason: 'user'
    })
  }
  return plan
}
