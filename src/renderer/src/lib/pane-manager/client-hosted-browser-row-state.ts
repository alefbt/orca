import { useSyncExternalStore } from 'react'
import type {
  ClientHostedBrowserRow,
  ClientHostedBrowserRowsEvent
} from '../../../../shared/client-hosted-browser-rows'

/**
 * Rows for browser pages that render on a paired CLIENT desktop, held for the HOST's own UI.
 *
 * Module-level and derived on purpose. The host's tab model — `unifiedTabsByWorktree`,
 * `browserTabsByWorktree`, `browserPagesByWorkspace` — is both the persisted workspace session and
 * the source of the runtime window graph, so a row placed there would be written to disk and
 * round-tripped back as a host-owned local tab on the next launch. These rows own no page and must
 * not survive the process, so they never enter the store at all.
 */

export type ClientHostedBrowserRowSelection = {
  worktreeId: string
  browserPageId: string
  groupId: string
  // Which tab the group had active when the row was picked; the selection dies when that moves.
  groupActiveTabIdAtSelection: string | null
}

const EMPTY_ROWS: readonly ClientHostedBrowserRow[] = []

const rowsByWorktreeId = new Map<string, readonly ClientHostedBrowserRow[]>()
let selection: ClientHostedBrowserRowSelection | null = null

const snapshotListeners = new Set<() => void>()
let version = 0

function subscribe(listener: () => void): () => void {
  snapshotListeners.add(listener)
  return () => {
    snapshotListeners.delete(listener)
  }
}

function getSnapshot(): number {
  return version
}

function getServerSnapshot(): number {
  return 0
}

function notifyChange(): void {
  version += 1
  for (const listener of snapshotListeners) {
    listener()
  }
}

function dropSelectionForMissingRow(): void {
  if (!selection) {
    return
  }
  const rows = rowsByWorktreeId.get(selection.worktreeId) ?? EMPTY_ROWS
  if (!rows.some((row) => row.browserPageId === selection?.browserPageId)) {
    selection = null
  }
}

export function applyClientHostedBrowserRows(event: ClientHostedBrowserRowsEvent): void {
  if (event.rows.length === 0) {
    rowsByWorktreeId.delete(event.worktreeId)
  } else {
    rowsByWorktreeId.set(event.worktreeId, event.rows)
  }
  dropSelectionForMissingRow()
  notifyChange()
}

export function hydrateClientHostedBrowserRows(
  events: readonly ClientHostedBrowserRowsEvent[]
): void {
  rowsByWorktreeId.clear()
  for (const event of events) {
    if (event.rows.length > 0) {
      rowsByWorktreeId.set(event.worktreeId, event.rows)
    }
  }
  dropSelectionForMissingRow()
  notifyChange()
}

export function getClientHostedBrowserRows(worktreeId: string): readonly ClientHostedBrowserRow[] {
  return rowsByWorktreeId.get(worktreeId) ?? EMPTY_ROWS
}

export function useClientHostedBrowserRows(worktreeId: string): readonly ClientHostedBrowserRow[] {
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return getClientHostedBrowserRows(worktreeId)
}

export function selectClientHostedBrowserRow(next: ClientHostedBrowserRowSelection): void {
  selection = next
  notifyChange()
}

// Why: called from every other row's activation. Cheap no-op guard so a plain tab click does not
// version-bump this store and re-render every strip that reads it.
export function clearClientHostedBrowserRowSelection(): void {
  if (!selection) {
    return
  }
  selection = null
  notifyChange()
}

export function getClientHostedBrowserRowSelection(): ClientHostedBrowserRowSelection | null {
  return selection
}

export function useClientHostedBrowserRowSelection(): ClientHostedBrowserRowSelection | null {
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return selection
}

/**
 * A selection survives only while its group still shows the tab it was picked over. Activating
 * anything else in that group — by click, keyboard, or command palette — moves `activeTabId` and
 * retires the placeholder without every one of those paths having to know it exists.
 */
export function isClientHostedBrowserRowSelectionLive(
  candidate: ClientHostedBrowserRowSelection | null,
  groups: readonly { id: string; activeTabId?: string | null }[]
): boolean {
  if (!candidate) {
    return false
  }
  const group = groups.find((entry) => entry.id === candidate.groupId)
  return (
    group !== undefined && (group.activeTabId ?? null) === candidate.groupActiveTabIdAtSelection
  )
}
