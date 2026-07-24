import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { unchainedHttpUrlsJson, unchainedLocalChains } from './config.mjs'

const expected = JSON.parse(unchainedHttpUrlsJson())
const envPath = new URL('../../apps/api/.env', import.meta.url)
let values = {}

if (existsSync(envPath)) {
  const text = readFileSync(envPath, 'utf8')
  const match = /^UNCHAINED_HTTP_URLS_JSON=(.*)$/m.exec(text)
  if (match) {
    try {
      values = JSON.parse(match[1])
    } catch {
      console.error('UNCHAINED_HTTP_URLS_JSON is present but is not valid JSON.')
      process.exit(1)
    }
  }
}

let ok = true
for (const chain of unchainedLocalChains) {
  const actual = values[String(chain.chainId)]
  if (actual !== expected[String(chain.chainId)]) {
    ok = false
    console.error(`${chain.chainId} ${chain.chain}: expected ${expected[String(chain.chainId)]}; found ${actual ? 'different endpoint' : 'missing'}`)
  }
}

if (ok) console.log('Unchained local configuration matches the verified coinstack ports.')
else process.exit(1)
