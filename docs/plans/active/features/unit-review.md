# 单元核查：站上提意见 → 知识席位答复、修改、复盘

立于 2026-09-13。**知识席位的部分已完成**，等 base 与 frontend。

## 0. 要解决的事

用户在站上读一条单元，觉得提取有问题（quote 断章取义、分级判错、评分规格不对、
标的错、结论表述加了原文没有的推论），要能**就在单元详情里**写下意见；知识席位
（Claude 会话）之后逐条审查，给出答复，需要时修改单元，并把"为什么会错、同类还有没有"
写清楚；用户在站上看到答复，认可就关闭，不认可就接着回复。

## 1. 已定的决定

1. **不并入 `spot_checks`。** 那张表是 extraction-guide §10 的随机抽样；核查对象是用户
   挑出来的，混进去会让抽查的忠实率失去随机性。
2. **答复只走知识席位的 CLI，不开 HTTP。** 站上的写操作只有"提交 / 回复 / 关闭"三个，
   站上没有任何路径能以知识席位的身份发言。
3. **"复盘"由代码强制，不靠自觉。** 答复结论为 `fixed` 时：
   - 必须先有挂在这条核查下的修改记录（说改了就得真改了）；
   - `root_cause`（为什么会错）与 `sweep`（同类单元查了哪些、结果如何）必填，缺一个拒收。
4. **单元修改一律留痕**（`unit_amendments`：改前 / 改后 / 原因），并重跑导入的两道闸：
   pydantic 载荷校验、quote 须逐字出自原文。**已有评分记录的单元不许改评分相关字段**——
   评分器只认冻结的 spec，改了之后历史评分对不上单元。
5. **v1 只做单元粒度。** 对整期内容"漏提了什么"的意见不在这一版。

## 2. 数据模型（已建，`backend/fanisl/knowledge/store.py`）

三张表随 `KnowledgeStore` 初始化自动创建，**部署后 API 第一次启动即建好，无需迁移步骤**。

| 表 | 作用 |
|---|---|
| `unit_reviews` | 一条核查：`unit_id` `category` `status` `created_by` `created_at` `updated_at` `closed_at` |
| `unit_review_messages` | 对话串：`role`（`reviewer` 站上用户 / `extractor` 知识席位）`author` `body` `resolution` |
| `unit_amendments` | 修改留痕：`unit_id` `review_id` `before` `after` `reason` `author` |

**状态流转**（store 强制）：

```
提交 ──▶ open ──知识席位答复──▶ answered ──用户关闭──▶ closed
          ▲                          │                  │
          └──────用户回复（重新打开）──┴──────────────────┘
```

- `open` = 知识席位的待办；`answered` = 用户的待确认。
- 只能答复 `open` 的；已关闭的再关闭报冲突；用户在 `answered` / `closed` 上回复会重新打开。

**枚举与中文标签**（前端显示用）：

| 字段 | 值 → 标签 |
|---|---|
| `category` | `quote` 原句 · `grade` 分级 · `scoring` 评分规格 · `asset` 标的与标签 · `statement` 结论表述 · `other` 其他 |
| `status` | `open` 待知识席位答复 · `answered` 待你确认 · `closed` 已关闭 |
| `role` | `reviewer` 你 · `extractor` 知识席位 |
| `resolution.outcome` | `fixed` 已修改 · `no_change` 维持原判 · `needs_info` 需要你补充 |

## 3. 知识侧已交付

**store 方法**（base 直接调用，不要在接口层重复实现校验——store 是唯一口径）：

| 方法 | 用途 |
|---|---|
| `reviews_for_unit(unit_id) -> list[dict]` | 某单元的全部核查，新的在前；每条带 `messages` 与 `amendments` |
| `create_review(unit_id, *, category, body, author) -> dict` | 提交，返回完整核查 |
| `add_review_message(review_id, *, body, author) -> dict` | 用户回复（会重新打开） |
| `close_review(review_id) -> dict` | 用户关闭 |
| `list_reviews(*, status=None, limit=100) -> list[dict]` | 队列，带单元摘要（`kind` `content_id` `quote` 前 80 字 `verifiability` `creator` `n_messages` `last_message`） |
| `review_detail(review_id) -> dict \| None` | 单条核查 |

`answer_review` 与 `amend_unit` **只给 CLI 用**，接口层不要暴露。

返回的核查对象形如：

```json
{
  "id": 12, "unit_id": 1518, "category": "grade", "status": "answered",
  "created_by": "mur", "created_at": "…", "updated_at": "…", "closed_at": null,
  "messages": [
    {"id": 30, "role": "reviewer", "author": "mur", "body": "…", "resolution": null, "created_at": "…"},
    {"id": 31, "role": "extractor", "author": "claude-session", "body": "…", "created_at": "…",
     "resolution": {"outcome": "fixed", "root_cause": "…", "sweep": "…", "followup": null}}
  ],
  "amendments": [
    {"id": 4, "unit_id": 1518, "reason": "…", "author": "claude-session", "created_at": "…",
     "changed": ["payload.asset_text"], "before": {"quote": "…", "payload": {}, "tags": []},
     "after": {"quote": "…", "payload": {}, "tags": []}}
  ]
}
```

**异常约定**：`ValueError` → 400，`LookupError` → 404，`ReviewConflict`
（`from fanisl.knowledge.store import ReviewConflict`）→ 409。`detail` 直接用异常消息，已是中文。

**CLI**：`python -m fanisl.knowledge.review list | show | amend | answer`，处理纪律见
`backend/fanisl/knowledge/AGENTS.md`。测试：`backend/tests/test_unit_review.py`。

## 4. 给 base 的请求

