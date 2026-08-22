// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { ClientHostedBrowserRow } from '../../../../shared/client-hosted-browser-rows'
import { closeClientHostedBrowserRow } from '../../runtime/client-hosted-browser-row-close'
import ClientHostedBrowserTabRows from './ClientHostedBrowserTabRows'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('../../runtime/client-hosted-browser-row-close', () => ({
  closeClientHostedBrowserRow: vi.fn()
}))
vi.mock('../../store', () => ({
  useAppStore: (selector: (state: { focusGroup: () => void }) => unknown) =>
    selector({ focusGroup: () => {} })
}))

const ROW: ClientHostedBrowserRow = {
  browserPageId: 'page-1',
  worktreeId: 'wt-1',
  url: 'https://example.test/page-1',
  title: 'Marker',
  loading: false,
  browserHostClientId: 'host-a',
  hostDeviceName: 'Studio',
  hostAbsent: false
}

const mountedRoots: Root[] = []

function renderRows(): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  act(() => {
    root.render(
      <TooltipProvider>
        <ClientHostedBrowserTabRows
          rows={[ROW]}
          worktreeId="wt-1"
          groupId="group-1"
          groupActiveTabId={null}
          includeTopTabBorder
        />
      </TooltipProvider>
    )
  })
  return container
}

function clickClose(container: HTMLElement): void {
  const button = container.querySelector('button[aria-label="Close hosted page"]')
  if (!button) {
    throw new Error('close button not found')
  }
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

afterEach(() => {
  mountedRoots.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('ClientHostedBrowserTabRows close', () => {
  // Why a toast and not just the console: this row is the only way to close a page this host does
  // not render, and a refused close leaves it sitting there looking like the click missed.
  it('tells the user when the close is refused', async () => {
    vi.mocked(closeClientHostedBrowserRow).mockRejectedValue(new Error('runtime rpc timed out'))
    const container = renderRows()

    clickClose(container)
    await act(async () => {})

    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't close this page. The device hosting it may be busy — try again."
    )
  })

  it('stays quiet when the close lands', async () => {
    vi.mocked(closeClientHostedBrowserRow).mockResolvedValue(undefined)
    const container = renderRows()

    clickClose(container)
    await act(async () => {})

    expect(closeClientHostedBrowserRow).toHaveBeenCalledWith({
      worktreeId: 'wt-1',
      browserPageId: 'page-1'
    })
    expect(toast.error).not.toHaveBeenCalled()
  })
})
