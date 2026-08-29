import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const previewApi = process.env.FANISL_PREVIEW_API
const apiPrefixes = [
  'health', 'chat', 'price', 'watchlist', 'metrics', 'catalysts',
  'collection', 'conversations', 'trading', 'knowledge', 'research',
]
const proxyTarget = { target: previewApi as string, changeOrigin: true }
const previewProxy = {
  ...Object.fromEntries(apiPrefixes.map((prefix) => [`/${prefix}`, proxyTarget])),
  // 标的工作台**必须用正则**：字符串键是前缀匹配，`/asset` 会把构建产物 `/assets/*.js`
  // 一起代理到后端，preview 直接白屏。以 ^ 开头的键被 Vite 当作 RegExp。
  '^/asset(/|$)': proxyTarget,
}

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
