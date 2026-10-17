import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    // `app/**` is here because it was missing: the colocated /api/v1 route tests existed and had
    // never once run. A test that cannot fail is worse than no test — it reads as coverage.
    include: [
      'lib/**/*.{test,spec}.{ts,tsx}',
      'tests/**/*.{test,spec}.{ts,tsx}',
      'app/**/*.{test,spec}.{ts,tsx}',
      'demo-widget/**/*.{test,spec}.{ts,tsx}',
      'packages/*/test/**/*.{test,spec}.ts',
    ],
    globals: false,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // The open fund engine (packages/fund-engine), consumed from source as tsconfig.json maps it.
      '@portfolio/fund-engine': path.resolve(__dirname, 'packages/fund-engine/src/index.ts'),
    },
  },
})
