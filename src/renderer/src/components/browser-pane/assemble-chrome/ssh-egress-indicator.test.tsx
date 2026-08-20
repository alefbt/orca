// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { BROWSER_SSH_WORKSPACE_ROUTING_SETTINGS_TARGET_ID } from '@/lib/settings-navigation-types'

const mocks = vi.hoisted(() => ({
  executionHostId: 'local' as string
}))

vi.mock('@/lib/worktree-runtime-owner', () => ({
  getExecutionHostIdForWorktree: () => mocks.executionHostId
}))

import { TooltipProvider } from '@/components/ui/tooltip'
import { SshEgressIndicator } from './ssh-egress-indicator'

const renderIndicator = (worktreeId: string) =>
  render(
    <TooltipProvider>
      <SshEgressIndicator worktreeId={worktreeId} />
    </TooltipProvider>
  )

type SetState = Parameters<typeof useAppStore.setState>[0]

describe('SshEgressIndicator', () => {
  let priorSettings: ReturnType<typeof useAppStore.getState>['settings']
  let priorLabels: ReturnType<typeof useAppStore.getState>['sshTargetLabels']
  beforeEach(() => {
    priorSettings = useAppStore.getState().settings
    priorLabels = useAppStore.getState().sshTargetLabels
    useAppStore.setState({
      sshTargetLabels: new Map([['target-a', 'openclaw']])
    } as SetState)
  })
  afterEach(() => {
    useAppStore.setState({ settings: priorSettings, sshTargetLabels: priorLabels } as SetState)
    cleanup()
  })

  it('renders nothing for non-SSH workspaces', () => {
    mocks.executionHostId = 'local'
    renderIndicator('wt-1')
    expect(screen.queryByTestId('ssh-egress-indicator')).toBeNull()
  })

  it('shows the host chip for a routed SSH workspace', () => {
    mocks.executionHostId = 'ssh:target-a'
    renderIndicator('wt-1')
    const chip = screen.getByTestId('ssh-egress-indicator')
    expect(chip.getAttribute('data-egress')).toBe('ssh')
    expect(chip.textContent).toContain('openclaw')
  })

  it('shows the this-device chip when the target opted out', () => {
    mocks.executionHostId = 'ssh:target-a'
    useAppStore.setState({
      settings: { ...priorSettings, browserSshWorkspaceRoutingDisabledTargetIds: ['target-a'] }
    } as SetState)
    renderIndicator('wt-1')
    const chip = screen.getByTestId('ssh-egress-indicator')
    expect(chip.getAttribute('data-egress')).toBe('local')
    expect(chip.textContent).toContain('This device')
  })

  it('deep-links to the routing setting on click', () => {
    mocks.executionHostId = 'ssh:target-a'
    const openSettingsTarget = vi.fn()
    const openSettingsPage = vi.fn()
    const prior = {
      openSettingsTarget: useAppStore.getState().openSettingsTarget,
      openSettingsPage: useAppStore.getState().openSettingsPage
    }
    useAppStore.setState({ openSettingsTarget, openSettingsPage } as unknown as SetState)
    try {
      renderIndicator('wt-1')
      screen.getByTestId('ssh-egress-indicator').click()
      expect(openSettingsTarget).toHaveBeenCalledWith({
        pane: 'browser',
        repoId: null,
        sectionId: BROWSER_SSH_WORKSPACE_ROUTING_SETTINGS_TARGET_ID
      })
      expect(openSettingsPage).toHaveBeenCalledTimes(1)
    } finally {
      useAppStore.setState(prior as unknown as SetState)
    }
  })
})
