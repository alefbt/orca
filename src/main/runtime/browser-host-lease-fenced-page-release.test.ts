import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeBrowserClientPlacement } from '../../shared/runtime-browser-placement'
import { getBrowserHostLeaseRegistry } from './browser-host-lease-registry-instance'
import { releaseRuntimeBrowserClientPageRecord } from './runtime-browser-client-page-release'
import { getRuntimeBrowserPageRegistry } from './runtime-browser-page-registry'

type FencedPageReleaseRuntime = ReturnType<typeof createRuntime>

afterEach(() => {
  vi.useRealTimers()
})

describe('fenced client page release', () => {
  it('retires the runtime page and its session tab when a lease is released', () => {
    const runtime = createRuntime()
    const leases = getBrowserHostLeaseRegistry(runtime)
    const host = attachHost(runtime, 'host-a')
    publishPage(runtime, 'page-a', placeClientPage(runtime, 'page-a', 'host-a'))

    host.release()

    expect(getRuntimeBrowserPageRegistry(runtime).getPage('page-a')).toBeUndefined()
    expect(leases.getPlacement('page-a')).toBeUndefined()
    expect(runtime.retireRuntimeOwnedBrowserSessionTab).toHaveBeenCalledWith(
      'workspace-a',
      'page-a'
    )
  })

  it('retires pages whose lease fences after its reconnect grace expires', async () => {
    vi.useFakeTimers()
    const runtime = createRuntime()
    const host = attachHost(runtime, 'host-a', { reconnect: true })
    publishPage(runtime, 'page-a', placeClientPage(runtime, 'page-a', 'host-a'))
    publishPage(runtime, 'page-b', placeClientPage(runtime, 'page-b', 'host-a'))

    host.disconnect()
    expect(getRuntimeBrowserPageRegistry(runtime).getPage('page-a')).toBeDefined()
    await vi.advanceTimersByTimeAsync(15_000)

    expect(getRuntimeBrowserPageRegistry(runtime).listPages()).toEqual([])
    expect(runtime.retireRuntimeOwnedBrowserSessionTab).toHaveBeenCalledTimes(2)
    await expect(host.whenFenced).resolves.toBe('released')
  })

  it('leaves pages hosted by a live lease alone', () => {
    const runtime = createRuntime()
    const fenced = attachHost(runtime, 'host-a')
    attachHost(runtime, 'host-b')
    publishPage(runtime, 'page-a', placeClientPage(runtime, 'page-a', 'host-a'))
    const survivor = placeClientPage(runtime, 'page-b', 'host-b')
    publishPage(runtime, 'page-b', survivor)

    fenced.release()

    expect(getRuntimeBrowserPageRegistry(runtime).getPage('page-a')).toBeUndefined()
    expect(getRuntimeBrowserPageRegistry(runtime).getPage('page-b')?.placement).toEqual(survivor)
    expect(runtime.retireRuntimeOwnedBrowserSessionTab).toHaveBeenCalledOnce()
  })

  it('releases the old record when a replacing attach fences the previous lease', () => {
    const runtime = createRuntime()
    attachHost(runtime, 'host-a')
    publishPage(runtime, 'page-a', placeClientPage(runtime, 'page-a', 'host-a'))

    attachHost(runtime, 'host-a', { connectionId: 'connection-b' })

    expect(getRuntimeBrowserPageRegistry(runtime).getPage('page-a')).toBeUndefined()
    expect(runtime.retireRuntimeOwnedBrowserSessionTab).toHaveBeenCalledOnce()
  })

  it('keeps a runtime page a newer placement already owns', () => {
    const runtime = createRuntime()
    const stale = Object.freeze({
      kind: 'client' as const,
      browserHostClientId: 'host-a',
      browserHostGeneration: 1,
      pageHostGeneration: 1
    })
    publishPage(runtime, 'page-a', { ...stale, browserHostGeneration: 2 })

    // Why: a fence never authorizes retiring a record another generation now owns.
    expect(releaseRuntimeBrowserClientPageRecord(runtime, 'page-a', stale)).toBe(false)
    expect(getRuntimeBrowserPageRegistry(runtime).getPage('page-a')).toBeDefined()
    expect(runtime.retireRuntimeOwnedBrowserSessionTab).not.toHaveBeenCalled()
  })

  it('releases the remaining fenced pages when one page release throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const runtime = createRuntime()
    const leases = getBrowserHostLeaseRegistry(runtime)
    const host = attachHost(runtime, 'host-a')
    publishPage(runtime, 'page-a', placeClientPage(runtime, 'page-a', 'host-a'))
    publishPage(runtime, 'page-b', placeClientPage(runtime, 'page-b', 'host-a'))
    runtime.retireRuntimeOwnedBrowserSessionTab.mockImplementationOnce(() => {
      throw new Error('session tab retirement failed')
    })

    // A lease past the point of return must not strand pages behind one failing release.
    expect(() => host.release()).not.toThrow()

    expect(runtime.retireRuntimeOwnedBrowserSessionTab).toHaveBeenCalledTimes(2)
    expect(getRuntimeBrowserPageRegistry(runtime).listPages()).toEqual([])
    expect(leases.getPlacement('page-b')).toBeUndefined()
  })

  it('disarms the reconnect grace timer when the lease is released outright', async () => {
    vi.useFakeTimers()
    const runtime = createRuntime()
    const host = attachHost(runtime, 'host-a', { reconnect: true })
    publishPage(runtime, 'page-a', placeClientPage(runtime, 'page-a', 'host-a'))

    host.disconnect()
    expect(vi.getTimerCount()).toBe(1)
    host.release()

    expect(vi.getTimerCount()).toBe(0)
    await expect(host.whenFenced).resolves.toBe('released')
  })
})

function createRuntime() {
  return {
    getRuntimeId: () => 'runtime-a',
    notifyMobileSessionTabsChanged: vi.fn((_workspaceId: string) => {}),
    retireRuntimeOwnedBrowserSessionTab: vi.fn((_workspaceId: string, _pageId: string) => {})
  }
}

function attachHost(
  runtime: FencedPageReleaseRuntime,
  browserHostClientId: string,
  options: { connectionId?: string; reconnect?: boolean } = {}
) {
  return getBrowserHostLeaseRegistry(runtime).attach({
    browserHostClientId,
    connectionId: options.connectionId ?? `connection-${browserHostClientId}`,
    pairedDeviceId: `device-${browserHostClientId}`,
    hostCapabilities: ['webview'],
    ...(options.reconnect
      ? {
          pageInventoryProtocolVersion: 1 as const,
          pageInventory: [],
          leaseReconnectProtocolVersion: 1 as const
        }
      : {})
  })
}

function placeClientPage(
  runtime: FencedPageReleaseRuntime,
  browserPageId: string,
  browserHostClientId: string
): RuntimeBrowserClientPlacement {
  const placement = getBrowserHostLeaseRegistry(runtime).placeClientPage(
    browserPageId,
    browserHostClientId
  )
  if (placement.kind !== 'client') {
    throw new Error('expected client placement')
  }
  return placement
}

function publishPage(
  runtime: FencedPageReleaseRuntime,
  browserPageId: string,
  placement: RuntimeBrowserClientPlacement
): void {
  getRuntimeBrowserPageRegistry(runtime).publishClientPage({
    browserPageId,
    workspaceId: 'workspace-a',
    browserProfileId: 'profile-a',
    executionHostKey: 'native:runtime-a:1',
    placement,
    url: 'https://example.internal/',
    loading: false,
    active: false
  })
}
