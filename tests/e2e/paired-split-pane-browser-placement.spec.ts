import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import {
  launchHeadlessPairedRuntimeHost,
  type HeadlessPairedRuntimeHost
} from './helpers/headless-paired-runtime-host'
import {
  launchPairedElectronClient,
  type PairedElectronClient
} from './helpers/paired-electron-client'

type PaneGroup = {
  activeTabId: string | null
  id: string
  tabOrder: string[]
}

type PaneSnapshot = {
  activeGroupId: string | null
  groups: PaneGroup[]
  tabs: { contentType: string; groupId: string; id: string; label: string }[]
}

type PairedFixture = {
  client: PairedElectronClient
  dispose(): Promise<void>
  host: HeadlessPairedRuntimeHost
  rootGroupId: string
  terminalHandles: string[]
  url: string
  worktreeId: string
}

async function startPlacementFixtureServer(): Promise<{
  close(): Promise<void>
  url: string
}> {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8'
    })
    response.end(
      '<!doctype html><html><head><title>placement-marker</title></head><body><h1 id="marker">placement-marker</h1></body></html>'
    )
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return {
    close: () => closeServer(server),
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/placement`
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

async function findPairedWorktreeId(page: Page, repoPath: string): Promise<string> {
  const read = () =>
    page.evaluate(
      (path) =>
        window.__store
          ?.getState()
          .allWorktrees()
          .find((worktree) => worktree.path === path)?.id ?? null,
      repoPath
    )
  await expect
    .poll(read, {
      timeout: 60_000,
      message: 'paired client never received the host worktree'
    })
    .not.toBeNull()
  const worktreeId = await read()
  if (!worktreeId) {
    throw new Error('Paired worktree disappeared after discovery')
  }
  return worktreeId
}

async function readPanes(page: Page, worktreeId: string): Promise<PaneSnapshot> {
  return page.evaluate((id) => {
    const state = window.__store?.getState()
    return {
      activeGroupId: state?.activeGroupIdByWorktree[id] ?? null,
      groups: (state?.groupsByWorktree[id] ?? []).map((group) => ({
        activeTabId: group.activeTabId ?? null,
        id: group.id,
        tabOrder: [...group.tabOrder]
      })),
      tabs: (state?.unifiedTabsByWorktree[id] ?? []).map((tab) => ({
        contentType: tab.contentType,
        groupId: tab.groupId,
        id: tab.id,
        label: tab.label
      }))
    }
  }, worktreeId)
}

function requireGroup(panes: PaneSnapshot, groupId: string): PaneGroup {
  const group = panes.groups.find((candidate) => candidate.id === groupId)
  if (!group) {
    throw new Error(`Group ${groupId} missing from ${JSON.stringify(panes)}`)
  }
  return group
}

function contentTypesOf(panes: PaneSnapshot, groupId: string): string[] {
  return requireGroup(panes, groupId).tabOrder.map(
    (tabId) => panes.tabs.find((tab) => tab.id === tabId)?.contentType ?? 'missing'
  )
}

async function waitForGroupTabCount(
  page: Page,
  worktreeId: string,
  groupId: string,
  count: number,
  message: string
): Promise<PaneSnapshot> {
  try {
    await expect
      .poll(
        async () => {
          const panes = await readPanes(page, worktreeId)
          return panes.groups.find((group) => group.id === groupId)?.tabOrder.length ?? -1
        },
        { timeout: 90_000, message }
      )
      .toBe(count)
  } catch (error) {
    // Why: placement bugs land the tab in the wrong pane, so the whole pane model is the evidence.
    throw new Error(
      `${message} (group ${groupId}); panes=${JSON.stringify(await readPanes(page, worktreeId))}`,
      { cause: error }
    )
  }
  return readPanes(page, worktreeId)
}

/** Rename a host terminal and wait for the client to apply the resulting snapshot. */
async function pushHostSnapshot(
  fixture: PairedFixture,
  terminalHandle: string,
  title: string
): Promise<void> {
  await fixture.host.client.call('terminal.rename', {
    terminal: terminalHandle,
    title
  })
  await expect
    .poll(
      async () => {
        const panes = await readPanes(fixture.client.page, fixture.worktreeId)
        return panes.tabs.some((tab) => tab.label.includes(title))
      },
      {
        timeout: 90_000,
        message: `client never applied the snapshot renaming to "${title}"`
      }
    )
    .toBe(true)
}

async function openRemoteBrowserTab(page: Page, url: string, groupId: string): Promise<void> {
  await page.evaluate(
    async ({ groupId, url }) => {
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('Paired client store unavailable')
      }
      state.setBrowserDefaultUrl(url)
      await state.openNewBrowserTabInActiveWorkspace(groupId)
    },
    { groupId, url }
  )
}

async function setUpPairedFixture(testInfo: TestInfo, repoPath: string): Promise<PairedFixture> {
  const fixtureServer = await startPlacementFixtureServer()
  let host: HeadlessPairedRuntimeHost | null = null
  let client: PairedElectronClient | null = null
  try {
    host = await launchHeadlessPairedRuntimeHost()
    await host.client.call('repo.add', { path: repoPath, kind: 'git' })
    const terminalHandles: string[] = []
    for (const title of ['Placement Alpha', 'Placement Beta']) {
      const created = await host.client.call<{ terminal: { handle: string } }>('terminal.create', {
        worktree: `path:${repoPath}`,
        title
      })
      terminalHandles.push(created.result.terminal.handle)
    }
    client = await launchPairedElectronClient(host.offer, testInfo, 'STA-4150 split-pane placement')
    const worktreeId = await findPairedWorktreeId(client.page, repoPath)
    await client.page.evaluate(
      ({ environmentId, worktreeId }) => {
        window.__store?.getState().setActiveWorktree(worktreeId, `runtime:${environmentId}`)
      },
      { environmentId: client.environmentId, worktreeId }
    )
    // Why: placement only becomes client-owned once the client holds groups, so wait for adoption.
    await expect
      .poll(
        async () => {
          const panes = await readPanes(client!.page, worktreeId)
          const group = panes.groups[0]
          if (!group) {
            return 0
          }
          return group.tabOrder.filter(
            (tabId) => panes.tabs.find((tab) => tab.id === tabId)?.contentType === 'terminal'
          ).length
        },
        {
          timeout: 120_000,
          message: 'paired client never materialized both host terminals'
        }
      )
      .toBeGreaterThanOrEqual(2)
    const panes = await readPanes(client.page, worktreeId)
    const rootGroupId = panes.groups[0]?.id
    if (!rootGroupId) {
      throw new Error('Paired worktree has no tab group after adoption')
    }
    const resolvedHost = host
    const resolvedClient = client
    return {
      client: resolvedClient,
      dispose: async () => {
        await resolvedClient.dispose()
        await resolvedHost.dispose()
        await fixtureServer.close()
      },
      host: resolvedHost,
      rootGroupId,
      terminalHandles,
      url: fixtureServer.url,
      worktreeId
    }
  } catch (error) {
    await client?.dispose()
    await host?.dispose()
    await fixtureServer.close()
    throw error
  }
}

test('appends a paired browser tab last in its pane and keeps it there across host snapshots', async ({
  testRepoPath
}, testInfo) => {
  test.setTimeout(300_000)
  const fixture = await setUpPairedFixture(testInfo, testRepoPath)
  try {
    const { client, rootGroupId, worktreeId } = fixture
    const before = await readPanes(client.page, worktreeId)
    const terminalOrder = requireGroup(before, rootGroupId).tabOrder
    expect(contentTypesOf(before, rootGroupId).every((kind) => kind === 'terminal')).toBe(true)

    await openRemoteBrowserTab(client.page, fixture.url, rootGroupId)
    const after = await waitForGroupTabCount(
      client.page,
      worktreeId,
      rootGroupId,
      terminalOrder.length + 1,
      'paired client never materialized the remote browser tab in the root group'
    )
    const placed = requireGroup(after, rootGroupId).tabOrder
    expect(placed.slice(0, terminalOrder.length)).toEqual(terminalOrder)
    expect(contentTypesOf(after, rootGroupId).at(-1)).toBe('browser')

    // Why: the shipped bug only appeared once ambient host snapshots re-reconciled the group.
    for (const title of ['Placement Alpha rev1', 'Placement Alpha rev2']) {
      await pushHostSnapshot(fixture, fixture.terminalHandles[0], title)
      const settled = await readPanes(client.page, worktreeId)
      expect(requireGroup(settled, rootGroupId).tabOrder).toEqual(placed)
      expect(contentTypesOf(settled, rootGroupId).at(-1)).toBe('browser')
    }
  } finally {
    await fixture.dispose()
  }
})

test('creates paired split-pane tabs in the focused pane without disturbing the other pane', async ({
  testRepoPath
}, testInfo) => {
  test.setTimeout(300_000)
  const fixture = await setUpPairedFixture(testInfo, testRepoPath)
  try {
    const { client, rootGroupId, worktreeId } = fixture
    const leftBefore = requireGroup(await readPanes(client.page, worktreeId), rootGroupId)

    const rightGroupId = await client.page.evaluate(
      ({ sourceGroupId, worktreeId }) => {
        const state = window.__store?.getState()
        if (!state) {
          throw new Error('Paired client store unavailable')
        }
        const groupId = state.createEmptySplitGroup(worktreeId, sourceGroupId, 'right')
        if (!groupId) {
          throw new Error('Right split group unavailable')
        }
        state.focusGroup(worktreeId, groupId)
        return groupId
      },
      { sourceGroupId: rootGroupId, worktreeId }
    )

    // Scenario B: a browser created from the right pane must land there and leave the left alone.
    await openRemoteBrowserTab(client.page, fixture.url, rightGroupId)
    const withBrowser = await waitForGroupTabCount(
      client.page,
      worktreeId,
      rightGroupId,
      1,
      'paired client never materialized the remote browser tab in the right pane'
    )
    const browserTabId = requireGroup(withBrowser, rightGroupId).tabOrder[0]
    expect(withBrowser.tabs.find((tab) => tab.id === browserTabId)?.contentType).toBe('browser')
    expect(withBrowser.tabs.find((tab) => tab.id === browserTabId)?.groupId).toBe(rightGroupId)
    expect(requireGroup(withBrowser, rootGroupId).tabOrder).toEqual(leftBefore.tabOrder)
    expect(requireGroup(withBrowser, rootGroupId).activeTabId).toBe(leftBefore.activeTabId)
    expect(withBrowser.activeGroupId).toBe(rightGroupId)

    // Scenario D: ambient host snapshots must not steal focus back from the left pane.
    const leftTerminalId = leftBefore.tabOrder[0]
    await client.page.evaluate(
      ({ groupId, tabId, worktreeId }) => {
        const state = window.__store?.getState()
        state?.focusGroup(worktreeId, groupId)
        state?.activateTab(tabId, { worktreeId })
      },
      { groupId: rootGroupId, tabId: leftTerminalId, worktreeId }
    )
    await expect
      .poll(async () => (await readPanes(client.page, worktreeId)).activeGroupId, {
        timeout: 30_000,
        message: 'left pane never took focus'
      })
      .toBe(rootGroupId)
    const focused = await readPanes(client.page, worktreeId)
    expect(requireGroup(focused, rootGroupId).activeTabId).toBe(leftTerminalId)

    await pushHostSnapshot(fixture, fixture.terminalHandles[1], 'Placement Beta rev1')
    await pushHostSnapshot(fixture, fixture.terminalHandles[1], 'Placement Beta rev2')
    const settled = await readPanes(client.page, worktreeId)
    expect(settled.activeGroupId).toBe(rootGroupId)
    expect(requireGroup(settled, rootGroupId).activeTabId).toBe(leftTerminalId)
    expect(requireGroup(settled, rootGroupId).tabOrder).toEqual(leftBefore.tabOrder)
    expect(requireGroup(settled, rightGroupId).activeTabId).toBe(browserTabId)
    expect(requireGroup(settled, rightGroupId).tabOrder).toEqual([browserTabId])
  } finally {
    await fixture.dispose()
  }
})

// Why: known gap — paired terminal creates record no client placement (only browsers pass
// clientTargetGroupId), so targetGroupId reaches only the host, which does not know a
// client-minted split group. The tab is adopted into the mirrored root group and the focus
// intent drags the active group with it. Flip this to a plain test once terminals record a
// client placement like `openNewBrowserTabInActiveWorkspace` does.
test.fail(
  'places a paired split-pane terminal in the pane that asked for it',
  async ({ testRepoPath }, testInfo) => {
    test.setTimeout(300_000)
    const fixture = await setUpPairedFixture(testInfo, testRepoPath)
    try {
      const { client, rootGroupId, worktreeId } = fixture
      const rightGroupId = await client.page.evaluate(
        ({ sourceGroupId, worktreeId }) => {
          const state = window.__store?.getState()
          const groupId = state?.createEmptySplitGroup(worktreeId, sourceGroupId, 'right')
          if (!groupId) {
            throw new Error('Right split group unavailable')
          }
          state?.focusGroup(worktreeId, groupId)
          return groupId
        },
        { sourceGroupId: rootGroupId, worktreeId }
      )
      await openRemoteBrowserTab(client.page, fixture.url, rightGroupId)
      await waitForGroupTabCount(
        client.page,
        worktreeId,
        rightGroupId,
        1,
        'paired client never materialized the remote browser tab in the right pane'
      )

      const terminalsBefore = new Set(
        (await readPanes(client.page, worktreeId)).tabs
          .filter((tab) => tab.contentType === 'terminal')
          .map((tab) => tab.id)
      )
      // Why: this is what the tab strip's "+" → Terminal item calls for that panel's group.
      await client.page.evaluate(async (groupId) => {
        await window.__store?.getState().openNewTerminalTabInActiveWorkspace(groupId)
      }, rightGroupId)
      const findCreatedTerminal = async () =>
        (await readPanes(client.page, worktreeId)).tabs.find(
          (tab) => tab.contentType === 'terminal' && !terminalsBefore.has(tab.id)
        ) ?? null
      await expect
        .poll(findCreatedTerminal, {
          timeout: 90_000,
          message: 'paired client never materialized the new terminal'
        })
        .not.toBeNull()

      const panes = await readPanes(client.page, worktreeId)
      expect((await findCreatedTerminal())?.groupId).toBe(rightGroupId)
      expect(contentTypesOf(panes, rightGroupId)).toEqual(['browser', 'terminal'])
      expect(panes.activeGroupId).toBe(rightGroupId)
    } finally {
      await fixture.dispose()
    }
  }
)
