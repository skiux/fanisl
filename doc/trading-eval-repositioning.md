# 评测台重定位：按 setup 类型评 edge + Claude 角色收窄

> 落实 `doc/research/project-transformation.md` 的 C 项（§2 第 4 层 + §7）。2026-07-08 实现。
> 背景：18 个假设全部 KILLED/不可部署（见 `doc/research/research-log.md`），核心诊断 =
> 简单信号存在但 < 成本地板、绝对收益被 regime 支配。据此评测台不再评"单笔酌情判断"，
> 改评"setup 类型在 N 次里赚不赚"；Claude 从"盯 50 指标酌情判断"收窄为
> "读非结构化事件 + 受约束否决"。复用现有引擎/多账户架构，未重写。

## 架构（新增/改动）

```
playbook.py（新）        确定性探测器 + SetupSpec 注册表（含回测先验）+ 计划模板
     │ 触发（规则，非 Claude）
service.detect_setups    去重(活跃仓位/冷却) → 构造 TradePlan(代码) → 闸门 → 引擎执行
     │
trade_agent.gate_setup   Claude 闸门（收窄角色）：只判「干净实例 + 定性否决」，
     │                   输出 SetupGateDecision + event_annotations（结构化事件标注落库）
engine（复用）           新增 time_exit_hours 到时平仓、bh_r 配对基准、setup_key 透传
store                    新表 setup_signals / event_annotations；trades.setup_key；
                         scorecard_by_setup()（按 setup 聚合 + 信号漏斗 + 否决力）
```

## 关键设计决定（已确认）

1. **多基准对照 = 逐笔配对**（非模拟基准账户）：`trade_results.bh_r` = 同窗口同名义
   buy&hold 的 R（扣同费率双边手续费），与 `realized_r`/`counterfactual_r` 并列。
   随机进场期望解析地 = −成本，不模拟。配对统计功效高、零新运行部件。
2. **playbook 起步 = H7 TSMOM 7d，status=candidate**：唯一全判据 PASS 过的 setup，
   但 regime 依赖（两半检验上半 +2.15% / 下半 −0.27%）→ 只进纸面账户跑通
   live-vs-backtest 管道，不可当 edge 信任。BTC/ETH/SOL，0.5% 风险，7d 持有到时平仓。
3. **酌情模式降级不删**：`trading_scan_enabled` 默认 False（自主扫描停），
   手动 `/trading/open` 保留作对照组；main/forced/shadow 账户机制不动。
4. **veto 也要可评测**：被否决的实例按 setup 模板跟踪假想结果
   （`hypo_entry_price` + 持有期到期后校验净收益），`scorecard_by_setup` 出
   否决力（avoided_loss 率）——"受约束否决"这个新角色本身有成绩单。

## 数据流与单位约定

- `scorecard_by_setup().avg_net_return` = pnl/名义本金，与 `BacktestPrior.avg_net_return`
  同单位 → 直接对照 = 蓝图 Phase 4 的门（live 与回测先验无重大落差才算过）。
- `setup_signals` 是完整漏斗：触发 → confirmed/vetoed/skipped(容量)/error。
- `event_annotations` 是 §7 角色 2 的落点（"文档即数据"）：闸门读催化剂/新闻后产出的
  结构化标注，confirm 时也可产出，供未来喂回特征库。
- 探测器读行情库时点序列（复用 `research/pit.py` 的 asof 语义），数据陈旧 >2h 不触发。

## 运行

- 新评测账户 `setups`（managed=False：不参与酌情管理/复盘，出场由模板确定性执行）。
- trader 慢线程新增 job `trading_setups`（默认 3600s）：探测 + 到期 veto 校验。
- API：`GET /trading/setups`（注册表 + 按 setup 评分 + 信号流）、`POST /trading/detect`（手动触发）。
- 新增 setup：在 `playbook.py` 写 SetupSpec + 探测器（git 审阅，与 prereg 文档同源同纪律），
  先验数字从预注册回测抄入，不许拍脑袋。
