import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitchRow } from './SettingsFormControls'
import {
  getBrowserSshWorkspaceRoutingDescription,
  getBrowserSshWorkspaceRoutingTitle
} from './browser-ssh-workspace-routing-copy'

type BrowserSshWorkspaceRoutingSettingProps = {
  settings: Pick<
    GlobalSettings,
    'browserSshWorkspaceRoutingEnabled' | 'browserSshWorkspaceRoutingDisabledTargetIds'
  >
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function BrowserSshWorkspaceRoutingSetting({
  settings,
  updateSettings
}: BrowserSshWorkspaceRoutingSettingProps): React.JSX.Element {
  const title = getBrowserSshWorkspaceRoutingTitle()
  const description = getBrowserSshWorkspaceRoutingDescription()
  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)
  const disabledTargetIds = settings.browserSshWorkspaceRoutingDisabledTargetIds ?? []

  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['browser', 'ssh', 'remote', 'proxy', 'tunnel', 'routing', 'host', 'network']}
    >
      <SettingsSwitchRow
        label={title}
        description={description}
        // Why: absent means on — routed egress is the correct default for SSH workspaces.
        checked={settings.browserSshWorkspaceRoutingEnabled !== false}
        onChange={() =>
          updateSettings({
            browserSshWorkspaceRoutingEnabled: settings.browserSshWorkspaceRoutingEnabled === false
          })
        }
      />
      {disabledTargetIds.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="text-xs text-muted-foreground">
            {translate(
              'settings.browser.sshWorkspaceRouting.disabledHosts',
              'Hosts browsing from this device instead:'
            )}
          </div>
          {disabledTargetIds.map((targetId) => (
            <div key={targetId} className="flex items-center gap-2 text-xs text-foreground">
              <span className="min-w-0 truncate">{sshTargetLabels.get(targetId) ?? targetId}</span>
              <Button
                type="button"
                variant="link"
                size="xs"
                className="h-auto px-0"
                onClick={() =>
                  updateSettings({
                    browserSshWorkspaceRoutingDisabledTargetIds: disabledTargetIds.filter(
                      (id) => id !== targetId
                    )
                  })
                }
              >
                {translate('settings.browser.sshWorkspaceRouting.enableHost', 'Route again')}
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </SearchableSetting>
  )
}
