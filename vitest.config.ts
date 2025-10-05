import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    deps: {
      inline: [/.*/],
    },
  },
  resolve: {
    alias: {
      'cloudflare:workers': path.resolve(__dirname, 'tests/shims/cloudflare-workers.ts'),
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      alias: {
        'cloudflare:workers': path.resolve(__dirname, 'tests/shims/cloudflare-workers.ts'),
      },
    },
  },
  ssr: {
    noExternal: true,
    resolve: {
      alias: {
        'cloudflare:workers': path.resolve(__dirname, 'tests/shims/cloudflare-workers.ts'),
      },
    },
  },
})
