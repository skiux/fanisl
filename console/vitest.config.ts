import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // http.ts 用到 window.setTimeout / localStorage，需要 DOM 环境
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
