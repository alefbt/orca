/** Where the caret sits in the address bar, in the shape `setSelectionRange` wants it back. */
export type BrowserAddressBarSelection = {
  start: number
  end: number
  direction: 'forward' | 'backward' | 'none'
}

/** An address-bar edit that was in progress when the chrome around it was torn down. */
export type BrowserAddressBarEditSession = {
  draft: string
  selection: BrowserAddressBarSelection
  suggestionsOpen: boolean
}

// Why this exists outside React: adopting a client-hosted page swaps the streamed pane for the
// client-hosted one under a different key, so the whole address bar unmounts mid-typing. The page
// id is the one identity that survives that swap, so it keys what the remounting bar picks back up.
const editSessionsByPageId = new Map<string, BrowserAddressBarEditSession>()

export function saveBrowserAddressBarEditSession(
  pageId: string,
  session: BrowserAddressBarEditSession
): void {
  editSessionsByPageId.set(pageId, session)
  // Why a microtask rather than a timeout: React deletes the old pane and inserts the new one in
  // one synchronous commit, and the resuming layout effect runs before the stack unwinds — so a
  // swap always beats this. Anything arriving later is a different mount, such as a tab revisited
  // or a worktree switched back to, where seizing focus would be the bug rather than the fix.
  queueMicrotask(() => {
    if (editSessionsByPageId.get(pageId) === session) {
      editSessionsByPageId.delete(pageId)
    }
  })
}

export function consumeBrowserAddressBarEditSession(
  pageId: string
): BrowserAddressBarEditSession | null {
  const session = editSessionsByPageId.get(pageId) ?? null
  editSessionsByPageId.delete(pageId)
  return session
}

/** Drop a page's edit, so a close mid-typing cannot resume into whatever mounts next. */
export function clearBrowserAddressBarEditSession(pageId: string): void {
  editSessionsByPageId.delete(pageId)
}
