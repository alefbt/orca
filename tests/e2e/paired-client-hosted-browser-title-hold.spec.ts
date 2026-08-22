import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import {
  createRuntimeDesktopPairingOffer,
  launchPairedElectronClient,
  type PairedElectronClient,
  type RuntimeDesktopPairingOffer
} from './helpers/paired-electron-client'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

type Fixture = { close(): Promise<void>; first: string; second: string }

async function startFixture(): Promise<Fixture> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const title = url.pathname === '/two' ? 'Fixture Maps Two' : 'Fixture Maps One'
    response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'text/html' })
    response.end(`<!doctype html><html><head><title>${title}</title></head><body>
      <h1 id="marker">${title}</h1></body></html>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
    first: `${origin}/one`,
    second: `${origin}/two`
  }
}

async function findWorktreeId(page: Page, repoPath: string): Promise<string> {
  await expect
    .poll(
      () =>
        page.evaluate(
          (path) =>
            window.__store
              ?.getState()
              .allWorktrees()
              .find((worktree) => worktree.path === path)?.id ?? null,
          repoPath
        ),
      { timeout: 60_000 }
    )
    .not.toBeNull()
  return (await page.evaluate(
    (path) =>
      window.__store
        ?.getState()
        .allWorktrees()
        .find((worktree) => worktree.path === path)?.id ?? null,
    repoPath
  )) as string
}

async function mirroredPage(
  page: Page,
  worktreeId: string,
  url: string
): Promise<{
  localPageId: string
  placementHostId: string | null
  placementKind: string | null
  title: string
} | null> {
  return page.evaluate(
    ({ url, worktreeId }) => {
      const state = window.__store?.getState()
      for (const workspace of state?.browserTabsByWorktree[worktreeId] ?? []) {
        for (const browserPage of state?.browserPagesByWorkspace[workspace.id] ?? []) {
          if (!browserPage.url.startsWith(url)) {
            continue
          }
          const placement = state?.remoteBrowserPageHandlesByPageId[browserPage.id]?.placement
          return {
            localPageId: browserPage.id,
            placementHostId:
              placement && placement.kind === 'client' ? placement.browserHostClientId : null,
            placementKind: placement?.kind ?? null,
            title: browserPage.title
          }
        }
      }
      return null
    },
    { url, worktreeId }
  )
}

async function run(args: {
  offer: RuntimeDesktopPairingOffer
  repoPath: string
  testInfo: TestInfo
}): Promise<void> {
  const fixture = await startFixture()
  let client: PairedElectronClient | null = null
  try {
    client = await launchPairedElectronClient(args.offer, args.testInfo, 'STA-4150 identity probe')
    const page = client.page
    const worktreeId = await findWorktreeId(page, args.repoPath)
    await page.evaluate(
      ({ environmentId, worktreeId }) =>
        window.__store?.getState().setActiveWorktree(worktreeId, `runtime:${environmentId}`),
      { environmentId: client.environmentId, worktreeId }
    )

    await page.evaluate(async (url) => {
      const state = window.__store?.getState()
      const groupId = state?.activeGroupIdByWorktree[state.activeWorktreeId ?? '']
      state?.setBrowserDefaultUrl(url)
      await state?.openNewBrowserTabInActiveWorkspace(groupId as string)
    }, fixture.first)

    await expect
      .poll(() => mirroredPage(page, worktreeId, fixture.first), { timeout: 60_000 })
      .not.toBeNull()
    const mirrored = await mirroredPage(page, worktreeId, fixture.first)
    expect(mirrored?.placementKind).toBe('client')

    // Why assert the identity and not just the title: the title holds for two different reasons —
    // because this client recognised its own guest, or because no host snapshot happened to land.
    // Only the first is the behaviour under test, and it is the one an id mismatch would break.
    const rendererHostId = await page.evaluate(
      () => window.api.browser.readClientHostId?.() ?? null
    )
    expect(rendererHostId).not.toBeNull()
    expect(rendererHostId).toBe(mirrored?.placementHostId)

    const pageId = mirrored?.localPageId as string
    await page.evaluate(
      ({ pageId, worktreeId }) =>
        window.__store
          ?.getState()
          .focusBrowserTabInWorktree(worktreeId, pageId, { surfacePane: true }),
      { pageId, worktreeId }
    )

    // Drive the guest somewhere the host was never told about, then sample every title the store
    // publishes while the tab is toggled and the worktree is switched away and back.
    await expect
      .poll(
        () =>
          page.evaluate(async (prefix) => {
            for (const candidate of document.querySelectorAll('webview')) {
              const webview = candidate as Electron.WebviewTag
              try {
                if (webview.getURL().startsWith(prefix)) {
                  return true
                }
              } catch {
                // still attaching
              }
            }
            return false
          }, fixture.first),
        { timeout: 60_000, message: 'client-hosted guest never attached' }
      )
      .toBe(true)
    await page.evaluate(
      async ({ prefix, url }) => {
        for (const candidate of document.querySelectorAll('webview')) {
          const webview = candidate as Electron.WebviewTag
          if (webview.getURL().startsWith(prefix)) {
            await webview.loadURL(url)
            return
          }
        }
        throw new Error('no client-hosted guest to navigate')
      },
      { prefix: fixture.first, url: fixture.second }
    )
    await expect
      .poll(async () => (await mirroredPage(page, worktreeId, fixture.second))?.title ?? null, {
        timeout: 60_000,
        message: 'guest never reported the second fixture title'
      })
      .toBe('Fixture Maps Two')

    await page.evaluate((pageId) => {
      const observed: string[] = []
      ;(window as unknown as { __titles: string[] }).__titles = observed
      window.__store?.subscribe((state) => {
        for (const pages of Object.values(state.browserPagesByWorkspace)) {
          for (const browserPage of pages) {
            if (browserPage.id === pageId) {
              observed.push(browserPage.title)
            }
          }
        }
      })
    }, pageId)

    // A host republish is what rebuilds the row, so the sampling window has to contain one: each
    // new browser tab makes the host publish a fresh session-tab snapshot carrying every row.
    for (let round = 0; round < 3; round += 1) {
      await page.evaluate(
        async ({ url }) => {
          const state = window.__store?.getState()
          const groupId = state?.activeGroupIdByWorktree[state.activeWorktreeId ?? '']
          state?.setBrowserDefaultUrl(url)
          await state?.openNewBrowserTabInActiveWorkspace(groupId as string)
        },
        { url: `${fixture.first}?round=${round}` }
      )
      await page.waitForTimeout(3_000)
      await page.evaluate(
        ({ pageId, worktreeId }) => {
          const state = window.__store?.getState()
          state?.setActiveTabType('terminal')
          state?.focusBrowserTabInWorktree(worktreeId, pageId, { surfacePane: true })
        },
        { pageId, worktreeId }
      )
      await page.waitForTimeout(2_000)
    }

    const titles = (await page.evaluate(
      () => (window as unknown as { __titles: string[] }).__titles
    )) as string[]
    // A window with no writes in it would pass the not-toContain on its own.
    expect(titles.length).toBeGreaterThan(0)
    expect(titles).not.toContain('Browser')
    expect((await mirroredPage(page, worktreeId, fixture.second))?.title).toBe('Fixture Maps Two')
  } finally {
    await client?.dispose()
    await fixture.close()
  }
}

test('holds the guest title through host republishes of a client-hosted page', async ({
  orcaPage,
  testRepoPath
}, testInfo) => {
  test.setTimeout(300_000)
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  const offer = await createRuntimeDesktopPairingOffer(orcaPage)
  await run({ offer, repoPath: testRepoPath, testInfo })
})
