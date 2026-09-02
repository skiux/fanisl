# 登录与用户管理

给 `fanisl` 的全部 HTTP 接口加一道门。规模是 2~3 个成员 + 1 个管理员，
**共用同一个 Binance 只读账户**——用户系统解决的是"谁能看"，不是"看谁的"。

## 形态

```
浏览器 ──cookie(fanisl_session)──► nginx(HTTPS) ──► uvicorn
                                                     │
                                          CORSMiddleware      ← 最外层
                                          AuthMiddleware      ← 默认拒绝
                                                     │
                                             62 条业务路由
```

三张表落在主库 `fanisl`（与对话表同池）：

| 表 | 内容 |
|---|---|
| `users` | 用户名（小写归一）、口令散列、角色、是否启用 |
| `sessions` | token 的 **sha256**、归属、创建/最后活动/绝对过期、UA 与 IP |
| `login_attempts` | 登录成败流水，只用于限速；collector 每天清 30 天前的 |

## 五个不是随手定的决定

**① 中间件，不是每条路由挂 `Depends`。**
现在 65 条路由，还会加。靠"记得给新路由加依赖"来保证安全，等于把安全性押在不会忘上——
忘一次就是一个洞，而且没人会发现。中间件是**默认拒绝**：新路由自动受保护，要放行必须
显式写进白名单，方向反过来了。白名单只有三条，见 `session.py`。

**② 纯 ASGI 中间件，不是 `BaseHTTPMiddleware`。**
这个 app 有 SSE（`/chat/stream`）。`BaseHTTPMiddleware` 把响应包进 anyio 任务组，
历史上与流式响应、客户端断连有一堆边角问题。纯 ASGI 只在请求进来时看一眼 cookie，
之后原样透传。

**③ 会话 token 只存 sha256。**
库被拖走时攻击者拿到的是散列，不能直接当 cookie 用。明文只在登录响应的 `Set-Cookie`
里出现一次。

**④ 口令用 stdlib 的 scrypt，不引入 argon2-cffi / bcrypt。**
两者都是编译扩展，而这台服务器的部署方式是 venv + `git pull`（见 `deploy/README.md`），
多一个编译依赖就多一处升级摩擦。scrypt 是内存硬 KDF、OpenSSL 实现、随 Python 一起来，
抗 GPU 爆破的性质与 argon2 同一量级。参数 `n=2**15, r=8, p=1`（32 MiB / 本机 77 ms），
写进散列串里，将来调参不必迁移旧口令。

**⑤ CSRF 靠 `SameSite=Lax`，不额外发 token。**
Lax 的语义是：跨站的**顶层 GET 导航**会带 cookie，跨站的 POST/PATCH/DELETE **不带**。
状态变更全在后者，所以 CSRF 的入口本身就被浏览器堵死了。再叠一层 CSRF token 是重复投保，
代价是每个前端都要多管一个东西。cookie 同时带 `HttpOnly`（XSS 偷不走）与 `Secure`（只走 HTTPS）。

## 接口

`/auth/login` 与 `/auth/logout` 免登录（后者做成幂等：会话已失效时再点一次不该报错）。
其余全部需要会话，未登录一律 `401 {"detail": "未登录或会话已过期"}`——前端据此跳登录页。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/login` | `{username, password}` → 种 cookie，返回 `{user}` |
| POST | `/auth/logout` | 销毁会话并清 cookie |
| GET | `/auth/me` | 当前用户 |
| POST | `/auth/password` | `{current_password, new_password}`，改完踢掉**别处**的会话，自己续上 |
| GET | `/auth/sessions` | 自己的会话列表（时间/UA/IP） |
| DELETE | `/auth/sessions` | 撤销自己全部会话（含当前） |
| GET | `/admin/users` | 🔑 用户列表 |
| POST | `/admin/users` | 🔑 建用户 `{username, password, role?, display_name?}` |
| PATCH | `/admin/users/{id}` | 🔑 改 `role` / `is_active` / `display_name` |
| POST | `/admin/users/{id}/password` | 🔑 重置口令（该用户全部会话作废） |
| DELETE | `/admin/users/{id}` | 🔑 删用户 |

🔑 = 需要 `role=admin`，否则 403。

**会连带踢会话的操作**：改口令、重置口令、停用、改角色。理由是同一条——权限或凭据变了，
旧 cookie 就不该继续作数。改显示名不踢。

**几条不许做的事**（返回 409）：停用或降级最后一个管理员、删除最后一个管理员、
停用自己、删除自己。留一个人进得去管理面。

## 限速

窗口 15 分钟内、且在**最近一次成功登录之后**的失败次数：同一用户名 ≥5、或同一 IP ≥20
就返回 429。"最近一次成功之后"这一条是必要的——否则白天输错几次，晚上再登会被自己的
历史挡在门外。

来源 IP 只认 nginx 设的 `X-Real-IP`，**不认 `X-Forwarded-For`**：后者客户端可以伪造并
追加，拿它分桶等于让攻击者自己挑桶。

用户名不存在与口令错误返回**同一个** 401 文案，且两条路径都跑一次口令散列——
否则响应时间的差异就是一条可用的用户名枚举信道。

## 开第一个管理员

系统里一个用户都没有时，没有任何 HTTP 路径能建出管理员（`/admin/users` 自己就要求管理员
身份）。这是有意的：不留"首次访问自动成为管理员"那种后门，否则从服务上线到你打开浏览器
之间的任何时刻，谁先到谁就是管理员。

```bash
# 在服务器 backend/ 目录下
.venv/bin/python -m analyzer.auth.bootstrap alice
```

口令从终端交互读入，不走命令行参数——参数会留在 shell history 和 `ps` 输出里。
之后的用户由管理员在 `/admin/users` 建。

## 配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `AUTH_ENABLED` | `true` | 应急开关。**默认开**：失手推上去时降级成"全站 401"（可用性故障，改回来就好），而不是"全站敞开"（安全故障，且没人会发现） |
| `AUTH_COOKIE_SECURE` | `true` | 本机 http 调试时设 `false`，否则浏览器不回传 cookie |
| `AUTH_SESSION_DAYS` | `30` | 会话绝对上限 |
| `AUTH_IDLE_DAYS` | `14` | 闲置多久算过期 |
| `AUTH_MAX_FAIL_USER` / `AUTH_MAX_FAIL_IP` | `5` / `20` | 限速阈值 |
| `AUTH_MIN_PASSWORD_LEN` | `10` | 口令最短长度 |
| `CORS_ORIGINS` | 两个本机开发端口 | 带 cookie 的跨源请求不允许 `*`，必须列具体来源。线上同源，这项只对本机开发有意义 |

## 测试

`backend/tests/test_auth.py`。分两层：

- **门本身**：用一个最小 app（一条受保护路由 + 真正的中间件），验登录、限速、
  会话失效、角色、各种 409 边界。
- **门装在了整栋楼上**：`test_every_real_route_is_closed_without_login` 把
  `analyzer.main` 里注册的**每一条**路由都打一遍，逐条断言未登录不可达。
  这条测试递归走进 `include_router`——FastAPI 0.141 不再把子路由摊平进 `app.routes`，
  只遍历顶层会静默漏掉整组，而漏检在安全断言里等于假通过。

另有 `tests/test_startup.py`：**起独立进程**验 `analyzer.main` 能 import
（同进程 import 一次就缓存了，验不出东西）。runtime 在模块级就建连接池与客户端，
构造期的任何异常都等于全站 502，而 nginx 只会给一句 Bad Gateway。

```bash
PYTHONPATH=src .venv/bin/python -m pytest tests/test_auth.py tests/test_startup.py -q
```
