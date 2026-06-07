# fanisl frontend

对话式盘面分析助手的前端（Vite + React + TS + Tailwind）。
只有两块：顶部实时价格条（BTC/ETH/SOL/BNB，每 5s 轮询后端）+ 对话区（流式输出 + Markdown 渲染）。

## 运行

需要 Node 18+，并且**后端要先起来**（见 `../backend/README.md`）。

```bash
npm install
npm run dev        # http://localhost:5173
```

后端地址默认 `http://127.0.0.1:8000`，需要改就设环境变量：
```bash
VITE_API_BASE=http://127.0.0.1:8000 npm run dev
```

## 结构

```
src/
├── App.tsx                  # 布局：价格条 + 对话区
├── api.ts                   # streamChat(SSE 解析) + fetchPrices
├── types.ts
└── components/
    ├── PriceTicker.tsx      # 实时价格条（轮询 /price）
    ├── ChatView.tsx         # 对话状态机
    ├── MessageList.tsx      # 消息列表（助手回复走 MarkdownRenderer）
    ├── Composer.tsx         # 输入框（Enter 发送 / Shift+Enter 换行）
    └── MarkdownRenderer.tsx # 第三方组件（自带解析器 + prismjs 代码高亮）
```

## 关于流式

后端 `/chat/stream` 推 SSE：`start → status（正在获取 XX 行情）→ delta（文本片段）→ done`。
当前中转（aipro）对 tools+thinking 的真流式不稳，所以是**服务端逐字输出**（先整段生成、再切片吐字）。
换官方 Anthropic 后可改成真 token 流式，前端不用动。
