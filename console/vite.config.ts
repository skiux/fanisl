import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base 走 /console/ 前缀：与知识引擎前端同源共存，nginx 只需加一个 location 块，
// cookie 会话因此不必跨站（见 deploy/nginx-fanisl.conf）。
export default defineConfig({
  base: '/console/',
  plugins: [react(), tailwindcss()],
  server: { port: 5175, host: '127.0.0.1' },
})
