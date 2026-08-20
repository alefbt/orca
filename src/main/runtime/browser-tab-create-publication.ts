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

type BrowserTabCreatePublicationRules = {
  activatesBridgeTab: boolean
  marksSessionTabFocus: boolean
  notifiesSessionTabsChanged: boolean
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
    notifiesSessionTabsChanged: true
  },
  offscreen: {
    activatesBridgeTab: true,
    marksSessionTabFocus: true,
    // Why: the offscreen snapshot is republished by hydration and by navigation; a bare create
    // has nothing new to announce until one of those runs.
    notifiesSessionTabsChanged: false
  },
  renderer: {
    activatesBridgeTab: true,
    // Why: the renderer owns its own tab model — `activate` rides the create IPC and the renderer
    // publishes the resulting session snapshot itself.
    marksSessionTabFocus: false,
    notifiesSessionTabsChanged: false
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
