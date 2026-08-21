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

function closeState(
  staged: boolean
): Pick<AppState, 'browserPagesByWorkspace' | 'remoteBrowserPageHandlesByPageId'> {
  return {
    browserPagesByWorkspace: {
      [WORKSPACE_ID]: [
        {
          id: PAGE_ID,
          workspaceId: WORKSPACE_ID
        } as AppState['browserPagesByWorkspace'][string][number]
      ]
    },
    remoteBrowserPageHandlesByPageId: {
      [PAGE_ID]: {
        environmentId: 'environment-a',
        remotePageId: 'remote-page-a',
        ...(staged ? { staged: true } : {})
      }
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
  consumeBrowserAddressBarEditSession(PAGE_ID)
  consumeBrowserPageDeferredNavigation(PAGE_ID)
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
})
