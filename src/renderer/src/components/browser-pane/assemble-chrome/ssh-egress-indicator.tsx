import { useState } from 'react'
import { Globe, Monitor, Server } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { BROWSER_SSH_WORKSPACE_ROUTING_SETTINGS_TARGET_ID } from '@/lib/settings-navigation-types'
import {
  isRuntimeOwnedSshTargetId,
  parseExecutionHostId
} from '../../../../../shared/execution-host'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'

/**
 * The address bar's leading icon, egress-aware: routed tabs and local tabs
 * look identical when working, and per-host opt-outs exist, so for SSH
 * workspaces the globe becomes the one visible tell of where a page's traffic
 * leaves from. Clicking expands the explanation and a settings link; non-SSH
 * workspaces keep the plain globe (this component owns the slot either way,
 * so the fallback lives here rather than in the address bar).
 */
export function SshEgressIndicator({
  worktreeId
}: {
  worktreeId: string
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
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
    return <Globe className="size-4 shrink-0 text-muted-foreground" />
  }
  const routed = routingEnabled && !disabledTargetIds?.includes(targetId)
  const hostLabel = sshTargetLabels.get(targetId) ?? targetId
  const description = routed
    ? translate('browser.sshEgress.routedTooltip', 'Browsing through {{value0}}', {
        value0: hostLabel
      })
    : translate('browser.sshEgress.localTooltip', 'Browsing from this device, not {{value0}}', {
        value0: hostLabel
      })
  return (
    <Popover modal={false} open={open} onOpenChange={setOpen}>
      {/* Why: suppress the hover tooltip while the popover is open — both anchor below the icon and would overlap. */}
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={description}
              data-testid="ssh-egress-indicator"
              data-egress={routed ? 'ssh' : 'local'}
              // Why: the address bar form focuses its input on any click inside it.
              onClick={(event) => event.stopPropagation()}
            >
              {routed ? <Server className="size-4" /> : <Monitor className="size-4" />}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8}>
          {description}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-72 p-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="text-sm font-medium text-foreground">{description}</div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">
          {routed
            ? translate(
                'browser.sshEgress.routedDetail',
                "Network traffic and DNS go through the workspace's SSH host."
              )
            : translate(
                'browser.sshEgress.localDetail',
                'Pages load from this machine and its network.'
              )}
        </div>
        <Button
          type="button"
          variant="link"
          size="xs"
          className="mt-1.5 h-auto px-0"
          data-testid="ssh-egress-indicator-settings"
          onClick={() => {
            setOpen(false)
            openSettingsTarget({
              pane: 'browser',
              repoId: null,
              sectionId: BROWSER_SSH_WORKSPACE_ROUTING_SETTINGS_TARGET_ID
            })
            openSettingsPage()
          }}
        >
          {translate('browser.sshEgress.settingsLink', 'Routing settings')}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
