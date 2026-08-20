import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentBrowserBridge } from '../browser/agent-browser-bridge'
import { REMOTE_RUNTIME_MAX_OUTBOUND_BINARY_FRAME_BYTES } from '../../shared/remote-runtime-memory-limits'
import type { RuntimeBrowserCommandHost } from './orca-runtime-browser'
import { RuntimeBrowserPageRegistry } from './runtime-browser-page-registry'

const { webContentsFromId, startBrowserScreencast } = vi.hoisted(() => ({
  webContentsFromId: vi.fn(),
  startBrowserScreencast: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  webContents: { fromId: webContentsFromId }
}))
vi.mock('../browser/browser-screencast-stream', () => ({ startBrowserScreencast }))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createCommandsHost(): RuntimeBrowserCommandHost {
  const runtimeBrowserPages = new RuntimeBrowserPageRegistry()
  const bridge = {
    getRegisteredTabs: vi.fn(() => new Map([['page-1', 100]])),
    getActivePageId: vi.fn(() => 'page-1'),
    tabList: vi.fn(() => ({
      tabs: [
        {
          browserPageId: 'page-1',
          index: 0,
          url: 'about:blank',
          title: 'Browser',
          active: true
        }
      ]
    }))
  } as unknown as AgentBrowserBridge
  return {
    resolveWorktreeSelector: async () => ({ id: 'wt-1' }),
    getAgentBrowserBridge: () => bridge,
    getRuntimeBrowserPageRegistry: () => runtimeBrowserPages,
    getAvailableAuthoritativeWindow: vi.fn(() => null),
    getOffscreenBrowserBackend: vi.fn(() => null)
  } as unknown as RuntimeBrowserCommandHost
}

