import { Duplex } from 'node:stream'
import {
  BROWSER_NETWORK_TUNNEL_CONNECT_TIMEOUT_MS,
  type BrowserNetworkTunnelSocket
} from './browser-network-tunnel-stream-state'

/**
 * Adapts an execution route's socket into the `Duplex` the local SOCKS server
 * pipes to. Resolves only once the underlying transport reports `connect`, so
 * the SOCKS success reply is never sent for a dial that already failed.
 */
export function openExecutionRouteSocketAsDuplex(
  socket: BrowserNetworkTunnelSocket,
  options: { connectTimeoutMs?: number } = {}
): Promise<Duplex> {
  return new Promise<Duplex>((resolve, reject) => {
    let settled = false
    const fail = (error: Error): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      socket.destroy()
      reject(error)
    }
    const timeout = setTimeout(
      () => fail(new Error('browser_local_route_connect_timeout')),
      options.connectTimeoutMs ?? BROWSER_NETWORK_TUNNEL_CONNECT_TIMEOUT_MS
    )
    socket.on('error', (error) => {
      if (!settled) {
        fail(error)
      }
    })
    socket.on('close', () => {
      if (!settled) {
        fail(new Error('browser_local_route_connect_closed'))
      }
    })
    socket.on('connect', () => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      resolve(wrapConnectedSocket(socket))
    })
  })
}

function wrapConnectedSocket(socket: BrowserNetworkTunnelSocket): Duplex {
  const duplex = new Duplex({
    read: () => {
      socket.resume()
    },
    write: (chunk: Buffer, _encoding, callback) => {
      socket.write(chunk, () => callback())
    },
    final: (callback) => {
      socket.end()
      callback()
    },
    destroy: (error, callback) => {
      socket.destroy()
      callback(error)
    }
  })
  socket.on('data', (bytes) => {
    if (!duplex.push(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes))) {
      socket.pause()
    }
  })
  socket.on('end', () => {
    duplex.push(null)
  })
  socket.on('error', (error) => {
    duplex.destroy(error)
  })
  socket.on('close', () => {
    duplex.destroy()
  })
  return duplex
}
