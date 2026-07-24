import net from 'node:net'
import { unchainedLocalChains } from './config.mjs'

function listening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.setTimeout(750)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(false))
  })
}

for (const chain of unchainedLocalChains) {
  const isListening = await listening(chain.port)
  console.log(`${chain.chainId} ${chain.chain} ${chain.coinstack} http://127.0.0.1:${chain.port} ${isListening ? 'listening' : 'not-listening'}`)
}
