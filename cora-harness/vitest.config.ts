import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// The harness source facade: this out-of-tree bundle resolves every
// `@deepseek-ai/*` import to the checkout's `src`, exactly like in-tree packages.
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['../tsconfig.base.json'] })],
  test: {
    include: ['tests/**/*.spec.ts'],
    pool: 'forks',
  },
})
