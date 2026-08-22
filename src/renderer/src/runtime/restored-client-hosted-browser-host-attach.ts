import type { RemoteBrowserPageHandle } from '../store/slices/browser'

type RestoredBrowserHandleSource = {
  remoteBrowserPageHandlesByPageId: Record<string, RemoteBrowserPageHandle>
}

// Why module scope and not per-call: hydration is the only caller today, but a second run must not
// re-dial an environment whose host is already up or whose preparation already refused.
const attachedEnvironmentIds = new Set<string>()

/**
 * Start this desktop's browser client host for every environment the restored session says it was
 * hosting pages for. The host is otherwise started lazily on the create path, so after a relaunch
 * the runtime never sees an attach and never hands the retained pages back.
 */
export async function ensureBrowserClientHostsForRestoredPages(
  state: RestoredBrowserHandleSource
): Promise<void> {
  for (const environmentId of restoredClientHostEnvironmentIds(state)) {
    if (attachedEnvironmentIds.has(environmentId)) {
      continue
    }
    attachedEnvironmentIds.add(environmentId)
    try {
      // Idempotent per environment: the registry returns the live lease when one is already up, and
      // reserves no per-page state, so this only claims hosting duty.
      await window.api.runtimeEnvironments.prepareBrowserClientHostPlacement({
        selector: environmentId,
        preference: 'auto'
      })
    } catch (error) {
      // Why swallowed: this runs inside the startup chain, where a throw aborts hydration and boots
      // the app in degraded no-save mode. A page nobody hosts is recoverable; a lost session is not.
      console.warn(
        '[restored-client-hosted-browser] failed to start the browser client host for',
        environmentId,
        error
      )
    }
  }
}

function restoredClientHostEnvironmentIds(state: RestoredBrowserHandleSource): string[] {
  const environmentIds = new Set<string>()
  for (const handle of Object.values(state.remoteBrowserPageHandlesByPageId)) {
    if (handle.restoredClientHosted === true) {
      environmentIds.add(handle.environmentId)
    }
  }
  return [...environmentIds]
}

export function resetRestoredBrowserClientHostAttachForTests(): void {
  attachedEnvironmentIds.clear()
}
