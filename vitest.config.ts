import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', 'src/jarvis/plugins/skills-hub/skills/**'],
  },
})
