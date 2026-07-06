import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    host: true,
    proxy: {
      '/chat': 'http://localhost:3000',
      '/tasks': 'http://localhost:3000',
      '/events': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
    },
  },
})
