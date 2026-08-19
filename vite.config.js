import { resolve } from 'node:path'

import { defineConfig, loadEnv } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devApiTarget =
    env.PISTACHIO_DEV_API_TARGET?.trim() ||
    'http://localhost:3001'

  return {
    plugins: [
      tailwindcss(),
      react(),
      babel({ presets: [reactCompilerPreset()] })
    ],
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
              if (id.includes('wagmi') || id.includes('viem')) {
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
         * App plus static HTML pages. `index.html` stays the swap application
         * at `/`. Landing, FAQ, and Gas Assist build to `dist/landing/...` so
         * crawlers can read them without executing the wallet bundle.
         */
        input: {
          main: resolve(import.meta.dirname, 'index.html'),
          landing: resolve(import.meta.dirname, 'landing/index.html'),
          faq: resolve(import.meta.dirname, 'landing/faq/index.html'),
          gasAssist: resolve(import.meta.dirname, 'landing/gas-assist/index.html'),
        },
      },
    },
    test: {
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
