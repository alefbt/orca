import { expect, test } from './helpers/orca-app'
import {
  readPanes,
  requireGroup,
  setUpPairedFixture,
  waitForGroupTabCount
} from './helpers/paired-browser-placement-fixture'

type FaultWindow = Window & {
  __webRuntimeBrowserCreationFault?: {
    arm: () => void
    release: () => boolean
    reset: () => void
    snapshot: () => { armed: boolean; createdPageId: string | null }
  }
}

type CreateTimings = {
  appearedAfterMs: number | null
  appearedBeforeSettle: boolean
  settledAfterMs: number | null
  tabIdAtFirstSight: string | null
}

/**
 * Start a paired browser create and watch the strip while it is still in flight.
 *
 * The oracle is ordering, not a stopwatch: the tab has to be in the strip before the create
 * promise settles. That is the whole claim — the click no longer waits on the host round-trip —
 * and it stays true on a slow machine where any absolute millisecond budget would flake.
 */
async function createAndWatch(
  fixture: Awaited<ReturnType<typeof setUpPairedFixture>>,
  groupId: string
): Promise<CreateTimings> {
  return fixture.client.page.evaluate(
    async ({ groupId, url, worktreeId }) => {
      const store = window.__store
      const state = store?.getState()
      if (!store || !state) {
        throw new Error('Paired client store unavailable')
      }
      state.setBrowserDefaultUrl(url)
      const startedAt = performance.now()
      let settledAfterMs: number | null = null
      const create = state
        .openNewBrowserTabInActiveWorkspace(groupId)
        .catch(() => undefined)
        .finally(() => {
          settledAfterMs = performance.now() - startedAt
        })

      const browserTabs = (): { id: string }[] =>
        (store.getState().unifiedTabsByWorktree[worktreeId] ?? []).filter(
          (tab) => tab.contentType === 'browser'
        )
      let appearedAfterMs: number | null = null
      let tabIdAtFirstSight: string | null = null
      while (performance.now() - startedAt < 30_000) {
        const tabs = browserTabs()
        if (tabs.length > 0) {
          appearedAfterMs = performance.now() - startedAt
          tabIdAtFirstSight = tabs[0].id
          break
        }
        if (settledAfterMs !== null) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 2))
      }
      const appearedBeforeSettle = appearedAfterMs !== null && settledAfterMs === null
      await create
      return { appearedAfterMs, appearedBeforeSettle, settledAfterMs, tabIdAtFirstSight }
    },
    { groupId, url: fixture.url, worktreeId: fixture.worktreeId }
  )
}

/** Every distinct browser-tab-id list the store passed through, in order. */
async function recordBrowserTabTransitions(
  fixture: Awaited<ReturnType<typeof setUpPairedFixture>>
): Promise<void> {
  await fixture.client.page.evaluate((worktreeId) => {
    const store = window.__store
    if (!store) {
      throw new Error('Paired client store unavailable')
    }
    const transitions: string[] = []
    const record = (): void => {
      const key = (store.getState().unifiedTabsByWorktree[worktreeId] ?? [])
        .filter((tab) => tab.contentType === 'browser')
        .map((tab) => tab.id)
        .join(',')
      if (transitions.at(-1) !== key) {
        transitions.push(key)
      }
    }
    record()
    ;(window as unknown as { __browserTabTransitions: string[] }).__browserTabTransitions =
      transitions
    store.subscribe(record)
  }, fixture.worktreeId)
}

async function readBrowserTabTransitions(
  fixture: Awaited<ReturnType<typeof setUpPairedFixture>>
): Promise<string[]> {
  return fixture.client.page.evaluate(
    () => (window as unknown as { __browserTabTransitions: string[] }).__browserTabTransitions ?? []
  )
}

