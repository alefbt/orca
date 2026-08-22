import type { AgentBrowserBridge } from '../browser/agent-browser-bridge'

// The surfaces that can back a newly created browser page. Every one of them
// publishes the created tab through publishCreatedBrowserSessionTab.
export type BrowserTabCreatePlacementKind = 'client' | 'offscreen' | 'renderer'

export const BROWSER_TAB_CREATE_PLACEMENT_KINDS = [
  'client',
  'offscreen',
  'renderer'
] as const satisfies readonly BrowserTabCreatePlacementKind[]

type BrowserTabCreatePublicationBridge = Pick<
  AgentBrowserBridge,
  'getRegisteredTabs' | 'setActiveTab'
>

export type BrowserTabCreatePublicationHost = {
  getAgentBrowserBridge(): BrowserTabCreatePublicationBridge | null
  markHeadlessBrowserSessionTabActive?(
    worktreeId: string | undefined,
    browserPageId: string,
    targetGroupId?: string
  ): void
  notifyHeadlessBrowserSessionTabsChanged?(worktreeId: string): void
}

export type BrowserTabCreatePublication = {
  placementKind: BrowserTabCreatePlacementKind
  browserPageId: string
  worktreeId?: string
  activate?: boolean
  targetGroupId?: string
}

/**
 * Where the HOST desktop's own tab row for a placement comes from. The host renderer owns its tab
 * model, so a placement whose page never reaches that renderer has to name another source or it is
 * invisible on the host — which is exactly what `client` was before it declared `session-notify`.
 *
 * `create-ipc`: the create round-trips through the renderer, which mints the row itself.
 * `session-notify`: main pushes a derived, ephemeral row off the session-tabs announcement.
 * `none`: no host renderer exists for this placement to appear in.
 */
export type BrowserTabCreateHostRowSource = 'create-ipc' | 'session-notify' | 'none'

type BrowserTabCreatePublicationRules = {
  activatesBridgeTab: boolean
  marksSessionTabFocus: boolean
  notifiesSessionTabsChanged: boolean
  hostRowSource: BrowserTabCreateHostRowSource
}

// Why: this table is the only place a placement may differ in post-create bookkeeping. A new
// surface that forgets a step has to say so here instead of silently omitting it in its branch
// — which is how a client-placed page once lost its targetGroupId and landed in the wrong group.
export const BROWSER_TAB_CREATE_PUBLICATION_RULES: Record<
  BrowserTabCreatePlacementKind,
  BrowserTabCreatePublicationRules
> = {
  client: {
    // Why: client pages are driven over the host lease, so no bridge-registered WebContents exists.
    activatesBridgeTab: false,
    marksSessionTabFocus: true,
    notifiesSessionTabsChanged: true,
    hostRowSource: 'session-notify'
  },
  offscreen: {
    activatesBridgeTab: true,
    marksSessionTabFocus: true,
    // Why: the offscreen snapshot is republished by hydration and by navigation; a bare create
    // has nothing new to announce until one of those runs.
    notifiesSessionTabsChanged: false,
    // Why: the offscreen backend only exists when there is no host renderer to show a row in.
    hostRowSource: 'none'
  },
  renderer: {
    activatesBridgeTab: true,
    // Why: the renderer owns its own tab model — `activate` rides the create IPC and the renderer
    // publishes the resulting session snapshot itself.
    marksSessionTabFocus: false,
    notifiesSessionTabsChanged: false,
    hostRowSource: 'create-ipc'
  }
}

// Why: only user-initiated creates take focus; agent and CLI creates must not yank a connected
// client onto the new tab. The marker is also what moves the tab into the clicked split group.
export function browserTabCreateTakesFocus(activate: boolean | undefined): boolean {
  return activate === true
}

// Why: a client page becomes its workspace's active registry page unless the caller opts out.
// That default differs from browserTabCreateTakesFocus only when `activate` is omitted, which no
// shipped caller does — web-runtime-session is the sole sender of client placement and always
// sends an explicit boolean. Kept as a separate named resolution rather than collapsed, because
// collapsing would quietly change the omitted-activate case for a hand-written RPC.
export function browserTabCreateClientPageStartsActive(activate: boolean | undefined): boolean {
  return activate !== false
}

// The surfaces browserTabSwitch can land on. `bridge` covers renderer and offscreen alike: both
// are switched by AgentBrowserBridge.tabSwitch, which already moves bridge-side active state.
export type BrowserTabSwitchPlacementKind = 'client' | 'bridge'

export const BROWSER_TAB_SWITCH_PLACEMENT_KINDS = [
  'client',
  'bridge'
] as const satisfies readonly BrowserTabSwitchPlacementKind[]

export type BrowserTabSwitchPublication = {
  placementKind: BrowserTabSwitchPlacementKind
  browserPageId: string
  worktreeId?: string
  focus?: boolean
}

export const BROWSER_TAB_SWITCH_PUBLICATION_RULES: Record<
  BrowserTabSwitchPlacementKind,
  { marksSessionTabFocus: boolean; notifiesSessionTabsChanged: boolean }
> = {
  client: {
    marksSessionTabFocus: true,
    // Why: the page registry's active flag moved, and that flag is only visible to clients
    // through a republished snapshot — announce it whether or not the switch took focus.
    notifiesSessionTabsChanged: true
  },
  bridge: {
    marksSessionTabFocus: true,
    // Why: nothing in the snapshot changes for an unfocused bridge switch, and the focused case
    // republishes through the focus marker itself.
    notifiesSessionTabsChanged: false
  }
}

// Why: `focus` is the switch's opt-in user intent, the exact analogue of create's `activate` —
// an agent or CLI switch without it must not yank a connected client onto the tab.
export function browserTabSwitchTakesFocus(focus: boolean | undefined): boolean {
  return focus === true
}

// Why: an explicit switch moved the session's active tab just as an activating create does, so
// both converge here rather than letting only create reach the session-tab snapshot.
export function publishSwitchedBrowserSessionTab(
  host: BrowserTabCreatePublicationHost,
  publication: BrowserTabSwitchPublication
): void {
  const rules = BROWSER_TAB_SWITCH_PUBLICATION_RULES[publication.placementKind]
  if (rules.notifiesSessionTabsChanged && publication.worktreeId !== undefined) {
    host.notifyHeadlessBrowserSessionTabsChanged?.(publication.worktreeId)
  }
  if (rules.marksSessionTabFocus && browserTabSwitchTakesFocus(publication.focus)) {
    host.markHeadlessBrowserSessionTabActive?.(publication.worktreeId, publication.browserPageId)
  }
}

export function publishCreatedBrowserSessionTab(
  host: BrowserTabCreatePublicationHost,
  publication: BrowserTabCreatePublication
): void {
  const rules = BROWSER_TAB_CREATE_PUBLICATION_RULES[publication.placementKind]
  if (rules.notifiesSessionTabsChanged && publication.worktreeId !== undefined) {
    host.notifyHeadlessBrowserSessionTabsChanged?.(publication.worktreeId)
  }
  if (rules.activatesBridgeTab) {
    const bridge = host.getAgentBrowserBridge()
    const webContentsId = bridge
      ?.getRegisteredTabs(publication.worktreeId)
      .get(publication.browserPageId)
    if (bridge && webContentsId != null) {
      bridge.setActiveTab(webContentsId, publication.worktreeId)
    }
  }
  if (rules.marksSessionTabFocus && browserTabCreateTakesFocus(publication.activate)) {
    host.markHeadlessBrowserSessionTabActive?.(
      publication.worktreeId,
      publication.browserPageId,
      publication.targetGroupId
    )
  }
}
