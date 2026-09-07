import { resolve } from 'node:path'

import { defineConfig, loadEnv } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

import { publicRoutesPlugin } from './src/web3/publicRoutesMiddleware.js'
import { originCacheHeadersPlugin } from './src/web3/originCacheMiddleware.js'
import { resolveModulePreloadDependencies } from './src/web3/walletChunkPreload.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devApiTarget =
    env.PISTACHIO_DEV_API_TARGET?.trim() ||
    'http://localhost:3001'
  const isFrontendTestRun = resolve(process.cwd()) === resolve(import.meta.dirname)

  return {
    appType: 'mpa',
    plugins: [
      publicRoutesPlugin(),
      originCacheHeadersPlugin(),
      tailwindcss(),
      react(),
      babel({ presets: [reactCompilerPreset()] })
    ],
    resolve: {
      alias: {
        '#wallet-runtime': resolve(import.meta.dirname, 'src/web3/walletRuntime.js'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: devApiTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      sourcemap: true,
      modulePreload: {
        resolveDependencies: resolveModulePreloadDependencies,
      },
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (
                id.includes('@reown/appkit')
                || id.includes('@walletconnect')
                || id.includes('wui-')
              ) {
                return 'appkit'
              }
              if (id.includes('wagmi')) {
                return 'wagmi'
              }
              if (id.includes('ethers')) {
                return 'ethers'
              }
              if (id.includes('motion')) {
                return 'motion'
              }
            }
          },
        },
        /*
         * The root is the static marketing page; only /swap/ mounts the wallet.
         * /landing/ is a redirect fallback. Existing guide URLs stay unchanged.
         */
        input: {
          home: resolve(import.meta.dirname, 'index.html'),
          main: resolve(import.meta.dirname, 'swap/index.html'),
          landing: resolve(import.meta.dirname, 'landing/index.html'),
          faq: resolve(import.meta.dirname, 'landing/faq/index.html'),
          landingGasAssist: resolve(import.meta.dirname, 'landing/gas-assist/index.html'),
          gasAssist: resolve(import.meta.dirname, 'gas-assist/index.html'),
          walletGuide: resolve(import.meta.dirname, 'landing/wallet/index.html'),
          howItWorks: resolve(import.meta.dirname, 'landing/how-it-works/index.html'),
        },
      },
    },
    test: {
      // Browser integration tests use a deterministic hosted-compliance response
      // unless a specific test overrides fetch to exercise restricted/unavailable cases.
      // Package-local API Vitest invocations must not resolve this frontend-only setup
      // relative to apps/api.
      setupFiles: isFrontendTestRun
        ? [resolve(import.meta.dirname, 'src/test/setupComplianceFetch.js')]
        : [],
      // Keep collection anchored to workspace test locations while still
      // supporting package-local Vitest invocations such as `pnpm --filter
      // @pistachio/api exec vitest run test/...`.
      include: [
        'src/**/*.{test,spec}.{js,jsx,ts,tsx}',
        'apps/api/**/*.{test,spec}.{js,jsx,ts,tsx}',
        'packages/**/*.{test,spec}.{js,jsx,ts,tsx}',
        'test/**/*.{test,spec}.{js,jsx,ts,tsx}',
      ],
      exclude: ['**/node_modules/**', '**/dist/**', 'tests/playwright/**'],
    },
  }
})
