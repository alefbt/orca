// Every browser-tab placement must publish the created tab through one seam. A placement that
// hand-rolls its own bookkeeping is how a client-placed page once lost its targetGroupId.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentBrowserBridge } from '../browser/agent-browser-bridge'
import type { RuntimeBrowserCommandHost } from './orca-runtime-browser'
import { RuntimeBrowserPageRegistry } from './runtime-browser-page-registry'
import {
  BROWSER_TAB_CREATE_PLACEMENT_KINDS,
  BROWSER_TAB_CREATE_PUBLICATION_RULES,
  browserTabCreateClientPageStartsActive,
  browserTabCreateTakesFocus,
  publishCreatedBrowserSessionTab,
  type BrowserTabCreatePlacementKind,
  type BrowserTabCreatePublicationHost
} from './browser-tab-create-publication'

const { ipcMainOnMock, waitForTabRegistrationMock } = vi.hoisted(() => ({
  ipcMainOnMock: vi.fn(),
  waitForTabRegistrationMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { on: ipcMainOnMock, removeListener: vi.fn() },
  webContents: { fromId: vi.fn() }
}))

vi.mock('../ipc/browser-tab-registration-wait', () => ({
  waitForTabRegistration: waitForTabRegistrationMock,
  waitForWorktreeTabRegistration: vi.fn()
}))

vi.mock('../browser/browser-session-registry', () => ({
  browserSessionRegistry: {
    getDefaultProfile: () => ({ id: 'default', partition: 'persist:orca-browser' }),
    getProfile: () => null,
    resolveKnownPartition: () => 'persist:orca-browser'
  }
}))

function createCommandHost(
  overrides: Partial<RuntimeBrowserCommandHost>
): RuntimeBrowserCommandHost {
  const runtimeBrowserPages = new RuntimeBrowserPageRegistry()
  return {
    resolveWorktreeSelector: async (selector: string) => ({ id: selector.replace(/^id:/, '') }),
    resolveBrowserWorkspace: async (selector: string) => ({ id: selector.replace(/^id:/, '') }),
    getRuntimeBrowserPageRegistry: () => runtimeBrowserPages,
    getAgentBrowserBridge: () =>
      ({
        getRegisteredTabs: vi.fn(() => new Map([['page-created', 202]])),
        setActiveTab: vi.fn()
      }) as unknown as AgentBrowserBridge,
    getAuthoritativeWindow: vi.fn(),
    getAvailableAuthoritativeWindow: vi.fn(() => null),
    getOffscreenBrowserBackend: vi.fn(() => null),
    ...overrides
  } as unknown as RuntimeBrowserCommandHost
}

function createPublicationHost(registeredTabs: readonly [string, number][] = [['page-1', 101]]): {
  host: BrowserTabCreatePublicationHost
  setActiveTab: ReturnType<typeof vi.fn>
  markHeadlessBrowserSessionTabActive: ReturnType<typeof vi.fn>
  notifyHeadlessBrowserSessionTabsChanged: ReturnType<typeof vi.fn>
} {
  const setActiveTab = vi.fn()
  const markHeadlessBrowserSessionTabActive = vi.fn()
  const notifyHeadlessBrowserSessionTabsChanged = vi.fn()
  return {
    host: {
      getAgentBrowserBridge: () =>
        ({
          getRegisteredTabs: vi.fn(() => new Map(registeredTabs)),
          setActiveTab
        }) as never,
      markHeadlessBrowserSessionTabActive,
      notifyHeadlessBrowserSessionTabsChanged
    },
    setActiveTab,
    markHeadlessBrowserSessionTabActive,
    notifyHeadlessBrowserSessionTabsChanged
  }
}

function browserCommandsSource(): string {
  return readFileSync(join(__dirname, 'orca-runtime-browser.ts'), 'utf8')
}

