# Fanisl frontend

React、TypeScript、Vite 前端工程基线。

## Commands

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
```

开发服务默认使用 `http://127.0.0.1:8000` 作为后端地址。可通过 `VITE_API_BASE` 覆盖；生产同源部署时设为空字符串。

```bash
VITE_API_BASE=https://api.example.com npm run dev
VITE_API_BASE= npm run build
```

Playwright 首次运行前安装固定版本的 Chromium：

```bash
npx playwright install chromium
```

视觉差异只有在确认是预期改动后才更新：`npm run test:e2e:update`。基线按浏览器项目和操作系统保存；当前覆盖 1440×900 与 390×844。

生产同源联调使用已经构建的 `dist` 和显式 API 代理，不会默认运行：

```bash
FANISL_PREVIEW_API=http://127.0.0.1:8001 npm run preview -- --host 127.0.0.1 --port 5192
FANISL_LIVE_TEST=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:5192 \
  PLAYWRIGHT_SKIP_WEBSERVER=1 npx playwright test e2e/live-production.spec.ts --project=desktop-chromium
```

## Current structure

```text
src/
├── App.tsx                  首页空间叙事与真实知识搜索
├── Root.tsx                 hash 路由、按路由拆包与故障边界
├── features/                知识、验证、发现、档案工作区
└── shared/                  API 契约、导航与交互基础设施
e2e/                         Playwright 流程测试与视觉基线
```

后端契约参考 [`../api.md`](../api.md)，实现以 [`../backend/src/analyzer/main.py`](../backend/src/analyzer/main.py) 为准。测试使用确定性接口夹具，不替代联调环境对真实 PostgreSQL 数据和同源代理的终验。
