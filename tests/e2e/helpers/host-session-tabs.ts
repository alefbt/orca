import type { RuntimeClient } from '../../../src/cli/runtime/client'
import type { RuntimeMobileSessionTabsResult } from '../../../src/shared/runtime-types'

/**
 * The host's own view of a worktree's session tabs. Asking the host directly is what makes a close
 * test a real oracle: a client-side re-derivation of who owns the tab stops guarding the moment the
 * ownership policy it copied changes.
 */
export async function readHostTabs(
  hostClient: RuntimeClient,
  repoPath: string
): Promise<RuntimeMobileSessionTabsResult> {
  const response = await hostClient.call<RuntimeMobileSessionTabsResult>('session.tabs.list', {
    worktree: `path:${repoPath}`
  })
  return response.result
}

/** Ids of the browser tabs the host currently publishes for the worktree. */
export async function readHostBrowserPageIds(
  hostClient: RuntimeClient,
  repoPath: string
): Promise<string[]> {
  const snapshot = await readHostTabs(hostClient, repoPath)
  return snapshot.tabs
    .filter((tab) => tab.type === 'browser')
    .map((tab) => tab.browserPageId ?? tab.id)
    .sort()
}
