import type { AppState } from '@/store/types'
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
