import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'
import {
  BrowserClientPageMetadataTransport,
  publishBrowserClientPageMetadata,
  registerBrowserClientPageMetadataTransport,
  resetBrowserClientPageMetadataTransports
} from './browser-client-page-metadata-transport'

const PARAMS = {
  browserHostClientId: 'host-a',
  browserHostGeneration: 3,
  browserPageId: 'page-a',
  pageHostGeneration: 7,
  revision: 2,
  url: 'https://example.internal/moved',
  title: 'Moved',
  loading: false,
  canGoBack: true,
  canGoForward: false
}

afterEach(() => {
  resetBrowserClientPageMetadataTransports()
})

describe('browser client page metadata transport', () => {
  it('sends the publish over the bound lease and reports the acknowledgement', async () => {
    const sendPageMetadataRequest = vi
      .fn()
      .mockResolvedValue({ ok: true, result: { accepted: true }, _meta: { runtimeId: 'a' } })
    const transport = new BrowserClientPageMetadataTransport()
    transport.bind({ sendPageMetadataRequest })

    await expect(transport.publish(PARAMS)).resolves.toEqual({ accepted: true })
    expect(sendPageMetadataRequest).toHaveBeenCalledWith(PARAMS, expect.any(Number))
  })

  // Why the un-accepted answer is carried rather than flattened into success: it is the difference
  // between the runtime holding this page's URL and the runtime still holding its create URL.
  it('carries an un-accepted acknowledgement back to the caller', async () => {
    const transport = new BrowserClientPageMetadataTransport()
    transport.bind({
      sendPageMetadataRequest: () =>
        Promise.resolve({
          ok: true as const,
          result: { accepted: false },
          _meta: { runtimeId: 'a' }
        })
    })

    await expect(transport.publish(PARAMS)).resolves.toEqual({ accepted: false })
  })

  it('rejects a runtime error and an unreadable acknowledgement', async () => {
    const failing = new BrowserClientPageMetadataTransport()
    failing.bind({
      sendPageMetadataRequest: () =>
        Promise.resolve({
          ok: false as const,
          error: { code: 'browser_host_lease_stale', message: 'stale' },
          _meta: { runtimeId: 'a' }
        })
    })
    await expect(failing.publish(PARAMS)).rejects.toThrow('stale')

    const garbled = new BrowserClientPageMetadataTransport()
    garbled.bind({
      sendPageMetadataRequest: () =>
        Promise.resolve({
          ok: true as const,
          result: { accepted: 'yes' },
          _meta: { runtimeId: 'a' }
        })
    })
    await expect(garbled.publish(PARAMS)).rejects.toThrow(
      'browser_client_page_metadata_ack_invalid'
    )
  })

  it('refuses to publish once nothing is bound', async () => {
    const transport = new BrowserClientPageMetadataTransport()
    const sender = { sendPageMetadataRequest: vi.fn() }
    transport.bind(sender)
    transport.unbind(sender)

    await expect(transport.publish(PARAMS)).rejects.toBeInstanceOf(RemoteRuntimeClientError)
    expect(sender.sendPageMetadataRequest).not.toHaveBeenCalled()
  })

  // Why unbind is identity-checked: an authority transition binds the replacement host before the
  // outgoing composition tears down, and a blind unbind would unbind the live one.
  it('leaves a replacement bound when the host it replaced unbinds', async () => {
    const transport = new BrowserClientPageMetadataTransport()
    const outgoing = { sendPageMetadataRequest: vi.fn() }
    const replacement = {
      sendPageMetadataRequest: vi
        .fn()
        .mockResolvedValue({ ok: true, result: { accepted: true }, _meta: { runtimeId: 'a' } })
    }
    transport.bind(outgoing)
    transport.bind(replacement)
    transport.unbind(outgoing)

    await expect(transport.publish(PARAMS)).resolves.toEqual({ accepted: true })
    expect(replacement.sendPageMetadataRequest).toHaveBeenCalledTimes(1)
  })
})

describe('browser client page metadata routing', () => {
  it('publishes through the transport of the environment that owns the page', async () => {
    const owning = new BrowserClientPageMetadataTransport()
    const other = new BrowserClientPageMetadataTransport()
    const owningSend = vi
      .fn()
      .mockResolvedValue({ ok: true, result: { accepted: true }, _meta: { runtimeId: 'a' } })
    const otherSend = vi.fn()
    owning.bind({ sendPageMetadataRequest: owningSend })
    other.bind({ sendPageMetadataRequest: otherSend })
    registerBrowserClientPageMetadataTransport('environment-a', owning)
    registerBrowserClientPageMetadataTransport('environment-b', other)

    await expect(publishBrowserClientPageMetadata('environment-a', PARAMS)).resolves.toEqual({
      accepted: true
    })
    expect(otherSend).not.toHaveBeenCalled()
  })

  it('fails a publish for an environment that hosts nothing', async () => {
    await expect(publishBrowserClientPageMetadata('environment-a', PARAMS)).rejects.toBeInstanceOf(
      RemoteRuntimeClientError
    )
  })

  it('stops routing to a released transport without disturbing a re-registered one', async () => {
    const first = new BrowserClientPageMetadataTransport()
    const release = registerBrowserClientPageMetadataTransport('environment-a', first)
    const second = new BrowserClientPageMetadataTransport()
    second.bind({
      sendPageMetadataRequest: () =>
        Promise.resolve({
          ok: true as const,
          result: { accepted: true },
          _meta: { runtimeId: 'a' }
        })
    })
    registerBrowserClientPageMetadataTransport('environment-a', second)

    // The outgoing composition releases after the replacement registered: it must not unregister it.
    release()

    await expect(publishBrowserClientPageMetadata('environment-a', PARAMS)).resolves.toEqual({
      accepted: true
    })
  })
})
