# 共用登录页

两个应用（知识引擎 `/`、资产台 `/console/`）共用这一份。

原先各写了一个，长得还不一样——一套账号、一个域名，却有两扇不同的门。
哪一扇单看都不算错，**"有两扇"才是错的**。留下的是知识引擎那版：它在 `/`，
是产品的正面；登录是进这个系统，不是进其中某一个应用。

| 文件 | 说明 |
|---|---|
| `LoginPage.tsx` | 组件。不认识任何一个应用的 session 模块 |
| `login.css` | 令牌在 `.auth-screen` 上就地定义，不依赖任何应用的全局样式表 |

## 调用方注入两件事

```tsx
<LoginPage messageOf={messageOf} onLogin={login} />
```

- `onLogin(username, password)` — 成功即可，失败抛错
- `messageOf(error)` — 把异常翻成一句话；返回 `null` 表示"不是接口错误"，走兜底文案

控制台与知识引擎各有自己的 `ApiError` 与 API 客户端。共享组件要是自己去 import，
就得同时依赖两套；注入之后它对两边一无所知。

## 构建上的两处配置

`shared/` 在仓库根，不在任何一个应用的 root 之内，所以两边都要：

1. **`server.fs.allow: ['..']`** — dev server 默认只让读 root 以内。构建时 Rollup
   顺着 import 就能找到，只有 dev 需要放行。
2. **`resolve.alias` 把 react 指到本应用的那一份** — node 解析从 `shared/` 往上找不到
   react（两个应用各自装的）。`tsconfig.app.json` 里对应的是 `paths`，指向
   `@types/react`（类型），`include` 里也要加上 `../shared`。

## 两条刻意的克制

**不提示"用户名不存在"还是"口令错误"。** 后端两种情况返回同一句话、耗时也一致，
前端要是自作聪明拆开显示，就把后端特意堵上的用户名枚举信道又打开了。

**没有"注册"和"忘记口令"。** 用户由管理员在控制台里建；口令忘了找管理员重置。
三五个人的工具，邮件找回通道是纯负担。

## 测试

`console/src/lib/single-login.test.ts` 扫全仓库，断言 `LoginPage.tsx` 只有这一个。
这条守的就是上面那句"有两扇才是错的"。
