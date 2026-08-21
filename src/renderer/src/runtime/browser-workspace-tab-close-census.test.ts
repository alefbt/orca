import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// Why: who tears a browser workspace down is a policy, and every close site that decides it alone
// gets it wrong in a different way — the ambiguous multi-owner close fell through silently, the
// pageless host mirror was un-closable, and the menu's Close Tab fired at a host that had never
// heard of a staged tab. Testing planBrowserWorkspaceTabClose in isolation cannot catch the next
// site that skips it, so this census pins every renderer file that closes a browser workspace:
// how many close calls it makes, and whether it asks the shared plan first. Adding a close call
// anywhere fails this test until it is classified here.
const BROWSER_WORKSPACE_CLOSE_SITES: {
  path: string
  closeCalls: number
  /** How many local teardowns forward the plan's cleanup reason; 0 for sites that skip the plan. */
  planReasonForwardings: number
  routesThroughPlan: boolean
  why: string
}[] = [
  {
    path: 'src/renderer/src/components/Terminal.tsx',
    planReasonForwardings: 2,
    closeCalls: 3,
    routesThroughPlan: true,
    why: 'handleCloseBrowserTab (legacy tab bar + Cmd/Ctrl+W) and closeTabBarTabs (bulk close).'
  },
  {
    path: 'src/renderer/src/components/tab-group/useTabGroupTabCloseCommands.ts',
    planReasonForwardings: 1,
    closeCalls: 1,
    routesThroughPlan: true,
    why: 'closeBrowserItem, shared by the split-pane strip X (closeItem) and bulk close (closeMany).'
  },
  {
    path: 'src/renderer/src/hooks/useIpcEvents.ts',
    planReasonForwardings: 1,
    closeCalls: 7,
    routesThroughPlan: true,
    why:
      'onCloseActiveTab is the local menu close and routes through the plan. The other five ' +
      '(onCloseSessionTab, onSessionTabCloseRequest, onRequestTabClose) answer a close the HOST ' +
      'asked for, so consulting the plan would echo a session.tabs.close back at the requester.'
  },
  {
    path: 'src/renderer/src/components/floating-terminal/FloatingTerminalPanel.tsx',
    planReasonForwardings: 0,
    closeCalls: 2,
    routesThroughPlan: false,
    why:
      'The floating workspace is never host-mirrored — applyWebSessionTabsSnapshot returns state ' +
      'unchanged for FLOATING_TERMINAL_WORKTREE_ID — so its browser tabs have no remote owner.'
  },
  {
    path: 'src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-lifecycle.ts',
    planReasonForwardings: 0,
    closeCalls: 1,
    routesThroughPlan: false,
    why: 'Mirrors a page the host already retired; a plan-driven close would echo it back.'
  },
  {
    path: 'src/renderer/src/runtime/web-runtime-browser-tab-staging.ts',
    planReasonForwardings: 0,
    closeCalls: 1,
    routesThroughPlan: false,
    why: 'Unwinds rows this client minted for a create that never landed — there is no host page.'
  },
  {
    path: 'src/renderer/src/store/slices/browser.ts',
    planReasonForwardings: 0,
    closeCalls: 1,
    routesThroughPlan: false,
    why: 'shutdownWorktreeBrowsers tears the whole worktree down; the slice is the seam itself.'
  }
]

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      return listSourceFiles(fullPath)
    }
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) {
      return []
    }
    return [fullPath]
  })
}

// Why: comments are stripped first, so commenting a close call out in place must fail the census
// rather than quietly shrink the count.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function countCloseCalls(source: string): number {
  return stripComments(source).match(/\bcloseBrowserTab\(/g)?.length ?? 0
}

describe('browser workspace close census', () => {
  it.each(BROWSER_WORKSPACE_CLOSE_SITES)(
    '$path closes $closeCalls browser workspaces, plan-routed: $routesThroughPlan',
    ({ path, closeCalls, routesThroughPlan }) => {
      const source = stripComments(readFileSync(join(process.cwd(), path), 'utf8'))
      expect(countCloseCalls(source)).toBe(closeCalls)
      expect(/\bcloseBrowserWorkspaceTabOnHosts\(/.test(source)).toBe(routesThroughPlan)
    }
  )

  it('lists every renderer file that closes a browser workspace', () => {
    const root = join(process.cwd(), 'src/renderer')
    const closers = listSourceFiles(root)
      .filter((filePath) => countCloseCalls(readFileSync(filePath, 'utf8')) > 0)
      .map((filePath) => relative(process.cwd(), filePath).split(sep).join('/'))
      .sort()
    expect(closers).toEqual(BROWSER_WORKSPACE_CLOSE_SITES.map((site) => site.path).sort())
  })

  // Why: the plan is only an authority if its consumers actually run its local teardown. A site
  // that reads the plan and then closes on its own terms is the same divergence with extra steps.
  // Bound to the forwarding expression itself — merely mentioning localCloseReason is not wiring,
  // and Terminal.tsx's two sites have no behavior test to catch it going missing.
  it('every plan-routed site forwards the plan cleanup reason into its local teardown', () => {
    const forwardsReason =
      /plan\.localCloseReason\s*\?\s*\{\s*reason:\s*plan\.localCloseReason\s*\}\s*:\s*undefined/g
    for (const site of BROWSER_WORKSPACE_CLOSE_SITES) {
      const source = stripComments(readFileSync(join(process.cwd(), site.path), 'utf8'))
      expect({ path: site.path, forwards: source.match(forwardsReason)?.length ?? 0 }).toEqual({
        path: site.path,
        forwards: site.planReasonForwardings
      })
    }
  })
})
