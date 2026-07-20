import { createApp } from './app.js'
import { readServerPort } from './config.js'
import { createShutdownHandler } from './lib/shutdown.js'

const app = createApp()

const port = readServerPort()
const host = process.env.HOST ?? '127.0.0.1'
const shutdown = createShutdownHandler(
    () => app.close(),
    (error) => {
        app.log.error(error, 'API shutdown failed')
        process.exitCode = 1
    },
)

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())

try {
    await app.listen({
        port,
        host,
    })
} catch (error) {
    app.log.error(error)
    process.exit(1)
}
