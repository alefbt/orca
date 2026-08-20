import { translate } from '@/i18n/i18n'

export function getBrowserClientHostedRemoteTitle(): string {
  return translate(
    'settings.browser.clientHostedRemote.title',
    'Host remote browser pages on this device'
  )
}

// New pages only: placement is fixed per page generation, so live pages are never migrated.
export function getBrowserClientHostedRemoteDescription(): string {
  return translate(
    'settings.browser.clientHostedRemote.description',
    'Render remote workspace pages on this desktop; network traffic still goes through the remote host. Applies to new pages only.'
  )
}
