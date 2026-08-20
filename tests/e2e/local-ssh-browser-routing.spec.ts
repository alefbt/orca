import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  cleanupDockerSshRelayTarget,
  startDockerSshRelayTarget,
  type DockerSshRelayTarget
} from './helpers/docker-ssh-relay-target'
import { connectDockerSshRelayTarget } from './helpers/docker-ssh-relay-connection'
import {
  killSshRelayTargetTransport,
  readSshRemoteOnlyRequests,
  startSshRemoteOnlyBrowserFixture,
  SSH_REMOTE_ONLY_COOKIE_NAME,
  SSH_REMOTE_ONLY_COOKIE_VALUE,
  SSH_REMOTE_ONLY_ORIGIN
} from './helpers/ssh-remote-only-browser-fixture'
import {
  installBrowserPaneMountCensus,
  readBrowserPaneMountCensus,
  type BrowserPaneMountCensusEntry
} from './helpers/browser-pane-mount-census'

/**
 * Browser pages in a workspace whose execution host is the app's OWN directly-connected SSH
 * target — no paired runtime anywhere — must egress through that SSH connection.
 *
 * The oracle is causal, not bookkeeping: the origin lives on `remote-only.internal:18080` inside
 * the container, bound to the container's loopback and absent from the desktop's resolver. A
 * rendered marker is therefore only reachable if the TCP connection was opened inside the
 * container by the app's own ssh2 `forwardOut`. The opt-out case at the end is the negative
 * control for exactly that claim: same URL, routing off, and the origin never sees a request.
 *
 * The mount census is the fail-closed half. Reading the partition after the fact cannot see a
 * webview that existed for one frame on the wrong session, so a MutationObserver installed before
 * the first tab records every `<webview>` the pane ever attached along with the partition it was
 * born with — Electron partitions are immutable after creation, so the birth attribute is the
 * whole story.
 */
const COOKIE_PAIR = `${SSH_REMOTE_ONLY_COOKIE_NAME}=${SSH_REMOTE_ONLY_COOKIE_VALUE}`
const LOGIN_URL = `${SSH_REMOTE_ONLY_ORIGIN}/login`
const ECHO_URL = `${SSH_REMOTE_ONLY_ORIGIN}/echo/session`
const OPT_OUT_URL = `${SSH_REMOTE_ONLY_ORIGIN}/echo/opt-out`
const ROUTE_PARTITION_RE = /^persist:orca-browser-v1-[a-f0-9]{64}$/

type SshState = {
  status: string | null
  connectionGeneration: number | null
  providerEpoch: string | null
}

type CreatedBrowserTab = { id: string; pageId: string | null }

type WebviewProbe = { partition: string | null; url: string | null; marker: string | null }

type ReloadOutcome = {
  outcome: 'loaded' | 'failed' | 'timeout' | 'no-webview' | 'threw' | 'unattempted'
  errorCode?: number
  errorDescription?: string
}

test.skip(
  process.env.ORCA_E2E_LOCAL_SSH_BROWSER !== '1',
  'Run with ORCA_E2E_LOCAL_SSH_BROWSER=1 (requires Docker)'
)

async function readSshState(page: Page, targetId: string): Promise<SshState> {
  return page.evaluate(async (targetId) => {
    const state = await window.api.ssh.getState({ targetId })
    return {
      status: state?.status ?? null,
      connectionGeneration: state?.connectionGeneration ?? null,
      providerEpoch: state?.providerEpoch ?? null
    }
  }, targetId)
}

/**
 * `ssh:connect` short-circuits for a still-live session, so an advancing generation here is proof
 * the `kill -9` actually landed rather than an artifact of asking for a reconnect.
 */
async function reconnectSshTarget(page: Page, targetId: string): Promise<SshState> {
  await expect
    .poll(
      () =>
        page.evaluate(async (targetId) => {
          try {
            const state = await window.api.ssh.connect({ targetId })
            if (state) {
              window.__store?.getState().setSshConnectionState(targetId, state)
            }
            return state?.status ?? null
          } catch {
            return null
          }
        }, targetId),
      {
        timeout: 180_000,
        intervals: [500, 1_000, 2_000],
        message: 'the SSH target never reconnected after the transport kill'
      }
    )
    .toBe('connected')
  return readSshState(page, targetId)
}

