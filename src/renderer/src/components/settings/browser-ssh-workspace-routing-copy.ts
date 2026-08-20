import { translate } from '@/i18n/i18n'

export function getBrowserSshWorkspaceRoutingTitle(): string {
  return translate(
    'settings.browser.sshWorkspaceRouting.title',
    'Browse through SSH workspace hosts'
  )
}

export function getBrowserSshWorkspaceRoutingDescription(): string {
  return translate(
    'settings.browser.sshWorkspaceRouting.description',
    "Browser pages in SSH workspaces send their traffic through the workspace's SSH host, with DNS resolved there. Off means pages browse from this machine."
  )
}
