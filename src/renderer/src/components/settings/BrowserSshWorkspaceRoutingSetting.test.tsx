// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../ui/tooltip'
import { BrowserSshWorkspaceRoutingSetting } from './BrowserSshWorkspaceRoutingSetting'
import type { GlobalSettings } from '../../../../shared/global-settings-types'

vi.mock('../../store', () => ({
  useAppStore: (
    selector: (state: {
      settingsSearchQuery: string
      sshTargetLabels: Map<string, string>
    }) => unknown
  ) =>
    selector({
      settingsSearchQuery: '',
      sshTargetLabels: new Map([['target-a', 'openclaw']])
    })
}))

type RoutingSettings = Pick<
  GlobalSettings,
  | 'browserSshWorkspaceRoutingEnabled'
  | 'browserSshWorkspaceRoutingDisabledTargetIds'
  | 'browserSshWorkspaceRoutingProbeSkippedTargetIds'
>

function renderSetting(
  settings: RoutingSettings,
  updateSettings: (updates: Partial<GlobalSettings>) => void = vi.fn()
): void {
  render(
    <TooltipProvider>
      <BrowserSshWorkspaceRoutingSetting settings={settings} updateSettings={updateSettings} />
    </TooltipProvider>
  )
}

describe('BrowserSshWorkspaceRoutingSetting', () => {
  afterEach(() => {
    cleanup()
  })

  it('hides both per-host lists when no host carries an override', () => {
    renderSetting({})
    expect(screen.queryByText(/browsing from this device/i)).toBeNull()
    expect(screen.queryByText(/connection check/i)).toBeNull()
  })

  it('restores routing for an opted-out host via Use SSH host', () => {
    const updateSettings = vi.fn()
    renderSetting({ browserSshWorkspaceRoutingDisabledTargetIds: ['target-a'] }, updateSettings)
    expect(screen.getByText('openclaw')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use SSH host' }))
    expect(updateSettings).toHaveBeenCalledWith({
      browserSshWorkspaceRoutingDisabledTargetIds: []
    })
  })

  it('clears a persisted Try-anyway via Check again so the probe runs again', () => {
    const updateSettings = vi.fn()
    renderSetting({ browserSshWorkspaceRoutingProbeSkippedTargetIds: ['target-a'] }, updateSettings)
    expect(screen.getByText(/Try anyway/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(updateSettings).toHaveBeenCalledWith({
      browserSshWorkspaceRoutingProbeSkippedTargetIds: []
    })
  })
})
