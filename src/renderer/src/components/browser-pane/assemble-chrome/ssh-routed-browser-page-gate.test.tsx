// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'

const mocks = vi.hoisted(() => ({
  executionHostId: 'local' as string,
  prepare: vi.fn()
}))

vi.mock('@/lib/worktree-runtime-owner', () => ({
  getExecutionHostIdForWorktree: () => mocks.executionHostId
}))

import { SshRoutedBrowserPageGate } from './ssh-routed-browser-page-gate'

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

describe('SshRoutedBrowserPageGate', () => {
  beforeEach(() => {
    mocks.prepare.mockReset()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { browser: { prepareSshWorkspacePartition: mocks.prepare } }
    })
  })
  afterEach(() => cleanup())

  it('renders children with no override for non-SSH workspaces without any prepare call', async () => {
    mocks.executionHostId = 'local'
    render(
      <SshRoutedBrowserPageGate worktreeId="wt-1" sessionProfileId={null}>
        {(partition) => <div data-testid="page">{String(partition)}</div>}
      </SshRoutedBrowserPageGate>
    )
    await settle()
    expect(screen.getByTestId('page').textContent).toBe('null')
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('mounts the page only on the prepared partition for SSH workspaces', async () => {
    mocks.executionHostId = 'ssh:target-a'
    mocks.prepare.mockResolvedValue({ partition: 'persist:orca-browser-v1-routed' })
    render(
      <SshRoutedBrowserPageGate worktreeId="wt-1" sessionProfileId="session-x">
        {(partition) => <div data-testid="page">{String(partition)}</div>}
      </SshRoutedBrowserPageGate>
    )
    // Why: fail closed — no webview may exist before the proxy-verified partition arrives.
    expect(screen.queryByTestId('page')).toBeNull()
    await settle()
    expect(screen.getByTestId('page').textContent).toBe('persist:orca-browser-v1-routed')
    expect(mocks.prepare).toHaveBeenCalledWith({
      targetId: 'target-a',
      browserProfileId: 'session-x'
    })
  })

  it('never renders the page on failure and retries on demand', async () => {
    mocks.executionHostId = 'ssh:target-a'
    mocks.prepare.mockRejectedValueOnce(new Error('browser_tunnel_execution_host_unavailable'))
    mocks.prepare.mockResolvedValueOnce({ partition: 'persist:orca-browser-v1-routed' })
    render(
      <SshRoutedBrowserPageGate worktreeId="wt-1" sessionProfileId={null}>
        {(partition) => <div data-testid="page">{String(partition)}</div>}
      </SshRoutedBrowserPageGate>
    )
    await settle()
    expect(screen.queryByTestId('page')).toBeNull()
    screen.getByRole('button', { name: 'Retry' }).click()
    await settle()
    expect(screen.getByTestId('page').textContent).toBe('persist:orca-browser-v1-routed')
  })

  it('stays unrouted when the setting is off', async () => {
    mocks.executionHostId = 'ssh:target-a'
    const priorSettings = useAppStore.getState().settings
    useAppStore.setState({
      settings: { ...priorSettings, browserSshWorkspaceRoutingEnabled: false }
    } as Parameters<typeof useAppStore.setState>[0])
    try {
      render(
        <SshRoutedBrowserPageGate worktreeId="wt-1" sessionProfileId={null}>
          {(partition) => <div data-testid="page">{String(partition)}</div>}
        </SshRoutedBrowserPageGate>
      )
      await settle()
      expect(screen.getByTestId('page').textContent).toBe('null')
      expect(mocks.prepare).not.toHaveBeenCalled()
    } finally {
      useAppStore.setState({ settings: priorSettings } as Parameters<
        typeof useAppStore.setState
      >[0])
    }
  })

  it('leaves runtime-owned ephemeral SSH targets to the paired machinery', async () => {
    mocks.executionHostId = 'ssh:runtime-ssh-ephemeral-1'
    render(
      <SshRoutedBrowserPageGate worktreeId="wt-1" sessionProfileId={null}>
        {(partition) => <div data-testid="page">{String(partition)}</div>}
      </SshRoutedBrowserPageGate>
    )
    await settle()
    expect(screen.getByTestId('page').textContent).toBe('null')
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
})
