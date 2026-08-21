import { describe, expect, it } from 'vitest'
import { planBrowserWorkspaceTabClose } from './browser-workspace-tab-close-plan'
import { getBrowserWorkspaceRemoteOwnership } from './remote-browser-tab-ownership'

function state(pages: { id: string; environmentId?: string }[]): never {
  return {
    browserPagesByWorkspace: {
      'workspace-a': pages.map((page) => ({ id: page.id, browserRuntimeEnvironmentId: null }))
    },
    remoteBrowserPageHandlesByPageId: Object.fromEntries(
      pages
        .filter((page) => page.environmentId)
        .map((page) => [
          page.id,
          { environmentId: page.environmentId, remotePageId: `remote-${page.id}` }
        ])
    )
  } as never
}

function plan(
  pages: { id: string; environmentId?: string }[],
  options: { focusedEnvironmentId?: string | null; activeEnvironmentIds?: string[] } = {}
): ReturnType<typeof planBrowserWorkspaceTabClose> {
  const active = new Set(options.activeEnvironmentIds ?? [])
  return planBrowserWorkspaceTabClose({
    state: state(pages),
    workspaceId: 'workspace-a',
    focusedEnvironmentId: options.focusedEnvironmentId ?? null,
    isEnvironmentActive: (environmentId) => Boolean(environmentId && active.has(environmentId))
  })
}

describe('planBrowserWorkspaceTabClose', () => {
  it('closes a single owner on its host and leaves the tab for host sync to remove', () => {
    expect(
      plan([{ id: 'page-1', environmentId: 'env-a' }], { activeEnvironmentIds: ['env-a'] })
    ).toEqual({
      hostEnvironmentIds: ['env-a'],
      closesLocally: false,
      removesVisibleTab: false
    })
  })

  // Why: this is the dead end — a workspace spanning two environments used to resolve as
  // "ambiguous" and the close fell through silently, leaving the X inert.
  it('closes every environment holding part of the workspace', () => {
    const result = plan(
      [
        { id: 'page-1', environmentId: 'env-a' },
        { id: 'page-2', environmentId: 'env-b' }
      ],
      { activeEnvironmentIds: ['env-a', 'env-b'] }
    )

    expect([...result.hostEnvironmentIds].sort()).toEqual(['env-a', 'env-b'])
    expect(result.closesLocally).toBe(false)
  })

  it('skips an owner whose session is not connected, and still closes the ones that are', () => {
    const result = plan(
      [
        { id: 'page-1', environmentId: 'env-a' },
        { id: 'page-2', environmentId: 'env-b' }
      ],
      { activeEnvironmentIds: ['env-b'] }
    )

    expect(result.hostEnvironmentIds).toEqual(['env-b'])
    expect(result.closesLocally).toBe(false)
  })

  it('tears down locally when no owning environment is connected', () => {
    expect(
      plan(
        [
          { id: 'page-1', environmentId: 'env-a' },
          { id: 'page-2', environmentId: 'env-b' }
        ],
        { activeEnvironmentIds: [] }
      )
    ).toEqual({ hostEnvironmentIds: [], closesLocally: true, removesVisibleTab: true })
  })

  it('keeps a local-fallback workspace local even while a runtime is focused', () => {
    expect(
      plan([{ id: 'page-1' }], {
        focusedEnvironmentId: 'env-a',
        activeEnvironmentIds: ['env-a']
      })
    ).toEqual({ hostEnvironmentIds: [], closesLocally: true, removesVisibleTab: true })
  })

  it('host-closes a pageless mirror of the focused runtime, which is otherwise un-closable', () => {
    expect(plan([], { focusedEnvironmentId: 'env-a', activeEnvironmentIds: ['env-a'] })).toEqual({
      hostEnvironmentIds: ['env-a'],
      closesLocally: false,
      removesVisibleTab: true
    })
  })

  // Why: a pageless mirror has no page to name an owner with, so the session layer resolves the
  // connected environment — as it did before this plan existed.
  it('still host-closes a pageless mirror whose environment the worktree cannot name', () => {
    expect(
      planBrowserWorkspaceTabClose({
        state: state([]),
        workspaceId: 'workspace-a',
        focusedEnvironmentId: null,
        isEnvironmentActive: () => true
      })
    ).toEqual({ hostEnvironmentIds: [null], closesLocally: false, removesVisibleTab: true })
  })
})

describe('getBrowserWorkspaceRemoteOwnership', () => {
  it('carries the owning environments on an ambiguous workspace', () => {
    const ownership = getBrowserWorkspaceRemoteOwnership(
      state([
        { id: 'page-1', environmentId: 'env-a' },
        { id: 'page-2', environmentId: 'env-b' }
      ]),
      'workspace-a'
    )

    expect(ownership.kind).toBe('ambiguous')
    expect(ownership.kind === 'ambiguous' && [...ownership.environmentIds].sort()).toEqual([
      'env-a',
      'env-b'
    ])
  })

  it('still reports a lone owner exactly and an unowned workspace as none', () => {
    expect(
      getBrowserWorkspaceRemoteOwnership(
        state([{ id: 'page-1', environmentId: 'env-a' }]),
        'workspace-a'
      )
    ).toEqual({ kind: 'exact', environmentId: 'env-a' })
    expect(getBrowserWorkspaceRemoteOwnership(state([{ id: 'page-1' }]), 'workspace-a')).toEqual({
      kind: 'none'
    })
  })
})