test('shows a paired browser tab before its create RPC resolves, then keeps it as one tab', async ({
  testRepoPath
}, testInfo) => {
  test.setTimeout(300_000)
  const fixture = await setUpPairedFixture(testInfo, testRepoPath)
  try {
    const { client, rootGroupId, worktreeId } = fixture
    const before = requireGroup(await readPanes(client.page, worktreeId), rootGroupId)
    await recordBrowserTabTransitions(fixture)

    const timings = await createAndWatch(fixture, rootGroupId)
    testInfo.annotations.push({
      type: 'instant-tab-latency',
      description: `tab visible after ${timings.appearedAfterMs?.toFixed(1)}ms; create settled after ${timings.settledAfterMs?.toFixed(1)}ms`
    })

    expect(timings.appearedAfterMs).not.toBeNull()
    expect(timings.appearedBeforeSettle).toBe(true)
    expect(timings.settledAfterMs).not.toBeNull()
    expect(timings.appearedAfterMs!).toBeLessThan(timings.settledAfterMs!)

    const after = await waitForGroupTabCount(
      client.page,
      worktreeId,
      rootGroupId,
      before.tabOrder.length + 1,
      'paired client lost the optimistic browser tab'
    )
    const group = requireGroup(after, rootGroupId)
    expect(group.tabOrder.slice(0, before.tabOrder.length)).toEqual(before.tabOrder)
    expect(group.tabOrder.at(-1)).toBe(timings.tabIdAtFirstSight)
    expect(group.activeTabId).toBe(timings.tabIdAtFirstSight)

    // Why: the point of adopting in place is that the strip never flickers. Any drop-and-re-add
    // would show up here as an extra transition through '' or through a different id.
    expect(await readBrowserTabTransitions(fixture)).toEqual(['', timings.tabIdAtFirstSight])

    // The host has to own it by now: materialization is what clears the staged handle.
    expect(
      await client.page.evaluate((entityId) => {
        const state = window.__store?.getState()
        const workspaceId =
          (state?.unifiedTabsByWorktree[Object.keys(state.unifiedTabsByWorktree)[0]] ?? []).find(
            (tab) => tab.id === entityId
          )?.entityId ?? ''
        return (state?.browserPagesByWorkspace[workspaceId] ?? []).map(
          (page) => state?.remoteBrowserPageHandlesByPageId[page.id]?.staged ?? false
        )
      }, timings.tabIdAtFirstSight ?? '')
    ).toEqual([false])
  } finally {
    await fixture.dispose()
  }
})

test('keeps three rapid paired browser creates as three ordered tabs', async ({
  testRepoPath
}, testInfo) => {
  test.setTimeout(300_000)
  const fixture = await setUpPairedFixture(testInfo, testRepoPath)
  try {
    const { client, rootGroupId, worktreeId } = fixture
    const before = requireGroup(await readPanes(client.page, worktreeId), rootGroupId)

    // Three clicks with no await between them, the way an impatient user hits "+".
    const stagedImmediately = await client.page.evaluate(
      async ({ groupId, url, worktreeId }) => {
        const store = window.__store
        const state = store?.getState()
        if (!store || !state) {
          throw new Error('Paired client store unavailable')
        }
        state.setBrowserDefaultUrl(url)
        const creates = [1, 2, 3].map(() =>
          state.openNewBrowserTabInActiveWorkspace(groupId).catch(() => undefined)
        )
        const browserTabCount = (): number =>
          (store.getState().unifiedTabsByWorktree[worktreeId] ?? []).filter(
            (tab) => tab.contentType === 'browser'
          ).length
        const startedAt = performance.now()
        while (performance.now() - startedAt < 30_000 && browserTabCount() < 3) {
          await new Promise((resolve) => setTimeout(resolve, 2))
        }
        const staged = browserTabCount()
        await Promise.all(creates)
        return staged
      },
      { groupId: rootGroupId, url: fixture.url, worktreeId }
    )
    expect(stagedImmediately).toBe(3)

    const after = await waitForGroupTabCount(
      client.page,
      worktreeId,
      rootGroupId,
      before.tabOrder.length + 3,
      'paired client did not settle on exactly three browser tabs'
    )
    const group = requireGroup(after, rootGroupId)
    expect(group.tabOrder.slice(0, before.tabOrder.length)).toEqual(before.tabOrder)
    const browserTabIds = group.tabOrder.slice(before.tabOrder.length)
    expect(new Set(browserTabIds).size).toBe(3)
    expect(
      browserTabIds.every(
        (tabId) => after.tabs.find((tab) => tab.id === tabId)?.contentType === 'browser'
      )
    ).toBe(true)

    // Why: cross-rekeying would leave two tabs pointing at one workspace and one orphan.
    expect(
      new Set(
        browserTabIds.map((tabId) => after.tabs.find((tab) => tab.id === tabId)?.entityId ?? '')
      ).size
    ).toBe(3)
  } finally {
    await fixture.dispose()
  }
})

