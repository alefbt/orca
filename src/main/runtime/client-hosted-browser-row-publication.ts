import type { ClientHostedBrowserRowsEvent } from '../../shared/client-hosted-browser-rows'
import { projectClientHostedBrowserRows } from './client-hosted-browser-row-projection'
import type { RuntimeBrowserClientPage } from './runtime-browser-page-registry'

export type ClientHostedBrowserRowPublicationHost = {
  listClientPages(worktreeId?: string): readonly RuntimeBrowserClientPage[]
  hasLivePlacement(browserPageId: string): boolean
  resolveDeviceName(pairedDeviceId: string): string | null
  /** Null while no host renderer is attached; hydration replays the snapshot when one arrives. */
  getEmitter(): ((event: ClientHostedBrowserRowsEvent) => void) | null
}

/**
 * Pushes the host desktop's rows for client-placed browser pages. Deliberately separate from the
 * session-tabs snapshot it rides on: that snapshot is the paired-CLIENT view and is gated on
 * having RPC subscribers, while the host still needs its row after the client that made the page
 * has quit.
 */
export class ClientHostedBrowserRowPublisher {
  // Which workspaces the renderer currently holds rows for, so an emptied one is retracted once.
  private readonly publishedWorktreeIds = new Set<string>()

  constructor(private readonly host: ClientHostedBrowserRowPublicationHost) {}

  publish(worktreeId: string): void {
    const emit = this.host.getEmitter()
    if (!emit) {
      return
    }
    const rows = this.buildRows(this.host.listClientPages(worktreeId))
    // Why: the announcement this rides on also fires on terminal and editor churn, so most calls
    // concern a workspace that has never had a client page. Only speak up when something changed.
    if (rows.length === 0 && !this.publishedWorktreeIds.has(worktreeId)) {
      return
    }
    if (rows.length === 0) {
      this.publishedWorktreeIds.delete(worktreeId)
    } else {
      this.publishedWorktreeIds.add(worktreeId)
    }
    emit({ worktreeId, rows })
  }

  publishAll(): void {
    for (const worktreeId of new Set([
      ...this.publishedWorktreeIds,
      ...this.host.listClientPages().map((page) => page.workspaceId)
    ])) {
      this.publish(worktreeId)
    }
  }

  snapshot(): ClientHostedBrowserRowsEvent[] {
    const pagesByWorktreeId = new Map<string, RuntimeBrowserClientPage[]>()
    for (const page of this.host.listClientPages()) {
      const pages = pagesByWorktreeId.get(page.workspaceId)
      if (pages) {
        pages.push(page)
      } else {
        pagesByWorktreeId.set(page.workspaceId, [page])
      }
    }
    return [...pagesByWorktreeId].map(([worktreeId, pages]) => ({
      worktreeId,
      rows: this.buildRows(pages)
    }))
  }

  private buildRows(
    pages: readonly RuntimeBrowserClientPage[]
  ): ClientHostedBrowserRowsEvent['rows'] {
    return projectClientHostedBrowserRows(pages, {
      hasLivePlacement: (browserPageId) => this.host.hasLivePlacement(browserPageId),
      resolveDeviceName: (pairedDeviceId) => this.host.resolveDeviceName(pairedDeviceId)
    })
  }
}
