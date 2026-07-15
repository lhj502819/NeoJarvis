import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['desktop/tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'desktop/agent/jarvis/plugins/skills-hub/skills/**'],
  },
})
