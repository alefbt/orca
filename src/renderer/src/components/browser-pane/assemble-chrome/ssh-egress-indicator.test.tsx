// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { BROWSER_SSH_WORKSPACE_ROUTING_SETTINGS_TARGET_ID } from '@/lib/settings-navigation-types'

const mocks = vi.hoisted(() => ({
  executionHostId: 'local' as string
}))

vi.mock('@/lib/worktree-runtime-owner', () => ({
  getExecutionHostIdForWorktree: () => mocks.executionHostId
}))

import { SshEgressIndicator } from './ssh-egress-indicator'

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

  it('keeps the plain globe for non-SSH workspaces', () => {
    mocks.executionHostId = 'local'
    render(<SshEgressIndicator worktreeId="wt-1" />)
    expect(screen.queryByTestId('ssh-egress-indicator')).toBeNull()
  })

  it('shows the routed icon with the host in its label for SSH workspaces', () => {
    mocks.executionHostId = 'ssh:target-a'
    render(<SshEgressIndicator worktreeId="wt-1" />)
    const icon = screen.getByTestId('ssh-egress-indicator')
    expect(icon.getAttribute('data-egress')).toBe('ssh')
    expect(icon.getAttribute('aria-label')).toContain('openclaw')
  })

  it('shows the this-device icon when the target opted out', () => {
    mocks.executionHostId = 'ssh:target-a'
    useAppStore.setState({
      settings: { ...priorSettings, browserSshWorkspaceRoutingDisabledTargetIds: ['target-a'] }
    } as SetState)
    render(<SshEgressIndicator worktreeId="wt-1" />)
    const icon = screen.getByTestId('ssh-egress-indicator')
    expect(icon.getAttribute('data-egress')).toBe('local')
    expect(icon.getAttribute('aria-label')).toContain('from this device')
  })

  it('expands an explanation on click whose settings link deep-links to the routing setting', () => {
    mocks.executionHostId = 'ssh:target-a'
    const openSettingsTarget = vi.fn()
    const openSettingsPage = vi.fn()
    const prior = {
      openSettingsTarget: useAppStore.getState().openSettingsTarget,
      openSettingsPage: useAppStore.getState().openSettingsPage
    }
    useAppStore.setState({ openSettingsTarget, openSettingsPage } as unknown as SetState)
    try {
      render(<SshEgressIndicator worktreeId="wt-1" />)
      fireEvent.click(screen.getByTestId('ssh-egress-indicator'))
      const link = screen.getByTestId('ssh-egress-indicator-settings')
      fireEvent.click(link)
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