**先改 `backend/api.md`（新增 §5.6 单元核查），再写代码。** 这是知识域第一个写接口。

| 方法 | 路径 | 调用 | 权限 |
|---|---|---|---|
| GET | `/knowledge/units/{unit_id}/reviews` | `knowledge_store.reviews_for_unit(unit_id)` | 登录 |
| POST | `/knowledge/units/{unit_id}/reviews`，体 `{category, body}` | `create_review(...)` | **admin** |
| POST | `/knowledge/reviews/{review_id}/messages`，体 `{body}` | `add_review_message(...)` | **admin** |
| POST | `/knowledge/reviews/{review_id}/close` | `close_review(review_id)` | **admin** |
| GET | `/knowledge/reviews?status=&limit=` | `list_reviews(status=, limit=)` | 登录 |

鉴权要点：

- **`author` 一律取 `request.state.user["username"]`，请求体里即使带了也忽略。**
- 写接口要求 `role=admin`，否则 403。`main.py` 已有 `_is_admin(request)`，
  `auth/routes.py` 已有 `current_user(request)`（取不到就 401）。
  理由：核查会驱动知识席位修改生产库里的单元，v1 只让管理员提交。
- 写接口必须是 POST。会话 cookie 是 `SameSite=Lax`，跨站 POST 不会带 cookie，
  这就是现有的 CSRF 防线；**不要为了方便开 GET 形式的写操作**。
- **不要开答复接口。** `role=extractor` 的消息只能由 CLI 写入。
- 本机 `AUTH_ENABLED=false` 时注入的 `DISABLED_USER` 是 admin，写接口可以直接测。

要有的接口测试：未登录 401、member 403、admin 成功且 `created_by` 取自会话而非请求体、
三类异常分别映射 400 / 404 / 409。

## 5. 给 frontend 的请求

**先读 `backend/api.md` §5.6**（base 提交后即有；接口上线前可以先用 fixture 开发）。

1. **位置**：`frontend/src/features/knowledge/EvidenceDossier.tsx` 的 tablist 现有三个 tab
   （`activeView: 'structure' | 'verdict' | 'source'`，即 结构化结论 / 市场裁决 / 原文上下文），
   加第四个 **`'review'`「核查」**，计数显示该单元**未关闭**的核查数。
   `EvidenceDossier` 也被 `DiscoveryDossier` 与 `VerificationDossier` 内嵌，所以任何地方打开
   单元都能看到这个 tab。
2. **列表**：该单元的全部核查，新的在前。每条显示状态、类别、对话串（区分"你"与"知识席位"）。
   知识席位的答复要把 `resolution` 的 `outcome` / `root_cause` / `sweep` / `followup`
   **原样展示，不要折叠成一句话**——复盘内容是这个功能的价值所在。
   有修改记录的，显示 `changed` 字段清单与改前 → 改后。
3. **提交**：类别选择 + 文本框（上限 4000 字）→ POST，成功后刷新。
4. **回复与关闭**：`answered` 的核查提供「回复」（会重新打开）与「关闭」。
5. **待确认入口**：知识席位答复后用户要能发现。用 `GET /knowledge/reviews?status=answered`
   做一个最小入口（位置由 frontend 定），点进去打开对应单元的核查 tab。没有它，
   用户只能逐个单元去翻，这个闭环就断了。
6. **错误**：400 / 404 / 409 显示接口的 `detail`；403 显示"需要管理员权限"。

按 `frontend/AGENTS.md`：开 dev server 看页面、截图确认，再报告完成。

**落地（2026-09-14）**：
- 面板在 `frontend/src/features/knowledge/UnitReviews.tsx`，调用与类型在 `reviews.ts`。
  tab 计数在打开单元时就取，不等点进「核查」。
- 待确认入口放在**顶栏**（`shared/navigation/ReviewInbox.tsx`），不放知识库里：日常入口是标的页，
  答复要在每天都会经过的地方露头。只对 admin 显示，没有待确认时整个入口不渲染。
- 直达链接 `#/knowledge?unit={id}&view=evidence&tab=review&review={id}`，落在那条核查上。
- 成员（member）能看核查与答复，不给提交、回复、关闭的按钮；后端 403 仍是真正的闸，界面上一律显示
  "需要管理员权限"。

## 6. 交接顺序与验收

| 步 | 席位 | 做什么 | 完成标志 |
|---|---|---|---|
| 1 | knowledge | 表、store 方法、CLI、测试、文档 | **已完成** |
| 2 | base | api.md §5.6 → 接口 → 鉴权 → 测试 → 推送 | `pytest` 全绿，线上 `/health` 200 |
| 3 | frontend | 核查 tab + 待确认入口 | `npm run test && npm run typecheck`，截图 · **已完成**（2026-09-14，夹具验收；真接口待 base 推送上线后看一次） |
| 4 | 用户 | 在站上对一条真实单元提交核查 | `review list` 能看到 |
| 5 | knowledge | `review show` → 需要时 `amend` → `answer` | 站上显示答复与修改记录，用户可关闭 |

整体验收：member 账号写接口 403；未登录 401；站上没有任何途径写出 `extractor` 消息；
`outcome=fixed` 的答复都能在站上看到对应的修改记录。

## 7. 不在 v1

- 对整期内容"漏提"的意见（v1 只到单元粒度）
- 通知（邮件 / 推送）——靠第 5 节的待确认入口
- 核查与 `spot_checks` 的统计合并——有意分开，见第 1 节
- 修改后同步 `data_export/knowledge_units/*.json`——有意不同步：JSON 是入库那一刻的快照，
  修改的真相在 `unit_amendments`；同版本重复导入会被拒，修改不会被 JSON 冲掉
- 答复的撤回与编辑
