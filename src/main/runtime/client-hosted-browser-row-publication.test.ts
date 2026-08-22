import { describe, expect, it } from 'vitest'
import type { ClientHostedBrowserRowsEvent } from '../../shared/client-hosted-browser-rows'
import { ClientHostedBrowserRowPublisher } from './client-hosted-browser-row-publication'
import { RuntimeBrowserPageRegistry } from './runtime-browser-page-registry'

function publishPage(
  registry: RuntimeBrowserPageRegistry,
  browserPageId: string,
  workspaceId: string
): void {
  registry.publishClientPage({
    browserPageId,
    workspaceId,
    browserProfileId: 'default',
    executionHostKey: 'native:runtime-a:7',
    placement: {
      kind: 'client',
      browserHostClientId: 'host-a',
      browserHostGeneration: 1,
      pageHostGeneration: 1
    },
    pairedDeviceId: 'device-a',
    url: `https://example.test/${browserPageId}`,
    loading: false,
    active: false
  })
}

function createPublisher(): {
  publisher: ClientHostedBrowserRowPublisher
  registry: RuntimeBrowserPageRegistry
  events: ClientHostedBrowserRowsEvent[]
  livePlacements: Set<string>
  detach(): void
  attach(): void
} {
  const registry = new RuntimeBrowserPageRegistry()
  const events: ClientHostedBrowserRowsEvent[] = []
  const livePlacements = new Set<string>()
  let attached = true
  const publisher = new ClientHostedBrowserRowPublisher({
    listClientPages: (worktreeId) => registry.listPages(worktreeId),
    hasLivePlacement: (browserPageId) => livePlacements.has(browserPageId),
    resolveDeviceName: () => 'Studio',
    getEmitter: () =>
      attached
        ? (event): void => {
            events.push(event)
          }
        : null
  })
  return {
    publisher,
    registry,
    events,
    livePlacements,
    detach: () => {
      attached = false
    },
    attach: () => {
      attached = true
    }
  }
}

describe('ClientHostedBrowserRowPublisher', () => {
  it('pushes the workspace rows once a client page exists', () => {
    const { publisher, registry, events, livePlacements } = createPublisher()
    publishPage(registry, 'page-1', 'wt-1')
    livePlacements.add('page-1')

    publisher.publish('wt-1')

    expect(events).toEqual([
      {
        worktreeId: 'wt-1',
        rows: [
          {
            browserPageId: 'page-1',
            worktreeId: 'wt-1',
            url: 'https://example.test/page-1',
            title: 'Browser',
            loading: false,
            browserHostClientId: 'host-a',
            hostDeviceName: 'Studio',
            hostAbsent: false
          }
        ]
      }
    ])
  })

  // Why: this rides an announcement that fires on unrelated terminal and editor churn too; a push
  // per announcement for every workspace that never had a client page is pure IPC noise.
  it('stays silent for a workspace that never had a client page', () => {
    const { publisher, events } = createPublisher()

    publisher.publish('wt-1')
    publisher.publish('wt-1')

    expect(events).toEqual([])
  })

  it('pushes the emptied list exactly once after the last page goes', () => {
    const { publisher, registry, events, livePlacements } = createPublisher()
    publishPage(registry, 'page-1', 'wt-1')
    livePlacements.add('page-1')
    publisher.publish('wt-1')
    events.length = 0

    registry.retirePage('page-1', registry.getPage('page-1')!.placement)
    publisher.publish('wt-1')
    publisher.publish('wt-1')

    expect(events).toEqual([{ worktreeId: 'wt-1', rows: [] }])
  })

  it('re-announces a workspace that gains a page again after emptying', () => {
    const { publisher, registry, events, livePlacements } = createPublisher()
    publishPage(registry, 'page-1', 'wt-1')
    livePlacements.add('page-1')
    publisher.publish('wt-1')
    registry.retirePage('page-1', registry.getPage('page-1')!.placement)
    publisher.publish('wt-1')
    events.length = 0

    publishPage(registry, 'page-2', 'wt-1')
    livePlacements.add('page-2')
    publisher.publish('wt-1')

    expect(events.map((event) => event.rows.map((row) => row.browserPageId))).toEqual([['page-2']])
  })

  it('flips a row to host-absent when its lease is gone', () => {
    const { publisher, registry, events, livePlacements } = createPublisher()
    publishPage(registry, 'page-1', 'wt-1')
    livePlacements.add('page-1')
    publisher.publish('wt-1')
    events.length = 0

    livePlacements.delete('page-1')
    publisher.publish('wt-1')

    expect(events).toEqual([
      { worktreeId: 'wt-1', rows: [expect.objectContaining({ hostAbsent: true })] }
    ])
  })

  it('publishes every workspace holding client pages when no workspace is named', () => {
    const { publisher, registry, events, livePlacements } = createPublisher()
    publishPage(registry, 'page-1', 'wt-1')
    publishPage(registry, 'page-2', 'wt-2')
    livePlacements.add('page-1')
    livePlacements.add('page-2')

    publisher.publishAll()

    expect(events.map((event) => event.worktreeId).sort()).toEqual(['wt-1', 'wt-2'])
  })

  // Why: a bare republish must still be able to retract rows the renderer is still showing.
  it('retracts a previously published workspace on a bare republish', () => {
    const { publisher, registry, events, livePlacements } = createPublisher()
    publishPage(registry, 'page-1', 'wt-1')
    livePlacements.add('page-1')
    publisher.publish('wt-1')
    events.length = 0

    registry.retirePage('page-1', registry.getPage('page-1')!.placement)
    publisher.publishAll()

    expect(events).toEqual([{ worktreeId: 'wt-1', rows: [] }])
  })

  // Why: a publish with no renderer attached must not record the workspace as delivered, or the
  // window that attaches next never hears the rows it missed.
  it('replays a workspace whose only publish landed while no renderer was attached', () => {
    const { publisher, registry, events, livePlacements, attach, detach } = createPublisher()
    publishPage(registry, 'page-1', 'wt-1')
    livePlacements.add('page-1')

    detach()
    publisher.publish('wt-1')
    registry.retirePage('page-1', registry.getPage('page-1')!.placement)
    attach()
    publisher.publish('wt-1')

    expect(events).toEqual([])
    expect(publisher.snapshot()).toEqual([])
  })

  it('snapshots every workspace with client pages for renderer hydration', () => {
    const { publisher, registry, livePlacements } = createPublisher()
    publishPage(registry, 'page-1', 'wt-1')
    publishPage(registry, 'page-2', 'wt-2')
    livePlacements.add('page-1')

    expect(
      publisher
        .snapshot()
        .map((event) => event.worktreeId)
        .sort()
    ).toEqual(['wt-1', 'wt-2'])
  })

  it('snapshots nothing when no client page exists', () => {
    const { publisher } = createPublisher()

    expect(publisher.snapshot()).toEqual([])
  })
})
