import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const previewApi = process.env.FANISL_PREVIEW_API
const apiPrefixes = [
  'health', 'chat', 'price', 'watchlist', 'metrics', 'catalysts',
  'collection', 'conversations', 'trading', 'knowledge', 'research',
]
const previewProxy = Object.fromEntries(apiPrefixes.map((prefix) => [
  `/${prefix}`,
  { target: previewApi as string, changeOrigin: true },
]))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  preview: previewApi ? { proxy: previewProxy } : undefined,
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
