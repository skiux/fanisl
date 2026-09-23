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
├── features/                标的、知识（含单元核查）、验证、发现、档案工作区
└── shared/                  API 契约、枚举中文标签（domain/labels.ts）、导航与交互基础设施
e2e/                         Playwright 流程测试与视觉基线；api-fixture.ts 是全部接口的夹具
```

颜色、字体、页面宽度与页头只在 `src/index.css` 的 `:root` 与"应用页面共用"一节定义（`.app-page`、`.page-head`、
`.page-tabs`、`.page-stats`、`.chips`、`.field-search`、`.btn`），五个应用页面都用这一套，不再各写一份，
约定见 `AGENTS.md`「Visual system」。

枚举的中文标签只写在 `src/shared/domain/labels.ts`，`labels.test.ts` 逐条对照
`docs/DOMAIN.md` §4 与 `backend/api.md` §5.6——文档改了标签没跟，测试会红。

单元核查的写接口（提交、回复、关闭）**不要对本机 API 点**：`backend/.env` 的知识库连的是生产隧道。
这几个接口的状态流转与错误码在 `e2e/api-fixture.ts` 里按契约实现，`e2e/unit-review.spec.ts` 用它验。

验证页（`src/features/verification/`）**整页不滚动**，由两部分组成：
- 判决时间轴（`Timeline.tsx`）：全部记录按到期日一天一根，以今天为界，命中往上、未中往下，需复核、不可判与
  即将到期压在轴线上。它是全局缩略图，比例尺按未筛选的全量定，切图例时不跳。
- 放大镜：下面一屏卡片按时间顺序铺满（几列几行由卡片区实测尺寸与卡片最小高度定，原话按卡片高度露几行），可以跨好几天；
  卡片只放结果、标的、日期、原话（衬线体）与信源，方向与价位留给浮层；
  时间轴上用一块高亮标出这一屏覆盖的日期，高亮到卡片区之间有一道渐隐的光束。「更早 / 更晚」整屏移动，
  点时间轴某天、键盘左右键或用鼠标按住拖动，窗口移到那天。默认停在"截至今天的最近一屏结果"。

图例兼作筛选（点一类就在轴和卡片里一起隐去），搜索与信源同时作用于两处。点卡片在浮层里看记录（判定标准、
实测数字、价格图、评分阶梯），← → 逐条看，窗口跟着走。地址：`?day=` 是窗口起点，`?score=` / `?due=&horizon=`
打开浮层，全部用 replaceState，不堆历史。四个分类（已判定 / 即将到期 / 需复核 / 不可判）进页时一起取；
即将到期固定取 365 天。即将到期的记录不画价格：结果还没发生，不拿正在变的行情提前解释。
分类、按天汇总、默认窗口与地址解析在 `records.ts`，有单测。

e2e 的时钟钉在 `FIXTURE_NOW`（`e2e/api-fixture.ts`）。夹具里的日期都从它推，不要用 `Date.now()`，
否则截图基线里的"21 天后"之类的日期每天都在变。

标的工作台的后端前缀是**单数 `/asset`**：Vite 把构建产物放在 `/assets/index-*.js`，
`/assets` 被当成 API 前缀会让前端 JS/CSS 被代理走、页面白屏。`vite.config.ts` 的 preview
代理因此用正则键 `^/asset(/|$)` 而不是字符串前缀键。

后端契约参考 [`../api.md`](../backend/api.md)，实现以 [`../backend/fanisl/main.py`](../backend/fanisl/main.py) 为准。测试使用确定性接口夹具，不替代联调环境对真实 PostgreSQL 数据和同源代理的终验。
