import { unchainedHttpUrlsJson, unchainedLocalChains } from './config.mjs'

console.log('UNCHAINED_ENABLED=true')
console.log('UNCHAINED_REQUEST_TIMEOUT_MS=8000')
console.log(`UNCHAINED_HTTP_URLS_JSON=${unchainedHttpUrlsJson()}`)
console.log('')
for (const chain of unchainedLocalChains) {
  console.log(`# ${chain.chain} (${chain.chainId})`)
  console.log(`# In a local ShapeShift Unchained checkout:`)
  console.log(`cd node/coinstacks/${chain.coinstack}`)
  console.log(`cp sample.env .env`)
  console.log(`# Fill INDEXER_API_KEY, RPC_API_KEY, WEBHOOK_URL, and ETHERSCAN_API_KEY where the sample requires them.`)
  console.log(`docker compose up`)
  console.log(`# expose API to PistachioSwap at http://127.0.0.1:${chain.port}`)
  console.log('')
}