describe('RuntimeBrowserCommands screencast fanout', () => {
  beforeEach(() => {
    webContentsFromId.mockReset()
    webContentsFromId.mockReturnValue({ isDestroyed: () => false })
    startBrowserScreencast.mockReset()
  })

  it('restores the surviving subscriber viewport without stopping its shared stream', async () => {
    const { RuntimeBrowserCommands } = await import('./orca-runtime-browser')
    const done = deferred()
    const stop = vi.fn(() => done.resolve())
    const updateViewport = vi.fn(async () => {})
    startBrowserScreencast.mockResolvedValue({ stop, done: done.promise, updateViewport })
    const commands = new RuntimeBrowserCommands(createCommandsHost())
    const firstSend = vi.fn(() => false)
    const secondSend = vi.fn(() => true)
    const first = await commands.browserScreencast(
      {
        worktree: 'id:wt-1',
        page: 'page-1',
        format: 'jpeg',
        viewportWidth: 1200,
        viewportHeight: 800
      },
      { sendBinary: firstSend }
    )
    const second = await commands.browserScreencast(
      {
        worktree: 'id:wt-1',
        page: 'page-1',
        format: 'jpeg',
        viewportWidth: 800,
        viewportHeight: 600
      },
      { sendBinary: secondSend }
    )

    const frame = new Uint8Array([1, 2, 3])
    expect(startBrowserScreencast).toHaveBeenCalledOnce()
    expect(startBrowserScreencast.mock.calls[0][1].onFrame(frame)).toBe(true)
    expect(firstSend).toHaveBeenCalledWith(frame)
    expect(secondSend).toHaveBeenCalledWith(frame)
    expect(updateViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ viewportWidth: 800, viewportHeight: 600 })
    )
    second.session.stop()
    await second.session.done
    expect(stop).not.toHaveBeenCalled()
    expect(updateViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ viewportWidth: 1200, viewportHeight: 800 })
    )
    first.session.stop()
    await first.session.done
    expect(stop).toHaveBeenCalledOnce()
  })

  it('keeps viewport authority with sized subscribers when a sizeless viewer joins', async () => {
    const { RuntimeBrowserCommands } = await import('./orca-runtime-browser')
    const done = deferred()
    const stop = vi.fn(() => done.resolve())
    const updateViewport = vi.fn(async () => {})
    startBrowserScreencast.mockResolvedValue({ stop, done: done.promise, updateViewport })
    const commands = new RuntimeBrowserCommands(createCommandsHost())
    const sized = await commands.browserScreencast(
      {
        worktree: 'id:wt-1',
        page: 'page-1',
        format: 'jpeg',
        viewportWidth: 1200,
        viewportHeight: 800
      },
      { sendBinary: vi.fn(() => true) }
    )
    const sizeless = await commands.browserScreencast(
      { worktree: 'id:wt-1', page: 'page-1', format: 'jpeg' },
      { sendBinary: vi.fn(() => true) }
    )

    // Why: a sizeless owner would push undefined dimensions into the shared
    // stream and clear the device-metrics override for every viewer.
    expect(updateViewport).not.toHaveBeenCalled()

    sized.session.stop()
    await sized.session.done
    expect(updateViewport).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
    sizeless.session.stop()
    await sizeless.session.done
    expect(stop).toHaveBeenCalledOnce()
  })

  it('replays the joiner snapshot that its pre-ready gate refused', async () => {
    const { RuntimeBrowserCommands } = await import('./orca-runtime-browser')
    const done = deferred()
    const snapshot = new Uint8Array([9, 9, 9])
    let onFrame: (bytes: Uint8Array<ArrayBufferLike>) => boolean | void = () => true
    // Why: updateViewport exists to capture a frame for the joiner, and it runs while the
    // joiner's ready gate is still closed.
    const updateViewport = vi.fn(async () => {
      onFrame(snapshot)
    })
    startBrowserScreencast.mockImplementation(async (_guest: unknown, options: never) => {
      onFrame = (options as { onFrame: typeof onFrame }).onFrame
      return { stop: vi.fn(() => done.resolve()), done: done.promise, updateViewport }
    })
    const commands = new RuntimeBrowserCommands(createCommandsHost())
    const creatorSend = vi.fn(() => true)
    await commands.browserScreencast(
      {
        worktree: 'id:wt-1',
        page: 'page-1',
        format: 'jpeg',
        viewportWidth: 1200,
        viewportHeight: 800
      },
      { sendBinary: creatorSend }
    )
    let gateOpen = false
    const joinerSend = vi.fn(() => gateOpen)
    const joiner = await commands.browserScreencast(
      {
        worktree: 'id:wt-1',
        page: 'page-1',
        format: 'jpeg',
        viewportWidth: 800,
        viewportHeight: 600
      },
      { sendBinary: joinerSend }
    )

    expect(creatorSend).toHaveBeenCalledWith(snapshot)
    expect(joinerSend).toHaveBeenCalledWith(snapshot)
    joinerSend.mockClear()
    gateOpen = true
    joiner.flushPendingFrame()
    expect(joinerSend).toHaveBeenCalledExactlyOnceWith(snapshot)

    // The accepted replay is not retained, so a second flush cannot duplicate it.
    joinerSend.mockClear()
    joiner.flushPendingFrame()
    expect(joinerSend).not.toHaveBeenCalled()
    joiner.session.stop()
    await joiner.session.done
  })

  it('admits shared frames through the paired-runtime size guard', async () => {
    const { RuntimeBrowserCommands } = await import('./orca-runtime-browser')
    const done = deferred()
    startBrowserScreencast.mockResolvedValue({
      stop: vi.fn(() => done.resolve()),
      done: done.promise,
      updateViewport: vi.fn(async () => {})
    })
    const sendBinary = vi.fn(() => true)
    const commands = new RuntimeBrowserCommands(createCommandsHost())
    const started = await commands.browserScreencast(
      { worktree: 'id:wt-1', page: 'page-1', format: 'jpeg' },
      { sendBinary }
    )
    const { onFrame } = startBrowserScreencast.mock.calls[0][1]

    expect(onFrame(new Uint8Array(REMOTE_RUNTIME_MAX_OUTBOUND_BINARY_FRAME_BYTES + 1))).toBe(true)
    expect(sendBinary).not.toHaveBeenCalled()
    expect(onFrame(new Uint8Array(64))).toBe(true)
    expect(sendBinary).toHaveBeenCalledOnce()
    started.session.stop()
    await started.session.done
  })
})