async function createBrowserTab(
  page: Page,
  worktreeId: string,
  url: string,
  title: string
): Promise<CreatedBrowserTab> {
  const created = await page.evaluate(
    ({ worktreeId, url, title }) => {
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('Store unavailable')
      }
      const tab = state.createBrowserTab(worktreeId, url, { title, activate: true })
      return { id: tab.id, pageId: tab.activePageId ?? null }
    },
    { worktreeId, url, title }
  )
  await expect
    .poll(
      () =>
        page.evaluate(
          (tabId) =>
            (
              window.__store?.getState().browserTabsByWorktree[
                window.__store.getState().activeWorktreeId ?? ''
              ] ?? []
            ).some((tab) => tab.id === tabId),
          created.id
        ),
      { timeout: 30_000, message: `browser tab ${title} never landed in the store` }
    )
    .toBe(true)
  return created
}

async function probeTabWebview(page: Page, tabId: string): Promise<WebviewProbe | null> {
  return page.evaluate(async (tabId) => {
    const slot = document.querySelector(`[data-browser-overlay-tab-id="${tabId}"]`)
    const webview = slot?.querySelector('webview') as Electron.WebviewTag | null
    if (!webview) {
      return null
    }
    let url: string | null = null
    try {
      url = webview.getURL()
    } catch {
      url = null
    }
    let marker: string | null = null
    try {
      marker = (await webview.executeJavaScript(
        'document.querySelector("#marker")?.textContent ?? null'
      )) as string | null
    } catch {
      marker = null
    }
    return { partition: webview.getAttribute('partition'), url, marker }
  }, tabId)
}

/** Reloads one tab's guest and reports the main-frame outcome the guest itself emitted. */
async function reloadTab(page: Page, tabId: string, timeoutMs: number): Promise<ReloadOutcome> {
  return page.evaluate(
    ({ tabId, timeoutMs }) => {
      const slot = document.querySelector(`[data-browser-overlay-tab-id="${tabId}"]`)
      const webview = slot?.querySelector('webview') as Electron.WebviewTag | null
      if (!webview) {
        return Promise.resolve({ outcome: 'no-webview' as const })
      }
      return new Promise<ReloadOutcome>((resolve) => {
        let settled = false
        const cleanup = (): void => {
          window.clearTimeout(timer)
          webview.removeEventListener('did-fail-load', onFail)
          webview.removeEventListener('did-finish-load', onFinish)
        }
        const finish = (value: ReloadOutcome): void => {
          if (settled) {
            return
          }
          settled = true
          cleanup()
          resolve(value)
        }
        const onFail = (event: Event): void => {
          const failure = event as Event & {
            errorCode: number
            errorDescription: string
            isMainFrame?: boolean
          }
          // ERR_ABORTED is what a superseded navigation reports; it is not a load failure.
          if (failure.isMainFrame === false || failure.errorCode === -3) {
            return
          }
          finish({
            outcome: 'failed',
            errorCode: failure.errorCode,
            errorDescription: failure.errorDescription
          })
        }
        const onFinish = (): void => finish({ outcome: 'loaded' })
        const timer = window.setTimeout(() => finish({ outcome: 'timeout' }), timeoutMs)
        webview.addEventListener('did-fail-load', onFail)
        webview.addEventListener('did-finish-load', onFinish)
        try {
          webview.reload()
        } catch (error) {
          finish({ outcome: 'threw', errorDescription: String(error) })
        }
      })
    },
    { tabId, timeoutMs }
  ) as Promise<ReloadOutcome>
}

async function readPageLoadError(
  page: Page,
  tabId: string
): Promise<{ code: string | number | null; description: string | null } | null> {
  return page.evaluate((tabId) => {
    const pages = window.__store?.getState().browserPagesByWorkspace[tabId] ?? []
    const failure = pages.find((candidate) => candidate.loadError)?.loadError
    if (!failure) {
      return null
    }
    return { code: failure.code ?? null, description: failure.description ?? null }
  }, tabId)
}

/** Waits until the guest for one tab has painted the fixture's marker element. */
async function waitForTabMarker(page: Page, tabId: string, message: string): Promise<string> {
  await expect
    .poll(async () => (await probeTabWebview(page, tabId))?.marker ?? null, {
      timeout: 120_000,
      intervals: [250, 500, 1_000],
      message
    })
    .not.toBeNull()
  const marker = (await probeTabWebview(page, tabId))?.marker
  if (!marker) {
    throw new Error(`Guest for ${tabId} lost its marker`)
  }
  return marker
}

function censusFor(
  census: readonly BrowserPaneMountCensusEntry[],
  tabId: string
): BrowserPaneMountCensusEntry[] {
  return census.filter((entry) => entry.overlayTabId === tabId)
}

