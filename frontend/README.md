# Fanisl frontend

React、TypeScript、Vite 前端工程基线。

## Commands

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run build
```

开发服务默认使用 `http://127.0.0.1:8000` 作为后端地址。可通过 `VITE_API_BASE` 覆盖；生产同源部署时设为空字符串。

```bash
VITE_API_BASE=https://api.example.com npm run dev
VITE_API_BASE= npm run build
```

## Current structure

```text
src/
├── App.tsx                  temporary application entry
├── main.tsx                 React bootstrap
├── index.css                minimal global styles
└── shared/
    ├── api/client.ts        fetch and API error boundary
    └── config/env.ts        environment configuration
```

路由、服务端状态、图表、组件库和产品目录暂未选型。后端契约参考 [`../api.md`](../api.md)，实现以 [`../backend/src/analyzer/main.py`](../backend/src/analyzer/main.py) 为准。
