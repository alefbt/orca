import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { isRuntimeOwnedSshTargetId, parseExecutionHostId } from '../../../../shared/execution-host'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'

export type SshWorkspaceBrowserRouteErrorKind = 'forwarding-blocked' | 'ssh-unavailable' | 'unknown'

export type SshWorkspaceBrowserRouteState =
  | { kind: 'unrouted' }
  | { kind: 'preparing' }
  | { kind: 'ready'; partition: string; targetId: string }
  | { kind: 'error'; errorKind: SshWorkspaceBrowserRouteErrorKind; message: string }

export function classifySshWorkspaceBrowserRouteError(
  message: string
): SshWorkspaceBrowserRouteErrorKind {
  if (message.includes('browser_local_route_forwarding_blocked')) {
    return 'forwarding-blocked'
  }
  if (
    message.includes('browser_local_route_ssh_unavailable') ||
    message.includes('browser_tunnel_execution_host_unavailable')
  ) {
    return 'ssh-unavailable'
  }
  return 'unknown'
}

/**
 * Resolves the proxy-verified partition an SSH workspace's browser page must
 * mount on. Fail-closed: while preparing or failed, the caller must not mount
 * a webview at all — falling back to a profile partition would silently browse
 * from the local machine instead of the SSH host. The only unrouted paths are
 * explicit: the global setting, or a per-target opt-out the user chose from
 * the error card.
 */
export function useSshWorkspaceBrowserRoute(
  worktreeId: string,
  sessionProfileId: string | null
): {
  state: SshWorkspaceBrowserRouteState
  targetId: string | null
  retry: () => void
  tryWithoutProbe: () => void
  browseFromThisDevice: () => void
} {
  const executionHostId = useAppStore((s) => getExecutionHostIdForWorktree(s, worktreeId))
  const routingEnabled = useAppStore((s) => s.settings?.browserSshWorkspaceRoutingEnabled !== false)
  const disabledTargetIds = useAppStore(
    (s) => s.settings?.browserSshWorkspaceRoutingDisabledTargetIds
  )
  const updateSettings = useAppStore((s) => s.updateSettings)
  const parsed = parseExecutionHostId(executionHostId)
  // Why: runtime-owned ephemeral targets belong to a paired runtime's own machinery.
  const sshTargetId =
    parsed?.kind === 'ssh' && !isRuntimeOwnedSshTargetId(parsed.targetId) ? parsed.targetId : null
  const targetId =
    routingEnabled && sshTargetId && !disabledTargetIds?.includes(sshTargetId) ? sshTargetId : null
  const browserProfileId = sessionProfileId ?? 'default'
  const [attempt, setAttempt] = useState<{ count: number; skipProbe: boolean }>({
    count: 0,
    skipProbe: false
  })
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
      .prepareSshWorkspacePartition({
        targetId,
        browserProfileId,
        ...(attempt.skipProbe ? { skipProbe: true } : {})
      })
      .then((result) => {
        if (!cancelled) {
          setState({ kind: 'ready', partition: result.partition, targetId })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error)
          setState({
            kind: 'error',
            errorKind: classifySshWorkspaceBrowserRouteError(message),
            message
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [targetId, browserProfileId, attempt])

  // Why (review P1-1): `state` lags one commit behind a targetId transition on
  // an already-mounted instance; returning stale 'unrouted' (or a stale
  // 'ready' minted for a different target) for that render would mount a
  // webview with the wrong egress before the effect corrects it. The
  // routed/unrouted decision must be derived from targetId in-render.
  const effectiveState: SshWorkspaceBrowserRouteState = !targetId
    ? { kind: 'unrouted' }
    : state.kind === 'unrouted' || (state.kind === 'ready' && state.targetId !== targetId)
      ? { kind: 'preparing' }
      : state
  return {
    state: effectiveState,
    targetId: sshTargetId,
    retry: () => setAttempt((current) => ({ count: current.count + 1, skipProbe: false })),
    tryWithoutProbe: () => setAttempt((current) => ({ count: current.count + 1, skipProbe: true })),
    browseFromThisDevice: () => {
      if (!sshTargetId) {
        return
      }
      const disabled = disabledTargetIds ?? []
      if (!disabled.includes(sshTargetId)) {
        updateSettings({
          browserSshWorkspaceRoutingDisabledTargetIds: [...disabled, sshTargetId]
        })
      }
    }
  }
}