test('routes SSH-workspace browsing through the SSH host, fail-closed across a real drop', async ({
  orcaPage
}, testInfo) => {
  test.setTimeout(900_000)
  let target: DockerSshRelayTarget | null = null
  try {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)

    target = startDockerSshRelayTarget(testInfo)
    startSshRemoteOnlyBrowserFixture(target)
    const remote = await connectDockerSshRelayTarget(orcaPage, target)
    const worktreeId = remote.worktreeId

    expect(
      await orcaPage.evaluate(
        ({ repoId, worktreeId }) =>
          (window.__store?.getState().worktreesByRepo[repoId] ?? []).find(
            (worktree) => worktree.id === worktreeId
          )?.hostId ?? null,
        { repoId: remote.repoId, worktreeId }
      ),
      'the workspace must execute on the directly-connected SSH target'
    ).toBe(`ssh:${remote.targetId}`)
    expect(
      await orcaPage.evaluate(
        (repoId) =>
          window.__store?.getState().repos.find((repo) => repo.id === repoId)?.connectionId ?? null,
        remote.repoId
      ),
      'no paired runtime may be involved: the repo is owned by the SSH connection itself'
    ).toBe(remote.targetId)

    // Installed before the first tab: a webview that mounts on the wrong session and is replaced
    // milliseconds later is invisible to any after-the-fact DOM read.
    await installBrowserPaneMountCensus(orcaPage)

    // (1) Remote-only origin renders -- the causal egress oracle.
    const loginTab = await createBrowserTab(orcaPage, worktreeId, LOGIN_URL, 'SSH login')
    const loginMarker = await waitForTabMarker(
      orcaPage,
      loginTab.id,
      'the SSH-routed guest never rendered the container-only origin'
    )
    expect(loginMarker, 'the remote-only origin must have served the page itself').toBe(
      'login-marker'
    )

    // (2) Partition shape + the gate's fail-closed mount order.
    const loginProbe = await probeTabWebview(orcaPage, loginTab.id)
    expect(
      loginProbe?.partition,
      'SSH-workspace pages must mount on a derived route partition'
    ).toMatch(ROUTE_PARTITION_RE)

    const routedCensus = await readBrowserPaneMountCensus(orcaPage)
    await testInfo.attach('mount-census-routed', {
      body: JSON.stringify(routedCensus, null, 2),
      contentType: 'application/json'
    })
    const loginCensus = censusFor(routedCensus, loginTab.id)
    expect(
      loginCensus[0]?.kind,
      'the pane must show the SSH-routing gate before anything mounts'
    ).toBe('gate-preparing')
    expect(
      loginCensus.filter((entry) => entry.kind === 'webview').length,
      'the SSH-routed pane never attached a guest at all'
    ).toBeGreaterThan(0)
    for (const entry of loginCensus) {
      if (entry.kind === 'webview') {
        expect(
          entry.partition,
          'the pane must never attach an unrouted guest, not even transiently'
        ).toMatch(ROUTE_PARTITION_RE)
      }
    }

    // (3) Container-side confirmation: the origin logged the request the desktop could not make.
    const loginRequests = readSshRemoteOnlyRequests(target)
    expect(
      loginRequests.map((entry) => entry.path),
      'the container-side origin never recorded the routed request'
    ).toContain('/login')
    expect(
      loginRequests.find((entry) => entry.path === '/login')?.cookie ?? null,
      'the first request must arrive without the planted cookie'
    ).toBeNull()

    // A second tab on the same partition proves the cookie jar is shared before the drop.
    const echoTab = await createBrowserTab(orcaPage, worktreeId, ECHO_URL, 'SSH echo')
    const echoMarker = await waitForTabMarker(
      orcaPage,
      echoTab.id,
      'the second SSH-routed guest never rendered the container-only origin'
    )
    expect(echoMarker, 'the pre-drop request must carry the planted cookie').toContain(COOKIE_PAIR)
    expect(
      (await probeTabWebview(orcaPage, echoTab.id))?.partition,
      'both SSH-workspace tabs must share one route partition'
    ).toBe(loginProbe?.partition)

    const beforeDrop = await readSshState(orcaPage, remote.targetId)
    expect(beforeDrop.status).toBe('connected')
    expect(beforeDrop.connectionGeneration).not.toBeNull()
    const requestsBeforeDrop = readSshRemoteOnlyRequests(target).length

    // (4) Drop the real transport. A reload must FAIL rather than silently succeed locally.
    expect(
      killSshRelayTargetTransport(target),
      'the container had no established SSH session to kill'
    ).toBeGreaterThan(0)

    let dropOutcome: ReloadOutcome = { outcome: 'unattempted' }
    await expect
      .poll(
        async () => {
          dropOutcome = await reloadTab(orcaPage, echoTab.id, 30_000)
          return dropOutcome.outcome
        },
        {
          timeout: 180_000,
          intervals: [1_000, 2_000],
          message: 'a reload survived the SSH drop, so the page was not egressing through SSH'
        }
      )
      .toBe('failed')
    await testInfo.attach('reload-outcome-after-drop', {
      body: JSON.stringify(dropOutcome),
      contentType: 'application/json'
    })
    expect(
      await readPageLoadError(orcaPage, echoTab.id),
      'the fenced page must surface a load failure in the product state'
    ).not.toBeNull()
    expect(
      (await probeTabWebview(orcaPage, echoTab.id))?.marker ?? null,
      'the fenced page must not still be showing remote content'
    ).toBeNull()
    expect(
      readSshRemoteOnlyRequests(target).length,
      'nothing reached the container-only origin while the SSH transport was dead'
    ).toBe(requestsBeforeDrop)

    // Reconnect: same SOCKS port, new SSH generation, same tab.
    const afterDrop = await reconnectSshTarget(orcaPage, remote.targetId)
    expect(
      afterDrop.connectionGeneration,
      'a reconnect must mint a new SSH connection generation'
    ).toBeGreaterThan(beforeDrop.connectionGeneration!)

    let recoveryOutcome: ReloadOutcome = { outcome: 'unattempted' }
    await expect
      .poll(
        async () => {
          recoveryOutcome = await reloadTab(orcaPage, echoTab.id, 30_000)
          return recoveryOutcome.outcome
        },
        {
          timeout: 180_000,
          intervals: [1_000, 2_000],
          message: 'the same tab never recovered its SSH-routed egress after the reconnect'
        }
      )
      .toBe('loaded')
    const recoveredMarker = await waitForTabMarker(
      orcaPage,
      echoTab.id,
      'the reconnected guest never re-rendered the container-only origin'
    )
    expect(
      recoveredMarker,
      'the post-reconnect request must still carry the cookie planted before the drop'
    ).toContain(COOKIE_PAIR)
    expect(
      (await probeTabWebview(orcaPage, echoTab.id))?.partition,
      'a reconnect must not mint a fresh partition'
    ).toBe(loginProbe?.partition)

    const requestsAfterRecovery = readSshRemoteOnlyRequests(target)
    const postDropRequests = requestsAfterRecovery.slice(requestsBeforeDrop)
    await testInfo.attach('remote-only-requests-after-recovery', {
      body: JSON.stringify(postDropRequests, null, 2),
      contentType: 'application/json'
    })
    expect(
      postDropRequests.map((entry) => entry.path),
      'the container-only origin must have served the reload that followed the reconnect'
    ).toContain('/echo/session')
    expect(
      postDropRequests.findLast((entry) => entry.path === '/echo/session')?.cookie ?? null,
      'the surviving partition must have replayed the pre-drop cookie after the reconnect'
    ).toContain(COOKIE_PAIR)

    // (5) Opt-out: a new tab must mount unrouted -- and then it cannot reach the origin at all,
    // which is the negative control for every rendered marker above.
    const requestsBeforeOptOut = readSshRemoteOnlyRequests(target).length
    await orcaPage.evaluate(async () => {
      await window.__store?.getState().updateSettings({ browserSshWorkspaceRoutingEnabled: false })
    })
    await expect
      .poll(
        () =>
          orcaPage.evaluate(
            () => window.__store?.getState().settings?.browserSshWorkspaceRoutingEnabled ?? null
          ),
        { timeout: 30_000, message: 'the routing opt-out never reached the renderer store' }
      )
      .toBe(false)

    const optOutTab = await createBrowserTab(orcaPage, worktreeId, OPT_OUT_URL, 'SSH opt-out')
    await expect
      .poll(async () => (await probeTabWebview(orcaPage, optOutTab.id))?.partition ?? null, {
        timeout: 60_000,
        message: 'the opt-out tab never attached a guest'
      })
      .not.toBeNull()
    const optOutPartition = (await probeTabWebview(orcaPage, optOutTab.id))?.partition
    expect(
      optOutPartition,
      'with routing disabled a new tab must not mount on a route partition'
    ).not.toMatch(ROUTE_PARTITION_RE)

    const optOutCensus = censusFor(await readBrowserPaneMountCensus(orcaPage), optOutTab.id)
    expect(
      optOutCensus.some((entry) => entry.kind === 'gate-preparing'),
      'the opt-out pane must skip the SSH-routing gate entirely'
    ).toBe(false)
    await expect
      .poll(async () => (await reloadTab(orcaPage, optOutTab.id, 30_000)).outcome, {
        timeout: 120_000,
        intervals: [1_000, 2_000],
        message: 'an unrouted guest reached the container-only origin, so the oracle is not causal'
      })
      .toBe('failed')
    expect(
      readSshRemoteOnlyRequests(target).length,
      'the container-only origin must be unreachable without the SSH route'
    ).toBe(requestsBeforeOptOut)
  } finally {
    cleanupDockerSshRelayTarget(target)
  }
})
