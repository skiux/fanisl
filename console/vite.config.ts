import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// base 走 /console/ 前缀：与知识引擎前端同源共存，nginx 只需加一个 location 块，
// cookie 会话因此不必跨站（见 deploy/nginx-fanisl.conf）。
export default defineConfig({
  base: '/console/',
  // shared/ 在仓库根，node 解析从那里往上找不到 react（各应用自己装的）。
  // 显式指到本应用的那一份，顺带保证不会打进两份 react。
  resolve: {
    alias: { react: r('node_modules/react'), 'react-dom': r('node_modules/react-dom') },
    dedupe: ['react', 'react-dom'],
  },

  plugins: [react(), tailwindcss()],
  // 登录页在仓库根的 shared/login/，两个应用共用一份。构建时 Rollup 顺着 import
  // 就能找到，但 dev server 默认只让读 root 以内，得显式放行上一层。
  server: { port: 5175, host: '127.0.0.1', fs: { allow: ['..'] } },
})
