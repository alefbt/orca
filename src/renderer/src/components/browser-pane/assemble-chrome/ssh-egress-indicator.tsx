import { Monitor, Network } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { BROWSER_SSH_WORKSPACE_ROUTING_SETTINGS_TARGET_ID } from '@/lib/settings-navigation-types'
import {
  isRuntimeOwnedSshTargetId,
  parseExecutionHostId
} from '../../../../../shared/execution-host'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'

/**
 * Egress locus for SSH-workspace browser tabs: routed tabs and local tabs look
 * identical when working, and per-host opt-outs exist — this chip is the one
 * visible tell of where a page's traffic leaves from. Clicking jumps to the
 * routing setting.
 */
export function SshEgressIndicator({
  worktreeId
}: {
  worktreeId: string
}): React.JSX.Element | null {
  const executionHostId = useAppStore((s) => getExecutionHostIdForWorktree(s, worktreeId))
  const routingEnabled = useAppStore((s) => s.settings?.browserSshWorkspaceRoutingEnabled !== false)
  const disabledTargetIds = useAppStore(
    (s) => s.settings?.browserSshWorkspaceRoutingDisabledTargetIds
  )
  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const parsed = parseExecutionHostId(executionHostId)
  const targetId =
    parsed?.kind === 'ssh' && !isRuntimeOwnedSshTargetId(parsed.targetId) ? parsed.targetId : null
  if (!targetId) {
    return null
  }
  const routed = routingEnabled && !disabledTargetIds?.includes(targetId)
  const hostLabel = sshTargetLabels.get(targetId) ?? targetId
  const description = routed
    ? translate('browser.sshEgress.routedTooltip', 'Browsing through {value0}', {
        value0: hostLabel
      })
    : translate('browser.sshEgress.localTooltip', 'Browsing from this device, not {value0}', {
        value0: hostLabel
      })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 max-w-40 gap-1 px-2 text-xs text-muted-foreground"
          aria-label={description}
          data-testid="ssh-egress-indicator"
          data-egress={routed ? 'ssh' : 'local'}
          onClick={() => {
            openSettingsTarget({
              pane: 'browser',
              repoId: null,
              sectionId: BROWSER_SSH_WORKSPACE_ROUTING_SETTINGS_TARGET_ID
            })
            openSettingsPage()
          }}
        >
          {routed ? <Network className="size-3.5" /> : <Monitor className="size-3.5" />}
          <span className="min-w-0 truncate">
            {routed ? hostLabel : translate('browser.sshEgress.localChip', 'This device')}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {description}
      </TooltipContent>
    </Tooltip>
  )
}
