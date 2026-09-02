import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

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
  // shared/ 在仓库根，node 解析从那里往上找不到 react（各应用自己装的）。
  // 显式指到本应用的那一份，顺带保证不会打进两份 react。
  resolve: {
    alias: { react: r('node_modules/react'), 'react-dom': r('node_modules/react-dom') },
    dedupe: ['react', 'react-dom'],
  },

  // 见 console/vite.config.ts：共用的登录页在仓库根的 shared/ 下
  server: { fs: { allow: ['..'] } },
  preview: previewApi ? { proxy: previewProxy } : undefined,
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
