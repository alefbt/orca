import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import {
  consumeBrowserAddressBarEditSession,
  saveBrowserAddressBarEditSession
} from '@/components/browser-pane/assemble-chrome/browser-address-bar-edit-session'
import {
  consumeBrowserPageDeferredNavigation,
  deferBrowserPageNavigation
} from '@/components/browser-pane/navigate/browser-page-deferred-navigation'

vi.mock('./web-runtime-session', () => ({
  closeWebRuntimeSessionTab: vi.fn(async () => {}),
  isWebRuntimeSessionActive: vi.fn(() => true)
}))

import { closeBrowserWorkspaceTabOnHosts } from './browser-workspace-tab-close'

const WORKSPACE_ID = 'workspace-a'
const PAGE_ID = 'page-a'
const OTHER_WORKSPACE_ID = 'workspace-b'
const OTHER_PAGE_ID = 'page-b'

function browserPage(
  id: string,
  workspaceId: string
): AppState['browserPagesByWorkspace'][string][number] {
  return { id, workspaceId } as AppState['browserPagesByWorkspace'][string][number]
}

function closeState(
  staged: boolean
): Pick<AppState, 'browserPagesByWorkspace' | 'remoteBrowserPageHandlesByPageId'> {
  return {
    browserPagesByWorkspace: {
      [WORKSPACE_ID]: [browserPage(PAGE_ID, WORKSPACE_ID)],
      // Why a second workspace is always in the store here: a release that walks every workspace's
      // pages reads identically to one scoped to the closing tab until something else is open.
      [OTHER_WORKSPACE_ID]: [browserPage(OTHER_PAGE_ID, OTHER_WORKSPACE_ID)]
    },
    remoteBrowserPageHandlesByPageId: {
      [PAGE_ID]: {
        environmentId: 'environment-a',
        remotePageId: 'remote-page-a',
        ...(staged ? { staged: true } : {})
      },
      [OTHER_PAGE_ID]: { environmentId: 'environment-a', remotePageId: 'remote-page-b' }
    }
  }
}

function closeWorkspace(staged: boolean): void {
  closeBrowserWorkspaceTabOnHosts({
    state: closeState(staged),
    worktreeId: 'worktree-a',
    workspaceId: WORKSPACE_ID,
    visibleTabId: 'tab-a',
    focusedEnvironmentId: 'environment-a'
  })
}

afterEach(() => {
  for (const pageId of [PAGE_ID, OTHER_PAGE_ID]) {
    consumeBrowserAddressBarEditSession(pageId)
    consumeBrowserPageDeferredNavigation(pageId)
  }
})

describe('closeBrowserWorkspaceTabOnHosts releases parked page chrome', () => {
  // Why staged specifically: a URL only gets parked because the host had not minted the page yet,
  // and that same tab is the one whose X unwinds a create the user gave up on.
  it('drops a URL submitted against a staged page that is then closed', () => {
    deferBrowserPageNavigation(PAGE_ID, 'https://example.internal/never-arrived')

    closeWorkspace(true)

    expect(consumeBrowserPageDeferredNavigation(PAGE_ID)).toBeNull()
  })

  it('drops an edit parked by a page the user closed mid-typing', () => {
    saveBrowserAddressBarEditSession(PAGE_ID, {
      draft: 'half-typed.internal',
      selection: { start: 4, end: 4, direction: 'none' },
      suggestionsOpen: true,
      preview: null
    })

    closeWorkspace(false)

    expect(consumeBrowserAddressBarEditSession(PAGE_ID)).toBeNull()
  })

  it('leaves the chrome parked by a browser tab the user did not close', () => {
    saveBrowserAddressBarEditSession(OTHER_PAGE_ID, {
      draft: 'still-typing.internal',
      selection: { start: 5, end: 5, direction: 'none' },
      suggestionsOpen: true,
      preview: null
    })
    deferBrowserPageNavigation(OTHER_PAGE_ID, 'https://example.internal/other-tab')

    closeWorkspace(false)

    expect(consumeBrowserAddressBarEditSession(OTHER_PAGE_ID)?.draft).toBe('still-typing.internal')
    expect(consumeBrowserPageDeferredNavigation(OTHER_PAGE_ID)).toBe(
      'https://example.internal/other-tab'
    )
  })
})
