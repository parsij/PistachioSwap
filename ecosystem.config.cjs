const path = require('node:path')

const appRoot = process.env.PISTACHIO_PUBLIC_ROOT
    ? path.resolve(process.env.PISTACHIO_PUBLIC_ROOT)
    : __dirname

module.exports = {
    apps: [
        {
            name: 'pistachioswap-api',
            cwd: appRoot,
            script: path.join(appRoot, 'scripts/deploy/start-api-with-env-sync.sh'),
            interpreter: 'bash',
            exec_mode: 'fork',
            instances: 1,
            autorestart: true,
            watch: false,
            min_uptime: '10s',
            max_restarts: 10,
            restart_delay: 5_000,
            kill_timeout: 30_000,
            max_memory_restart: '1G',
            time: true,
            merge_logs: true,
            env: {
                NODE_ENV: 'production',
                HOST: '127.0.0.1',
                PORT: '3006',
            },
        },
    ],
}
