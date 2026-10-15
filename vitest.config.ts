import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // node:sqlite warns on Node 22; keep the output readable.
    env: { NODE_NO_WARNINGS: '1' },
  },
})
