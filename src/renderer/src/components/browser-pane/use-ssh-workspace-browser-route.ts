import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { isRuntimeOwnedSshTargetId, parseExecutionHostId } from '../../../../shared/execution-host'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'

export type SshWorkspaceBrowserRouteState =
  | { kind: 'unrouted' }
  | { kind: 'preparing' }
  | { kind: 'ready'; partition: string }
  | { kind: 'error'; message: string }

/**
 * Resolves the proxy-verified partition an SSH workspace's browser page must
 * mount on. Fail-closed: while preparing or failed, the caller must not mount
 * a webview at all — falling back to a profile partition would silently browse
 * from the local machine instead of the SSH host.
 */
export function useSshWorkspaceBrowserRoute(
  worktreeId: string,
  sessionProfileId: string | null
): { state: SshWorkspaceBrowserRouteState; retry: () => void } {
  const executionHostId = useAppStore((s) => getExecutionHostIdForWorktree(s, worktreeId))
  const routingEnabled = useAppStore((s) => s.settings?.browserSshWorkspaceRoutingEnabled !== false)
  const parsed = parseExecutionHostId(executionHostId)
  // Why: runtime-owned ephemeral targets belong to a paired runtime's own machinery.
  const targetId =
    routingEnabled && parsed?.kind === 'ssh' && !isRuntimeOwnedSshTargetId(parsed.targetId)
      ? parsed.targetId
      : null
  const browserProfileId = sessionProfileId ?? 'default'
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<SshWorkspaceBrowserRouteState>(
    targetId ? { kind: 'preparing' } : { kind: 'unrouted' }
  )

  useEffect(() => {
    if (!targetId) {
      setState({ kind: 'unrouted' })
      return
    }
    let cancelled = false
    setState({ kind: 'preparing' })
    window.api.browser
      .prepareSshWorkspacePartition({ targetId, browserProfileId })
      .then((result) => {
        if (!cancelled) {
          setState({ kind: 'ready', partition: result.partition })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error)
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [targetId, browserProfileId, attempt])

  return { state, retry: () => setAttempt((current) => current + 1) }
}
