import { Globe } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { useSshWorkspaceBrowserRoute } from '../use-ssh-workspace-browser-route'

/**
 * Fail-closed mount gate for SSH workspaces: pages render only on the
 * proxy-verified route partition. While it prepares (or after it fails) no
 * webview exists at all — an unrouted fallback would silently browse from the
 * local machine instead of the SSH host.
 */
export function SshRoutedBrowserPageGate({
  worktreeId,
  sessionProfileId,
  children
}: {
  worktreeId: string
  sessionProfileId: string | null
  children: (routedPartition: string | null) => React.JSX.Element
}): React.JSX.Element {
  const { state, retry } = useSshWorkspaceBrowserRoute(worktreeId, sessionProfileId)
  if (state.kind === 'unrouted') {
    return children(null)
  }
  if (state.kind === 'ready') {
    return children(state.partition)
  }
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-background px-6 text-center">
      <div className="flex max-w-sm flex-col items-center gap-2">
        <Globe className="size-5 text-muted-foreground" />
        {state.kind === 'preparing' ? (
          <div className="text-sm font-medium text-foreground">
            {translate('browser.sshRoute.preparingTitle', 'Connecting through the SSH host')}
          </div>
        ) : (
          <>
            <div className="text-sm font-medium text-foreground">
              {translate('browser.sshRoute.errorTitle', 'SSH browser routing unavailable')}
            </div>
            <div className="text-xs leading-5 text-muted-foreground">
              {translate(
                'browser.sshRoute.errorDescription',
                'Pages in this workspace browse through its SSH host, and that connection is not available right now.'
              )}
            </div>
            <div className="break-all text-xs leading-5 text-muted-foreground">{state.message}</div>
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              {translate('browser.sshRoute.retry', 'Retry')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