describe('publishCreatedBrowserSessionTab', () => {
  it('declares a publication rule for every placement kind', () => {
    expect(Object.keys(BROWSER_TAB_CREATE_PUBLICATION_RULES).sort()).toEqual(
      [...BROWSER_TAB_CREATE_PLACEMENT_KINDS].sort()
    )
  })

  // Why: the per-placement cases below read their expectation off this table, so the table itself
  // needs a literal pin — otherwise dropping a step here would silently rewrite what they assert.
  it('pins the bookkeeping each placement owns', () => {
    expect(BROWSER_TAB_CREATE_PUBLICATION_RULES).toEqual({
      client: {
        activatesBridgeTab: false,
        marksSessionTabFocus: true,
        notifiesSessionTabsChanged: true
      },
      offscreen: {
        activatesBridgeTab: true,
        marksSessionTabFocus: true,
        notifiesSessionTabsChanged: false
      },
      renderer: {
        activatesBridgeTab: true,
        marksSessionTabFocus: false,
        notifiesSessionTabsChanged: false
      }
    })
  })

  it.each(BROWSER_TAB_CREATE_PLACEMENT_KINDS)(
    'moves a user-created %s tab into the clicked split group when the placement marks focus',
    (placementKind) => {
      const { host, markHeadlessBrowserSessionTabActive } = createPublicationHost()

      publishCreatedBrowserSessionTab(host, {
        placementKind,
        browserPageId: 'page-1',
        worktreeId: 'wt-1',
        activate: true,
        targetGroupId: 'group-right'
      })

      if (BROWSER_TAB_CREATE_PUBLICATION_RULES[placementKind].marksSessionTabFocus) {
        expect(markHeadlessBrowserSessionTabActive).toHaveBeenCalledWith(
          'wt-1',
          'page-1',
          'group-right'
        )
      } else {
        expect(markHeadlessBrowserSessionTabActive).not.toHaveBeenCalled()
      }
    }
  )

  it.each(BROWSER_TAB_CREATE_PLACEMENT_KINDS)(
    'never marks a background %s create active',
    (placementKind) => {
      const { host, markHeadlessBrowserSessionTabActive } = createPublicationHost()

      for (const activate of [undefined, false]) {
        publishCreatedBrowserSessionTab(host, {
          placementKind,
          browserPageId: 'page-1',
          worktreeId: 'wt-1',
          activate,
          targetGroupId: 'group-right'
        })
      }

      expect(markHeadlessBrowserSessionTabActive).not.toHaveBeenCalled()
    }
  )

  it.each(BROWSER_TAB_CREATE_PLACEMENT_KINDS)(
    'activates the bridge tab for a %s create only when the placement is bridge-backed',
    (placementKind) => {
      const { host, setActiveTab } = createPublicationHost()

      publishCreatedBrowserSessionTab(host, {
        placementKind,
        browserPageId: 'page-1',
        worktreeId: 'wt-1',
        activate: true
      })

      if (BROWSER_TAB_CREATE_PUBLICATION_RULES[placementKind].activatesBridgeTab) {
        expect(setActiveTab).toHaveBeenCalledWith(101, 'wt-1')
      } else {
        expect(setActiveTab).not.toHaveBeenCalled()
      }
    }
  )

  it.each(BROWSER_TAB_CREATE_PLACEMENT_KINDS)(
    'notifies session-tab watchers for a %s create only when the placement owns the announcement',
    (placementKind) => {
      const { host, notifyHeadlessBrowserSessionTabsChanged } = createPublicationHost()

      publishCreatedBrowserSessionTab(host, {
        placementKind,
        browserPageId: 'page-1',
        worktreeId: 'wt-1',
        activate: true
      })

      if (BROWSER_TAB_CREATE_PUBLICATION_RULES[placementKind].notifiesSessionTabsChanged) {
        expect(notifyHeadlessBrowserSessionTabsChanged).toHaveBeenCalledWith('wt-1')
      } else {
        expect(notifyHeadlessBrowserSessionTabsChanged).not.toHaveBeenCalled()
      }
    }
  )

  it('announces the created tab before it takes focus', () => {
    const order: string[] = []
    const host: BrowserTabCreatePublicationHost = {
      getAgentBrowserBridge: () => null,
      markHeadlessBrowserSessionTabActive: () => order.push('mark'),
      notifyHeadlessBrowserSessionTabsChanged: () => order.push('notify')
    }

    publishCreatedBrowserSessionTab(host, {
      placementKind: 'client',
      browserPageId: 'page-1',
      worktreeId: 'wt-1',
      activate: true
    })

    expect(order).toEqual(['notify', 'mark'])
  })

  it('tolerates a host with no bridge and no session-tab surface', () => {
    expect(() =>
      publishCreatedBrowserSessionTab(
        { getAgentBrowserBridge: () => null },
        {
          placementKind: 'offscreen',
          browserPageId: 'page-1',
          worktreeId: 'wt-1',
          activate: true
        }
      )
    ).not.toThrow()
  })

  it('skips bridge activation for a page the bridge has not registered', () => {
    const { host, setActiveTab } = createPublicationHost([['page-other', 101]])

    publishCreatedBrowserSessionTab(host, {
      placementKind: 'renderer',
      browserPageId: 'page-1',
      worktreeId: 'wt-1',
      activate: true
    })

    expect(setActiveTab).not.toHaveBeenCalled()
  })

  it('skips the worktree-scoped announcement for an unscoped create', () => {
    const { host, notifyHeadlessBrowserSessionTabsChanged } = createPublicationHost()

    publishCreatedBrowserSessionTab(host, {
      placementKind: 'client',
      browserPageId: 'page-1',
      activate: true
    })

    expect(notifyHeadlessBrowserSessionTabsChanged).not.toHaveBeenCalled()
  })
})

