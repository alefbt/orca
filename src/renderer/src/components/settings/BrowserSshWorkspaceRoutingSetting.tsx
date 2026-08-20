import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitchRow } from './SettingsFormControls'
import {
  getBrowserSshWorkspaceRoutingDescription,
  getBrowserSshWorkspaceRoutingTitle
} from './browser-ssh-workspace-routing-copy'

type BrowserSshWorkspaceRoutingSettingProps = {
  settings: Pick<GlobalSettings, 'browserSshWorkspaceRoutingEnabled'>
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function BrowserSshWorkspaceRoutingSetting({
  settings,
  updateSettings
}: BrowserSshWorkspaceRoutingSettingProps): React.JSX.Element {
  const title = getBrowserSshWorkspaceRoutingTitle()
  const description = getBrowserSshWorkspaceRoutingDescription()

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
    </SearchableSetting>
  )
}
