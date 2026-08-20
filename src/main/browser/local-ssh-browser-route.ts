import type { Duplex } from 'node:stream'
import type { BrowserNetworkExecutionRouteResolver } from './browser-network-execution-route'
import type { BrowserNetworkTunnelOpen } from '../../shared/browser-network-tunnel-protocol'
import { openExecutionRouteSocketAsDuplex } from './execution-route-socket-duplex'
import { RemoteBrowserSocksServer } from './remote-browser-socks-server'

export type LocalSshBrowserRouteDependencies = {
  resolveExecutionRoute: BrowserNetworkExecutionRouteResolver
  getAuthority: (targetId: string) => { providerEpoch: string; connectionGeneration: number }
}

/**
 * Loopback SOCKS listener for a directly-connected SSH target, dialing through
 * the in-process SSH execution route — no pairing, no tunnel.
 *
 * The listener's port must stay stable for the lifetime of every partition
 * proxied at it, so the server outlives SSH reconnects: each dial lazily
 * re-resolves the execution route under the target's *current* authority, and
 * a dial while the target is disconnected or mid-rotation fails the SOCKS
 * request instead of ever falling back to a direct local connection.
 */
export class LocalSshBrowserRoute {
  private readonly socks: RemoteBrowserSocksServer
  private executionRoute: Awaited<ReturnType<BrowserNetworkExecutionRouteResolver>> | null = null
  private routePromise: Promise<Awaited<ReturnType<BrowserNetworkExecutionRouteResolver>>> | null =
    null
  private listenPromise: Promise<{ host: string; port: number }> | null = null
  private closed = false

  constructor(
    private readonly targetId: string,
    private readonly dependencies: LocalSshBrowserRouteDependencies
  ) {
    this.socks = new RemoteBrowserSocksServer({
      open: (target) => this.openTarget(target)
    })
  }

  listen(): Promise<{ host: string; port: number }> {
    if (this.closed) {
      return Promise.reject(new Error('browser_local_route_closed'))
    }
    this.listenPromise ??= this.socks.listen()
    return this.listenPromise
  }

  async close(): Promise<void> {
    if (this.closed) {
      return
    }
    this.closed = true
    const route = this.executionRoute
    this.executionRoute = null
    await Promise.all([this.socks.close(), route ? route.close() : Promise.resolve()])
  }

  private async openTarget(target: BrowserNetworkTunnelOpen): Promise<Duplex> {
    const route = await this.requireExecutionRoute()
    return openExecutionRouteSocketAsDuplex(route.connect(target))
  }

  private async requireExecutionRoute(): Promise<
    Awaited<ReturnType<BrowserNetworkExecutionRouteResolver>>
  > {
    if (this.closed) {
      throw new Error('browser_local_route_closed')
    }
    const current = this.executionRoute
    if (current?.isValid()) {
      return current
    }
    this.routePromise ??= this.resolveFreshRoute().finally(() => {
      this.routePromise = null
    })
    return this.routePromise
  }

  private async resolveFreshRoute(): Promise<
    Awaited<ReturnType<BrowserNetworkExecutionRouteResolver>>
  > {
    const stale = this.executionRoute
    this.executionRoute = null
    if (stale) {
      void Promise.resolve(stale.close()).catch(() => {})
    }
    const authority = this.dependencies.getAuthority(this.targetId)
    const route = await this.dependencies.resolveExecutionRoute({
      executionHost: {
        kind: 'ssh',
        targetId: this.targetId,
        providerEpoch: authority.providerEpoch,
        connectionGeneration: authority.connectionGeneration
      },
      // Why: only the native/wsl resolvers read these; the ssh resolver fences
      // on the authority embedded in the execution host instead.
      runtimeId: 'local-ssh-browser-route',
      runtimeRevision: 0
    })
    if (this.closed) {
      void Promise.resolve(route.close()).catch(() => {})
      throw new Error('browser_local_route_closed')
    }
    this.executionRoute = route
    // Why: rotation aborts the route; dropping it here makes the next dial re-resolve.
    void route.whenInvalidated?.then(() => {
      if (this.executionRoute === route) {
        this.executionRoute = null
      }
      void Promise.resolve(route.close()).catch(() => {})
    })
    return route
  }
}

const routesByTargetId = new Map<string, LocalSshBrowserRoute>()

async function defaultDependencies(): Promise<LocalSshBrowserRouteDependencies> {
  const [{ resolveBrowserNetworkExecutionRoute }, authority] = await Promise.all([
    import('./browser-network-execution-route-dispatch'),
    import('../ssh/ssh-provider-authority')
  ])
  return {
    resolveExecutionRoute: resolveBrowserNetworkExecutionRoute,
    getAuthority: (targetId) => authority.getSshProviderAuthority(targetId)
  }
}

/** One listener per SSH target for the app session; the port never moves under its partitions. */
export async function retainLocalSshBrowserRoute(
  targetId: string,
  dependencies?: LocalSshBrowserRouteDependencies
): Promise<{ host: '127.0.0.1'; port: number }> {
  let route = routesByTargetId.get(targetId)
  if (!route) {
    route = new LocalSshBrowserRoute(targetId, dependencies ?? (await defaultDependencies()))
    routesByTargetId.set(targetId, route)
  }
  try {
    const address = await route.listen()
    return { host: '127.0.0.1', port: address.port }
  } catch (error) {
    if (routesByTargetId.get(targetId) === route) {
      routesByTargetId.delete(targetId)
    }
    void route.close().catch(() => {})
    throw error
  }
}

export async function closeLocalSshBrowserRouteForTarget(targetId: string): Promise<void> {
  const route = routesByTargetId.get(targetId)
  if (!route) {
    return
  }
  routesByTargetId.delete(targetId)
  await route.close()
}

export async function closeAllLocalSshBrowserRoutes(): Promise<void> {
  const routes = [...routesByTargetId.values()]
  routesByTargetId.clear()
  await Promise.all(routes.map((route) => route.close().catch(() => {})))
}