describe('browser tab-create activation defaults', () => {
  it('takes focus only on an explicit activate', () => {
    expect(browserTabCreateTakesFocus(true)).toBe(true)
    expect(browserTabCreateTakesFocus(false)).toBe(false)
    expect(browserTabCreateTakesFocus(undefined)).toBe(false)
  })

  it('starts a client page active unless the caller opts out', () => {
    expect(browserTabCreateClientPageStartsActive(true)).toBe(true)
    expect(browserTabCreateClientPageStartsActive(false)).toBe(false)
    expect(browserTabCreateClientPageStartsActive(undefined)).toBe(true)
  })

  it('agrees with the focus rule for every explicit boolean shipped callers send', () => {
    for (const activate of [true, false]) {
      expect(browserTabCreateClientPageStartsActive(activate)).toBe(
        browserTabCreateTakesFocus(activate)
      )
    }
  })
})

describe('browser tab-create placement census', () => {
  it('routes every placement branch through the shared publication exactly once', () => {
    const source = browserCommandsSource()
    for (const placementKind of BROWSER_TAB_CREATE_PLACEMENT_KINDS) {
      const routed = source.match(
        new RegExp(
          `publishCreatedBrowserSessionTab\\(this\\.host, \\{\\s*placementKind: '${placementKind}'`,
          'g'
        )
      )
      expect(
        routed,
        `${placementKind} placement must publish through the shared seam`
      ).toHaveLength(1)
    }
    expect(source.match(/publishCreatedBrowserSessionTab\(/g)).toHaveLength(
      BROWSER_TAB_CREATE_PLACEMENT_KINDS.length
    )
  })

  it('leaves no placement branch marking session-tab focus on its own', () => {
    expect(browserCommandsSource()).not.toMatch(/markHeadlessBrowserSessionTabActive\?\.\(/)
  })

  // Why: the rule-driven cases above read their expectation off the table, so each placement also
  // needs its real bookkeeping observed through browserTabCreate itself.
  describe('through browserTabCreate', () => {
    beforeEach(() => {
      ipcMainOnMock.mockReset()
      waitForTabRegistrationMock.mockReset()
      waitForTabRegistrationMock.mockResolvedValue(undefined)
    })

    it('moves a user-created offscreen tab into the clicked split group', async () => {
      const { RuntimeBrowserCommands } = await import('./orca-runtime-browser')
      const markHeadlessBrowserSessionTabActive = vi.fn()
      const commands = new RuntimeBrowserCommands(
        createCommandHost({
          getOffscreenBrowserBackend: vi.fn(
            () =>
              ({
                createTab: vi.fn(async () => ({ browserPageId: 'page-created' })),
                closeTab: vi.fn()
              }) as never
          ),
          markHeadlessBrowserSessionTabActive
        })
      )

      await commands.browserTabCreate({
        worktree: 'id:wt-1',
        url: 'about:blank',
        activate: true,
        targetGroupId: 'group-right'
      })
      expect(markHeadlessBrowserSessionTabActive).toHaveBeenCalledWith(
        'wt-1',
        'page-created',
        'group-right'
      )

      markHeadlessBrowserSessionTabActive.mockClear()
      await commands.browserTabCreate({
        worktree: 'id:wt-1',
        url: 'about:blank',
        targetGroupId: 'group-right'
      })
      // Why: agent/background creates must not yank a connected client to the new tab.
      expect(markHeadlessBrowserSessionTabActive).not.toHaveBeenCalled()
    })

    it('leaves renderer tab focus to the create IPC instead of the session-tab marker', async () => {
      const { RuntimeBrowserCommands } = await import('./orca-runtime-browser')
      const webContents = { send: vi.fn() }
      webContents.send = vi.fn((_channel: string, data: { requestId: string }) => {
        const handler = ipcMainOnMock.mock.calls.find(
          ([eventName]) => eventName === 'browser:tabCreateReply'
        )?.[1] as
          | ((event: unknown, reply: { requestId: string; browserPageId?: string }) => void)
          | undefined
        handler?.({ sender: webContents } as never, {
          requestId: data.requestId,
          browserPageId: 'page-created'
        })
      })
      const markHeadlessBrowserSessionTabActive = vi.fn()
      const commands = new RuntimeBrowserCommands(
        createCommandHost({
          getAvailableAuthoritativeWindow: vi.fn(() => ({}) as never),
          getAuthoritativeWindow: vi.fn(() => ({ webContents }) as never),
          markHeadlessBrowserSessionTabActive
        })
      )

      await commands.browserTabCreate({
        worktree: 'id:wt-1',
        url: 'about:blank',
        activate: true,
        targetGroupId: 'group-right'
      })

      expect(webContents.send).toHaveBeenCalledWith(
        'browser:requestTabCreate',
        expect.objectContaining({ activate: true })
      )
      expect(markHeadlessBrowserSessionTabActive).not.toHaveBeenCalled()
    })
  })

  it('names every placement kind the command adapter can select', () => {
    const source = browserCommandsSource()
    const selected = new Set<BrowserTabCreatePlacementKind>()
    for (const [, placementKind] of source.matchAll(/placementKind: '([a-z]+)'/g)) {
      selected.add(placementKind as BrowserTabCreatePlacementKind)
    }
    expect([...selected].sort()).toEqual([...BROWSER_TAB_CREATE_PLACEMENT_KINDS].sort())
  })
})