// Why: the optimistic tab is the user's only feedback that the click landed, so a create that
// fails after staging has to take that tab back rather than leave a dead one in the strip.
test('takes back the optimistic tab when the paired create fails to reconcile', async ({
  testRepoPath
}, testInfo) => {
  test.setTimeout(300_000)
  const fixture = await setUpPairedFixture(testInfo, testRepoPath)
  try {
    const { client, rootGroupId, worktreeId } = fixture
    const before = requireGroup(await readPanes(client.page, worktreeId), rootGroupId)

    await client.page.evaluate(() => {
      const fault = (window as FaultWindow).__webRuntimeBrowserCreationFault
      if (!fault) {
        throw new Error('Browser creation E2E fault seam unavailable')
      }
      fault.arm()
    })
    await client.page.evaluate(
      ({ groupId, url }) => {
        const state = window.__store?.getState()
        if (!state) {
          throw new Error('Paired client store unavailable')
        }
        state.setBrowserDefaultUrl(url)
        const create = state.openNewBrowserTabInActiveWorkspace(groupId).catch(() => undefined)
        ;(window as unknown as { __heldBrowserCreate: Promise<void> }).__heldBrowserCreate = create
      },
      { groupId: rootGroupId, url: fixture.url }
    )

    // The staged tab is visible while the create is held at the fault seam.
    const held = await waitForGroupTabCount(
      client.page,
      worktreeId,
      rootGroupId,
      before.tabOrder.length + 1,
      'paired client never staged the optimistic browser tab'
    )
    const stagedTabId = requireGroup(held, rootGroupId).tabOrder.at(-1)
    expect(held.tabs.find((tab) => tab.id === stagedTabId)?.contentType).toBe('browser')

    await expect
      .poll(
        () =>
          client.page.evaluate(
            () => (window as FaultWindow).__webRuntimeBrowserCreationFault?.snapshot() ?? null
          ),
        { timeout: 60_000, message: 'held browser create never reached the fault seam' }
      )
      .toMatchObject({ armed: true, createdPageId: expect.any(String) })

    expect(
      await client.page.evaluate(
        () => (window as FaultWindow).__webRuntimeBrowserCreationFault?.release() ?? false
      )
    ).toBe(true)
    await client.page.evaluate(
      () => (window as unknown as { __heldBrowserCreate: Promise<void> }).__heldBrowserCreate
    )

    const settled = await waitForGroupTabCount(
      client.page,
      worktreeId,
      rootGroupId,
      before.tabOrder.length,
      'failed browser create left its optimistic tab behind'
    )
    expect(requireGroup(settled, rootGroupId).tabOrder).toEqual(before.tabOrder)
    expect(requireGroup(settled, rootGroupId).activeTabId).toBe(before.activeTabId)
    expect(settled.tabs.filter((tab) => tab.contentType === 'browser')).toEqual([])
    // Why: rollback must clear the backing rows too, not just the strip entry.
    expect(
      await client.page.evaluate(
        (id) => (window.__store?.getState().browserTabsByWorktree[id] ?? []).length,
        worktreeId
      )
    ).toBe(0)
    await client.page.evaluate(() =>
      (window as FaultWindow).__webRuntimeBrowserCreationFault?.reset()
    )
  } finally {
    await fixture.dispose()
  }
})
