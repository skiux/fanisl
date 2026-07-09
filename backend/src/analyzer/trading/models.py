"""交易评测台的数据形状（pydantic）。

三类是 **Claude 必须产出的结构化提交**（进场 TradePlan / 不交易 DeclineDecision /
持仓调整 Adjustment / 复盘 Review），由 agent 的终结工具校验。其余是引擎/存储内部用的轻量结构。
账户/交易/持仓等数据库行用 dict 流转（见 store），不在这里建模。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Side = Literal["long", "short"]
TradeStatus = Literal["planned", "open", "closed", "cancelled"]
StrategyType = Literal["trend", "mean_reversion", "breakout", "event_driven", "carry", "other"]
EntryType = Literal["market", "limit"]
SlType = Literal["hard", "trailing"]
Regime = Literal["trend", "range", "unknown"]
ExitReason = Literal["tp", "sl", "liquidation", "manual", "thesis_invalidated", "time_stop"]
Outcome = Literal["win", "loss", "breakeven"]
AdjustAction = Literal["hold", "move_sl", "partial_exit", "add", "close"]
# 技能/运气四象限：判断对错 × 盈亏
SkillLuck = Literal[
    "right_judgment_profit",  # 判断对 + 赚（真本事）
    "right_judgment_loss",    # 判断对 + 亏（运气差/黑天鹅）
    "wrong_judgment_profit",  # 判断错 + 赚（运气好，危险）
    "wrong_judgment_loss",    # 判断错 + 亏（该认的错）
]


# --- 进场提交：决策依据 + 交易计划 ---------------------------------------

class TpTarget(BaseModel):
    price: float = Field(description="止盈目标价")
    reduce_pct: float = Field(description="到此目标平掉仓位的百分比 0~100")


WakeType = Literal[
    "price_above", "price_below",       # mark 价穿越某位
    "pnl_pct_above", "pnl_pct_below",   # 未实现盈亏(占保证金%)穿越
    "time_elapsed_hours",               # 开仓后经过 N 小时
]


class WakeCondition(BaseModel):
    """Claude 自己声明的「在什么条件下唤醒我重评」。引擎确定性监测，命中即触发重评。

    都用 mark 价 / 未实现盈亏% / 持仓时长 这些引擎能直接算的量，便宜、精确、可审计。
    """
    type: WakeType
    value: float = Field(description="阈值：价格 / 盈亏百分比 / 小时数")
    note: str | None = Field(default=None, description="为什么盯这个条件")


class MtfAnalysis(BaseModel):
    """多周期分析：大周期方向 / 交易周期结构 / 入场周期信号 / 是否共振。"""
    higher_tf: str = Field(description="大周期方向（日线/4H 趋势与结构）")
    trading_tf: str = Field(description="交易周期结构（1H）")
    entry_tf: str = Field(description="入场周期信号（15m 触发形态）")
    aligned: bool = Field(description="三个周期是否共振（方向一致）")


class TradePlan(BaseModel):
    """进场计划。仓位与盈亏比由引擎按风险%和止损距离反推/核算，这里给依据与点位。

    两类来源：Claude 酌情提交（分析字段应填全，提示词里仍是强制要求），或 playbook 按
    setup 模板确定性构造（带 setup_key，分析字段留空——机器计划不伪造酌情分析）。
    """
    symbol: str
    side: Side
    strategy_type: StrategyType
    thesis: str = Field(description="一句话能说清的交易逻辑/理由")

    setup_key: str | None = Field(
        default=None,
        description="来自 playbook 哪个 setup（None=酌情交易）。评测按 setup 聚合 edge 的关联键。",
    )

    mtf: MtfAnalysis | None = Field(default=None, description="多周期分析（酌情交易必填）")
    macro_context: str | None = Field(default=None, description="相关宏观/基本面背景")
    risk_events: str | None = Field(default=None, description="临近的风险事件（数据/会议/解锁），无则写无")
    regime: Regime = Field(default="unknown", description="当前是趋势市还是震荡市")
    risk_appetite: str | None = Field(default=None, description="整体风险偏好 risk-on/off 与相关资产在做什么")

    entry_type: EntryType
    entry_price: float = Field(description="进场价位（市价单也给参考价）")
    entry_trigger: str = Field(description="进场触发条件")

    leverage: float = Field(description="杠杆倍数")
    risk_pct: float = Field(description="本笔最多亏总权益的百分比")

    sl_price: float = Field(description="止损价位")
    sl_basis: str = Field(description="止损依据（结构破位/百分比/ATR倍数）")
    sl_type: SlType = "hard"

    invalidation_price: float | None = Field(
        default=None,
        description="结构失效价：价格穿越即说明这笔的逻辑已被证伪，引擎会确定性平仓（不等你重评）。"
        "通常设在硬止损内侧——失效位是'逻辑错了'，硬止损是'最后防线'。无清晰结构失效位则留空。",
    )

    tp_targets: list[TpTarget] = Field(description="一个或多个止盈目标及各自减仓比例")

    expected_holding_hours: float | None = Field(
        default=None,
        description="预期持有时长（小时）。引擎据此用 ATR 校验 TP1 在该时长内结构上是否可达——"
        "目标要真实，别为凑盈亏比把止盈画到够不着的地方。",
    )
    entry_ttl_hours: float | None = Field(
        default=None,
        description="限价单有效期（小时），仅 limit 单用。超时未成交引擎自动撤单作废（论点会过期）。"
        "按入场周期定，如 15m 入场通常 2~8h。留空用引擎默认。",
    )
    time_exit_hours: float | None = Field(
        default=None,
        description="持仓到此小时数引擎确定性平仓（exit_reason=time_stop）。setup 模板的主要出场方式"
        "（长 horizon 持有到期），酌情交易一般留空。",
    )

    wake_conditions: list[WakeCondition] = Field(
        default_factory=list,
        description="希望在哪些条件下被唤醒重评（价穿位/盈亏到阈值/到时）。空=只靠引擎默认(逼近止损止盈)兜底。"
        "价格唤醒位放在结构位（确认/失效位，一般距入场 ≥0.8R），别设在噪声里；"
        "time_elapsed_hours 是一次性检查点（如 24h 还没动就重估），不是轮询周期。",
    )

    confidence_pct: float | None = Field(
        default=None,
        description="主观胜率/信心 0~100，会与实际胜率做校准对比，所以要诚实拉开差异、别老写中间值。"
        "参考锚点：<45 信号太弱就不该提交计划；45~55 勉强；55~65 良好；>65 强信号。",
    )
    notes: str | None = None


class ScanCandidate(BaseModel):
    symbol: str
    reason: str = Field(description="为什么这个标的值得做完整分析")


class ScanResult(BaseModel):
    """自主扫描的 triage 结果：从全标的精简摘要里挑出值得做完整分析的候选（宁缺毋滥）。"""
    candidates: list[ScanCandidate] = Field(
        default_factory=list, description="值得进一步完整分析的标的；没有就留空"
    )
    market_note: str | None = Field(default=None, description="对当前全局盘面的一句话观察")


class DeclineDecision(BaseModel):
    """Claude 决定不交易——也是要评测的判断（避免过度交易）。"""
    symbol: str
    reason: str = Field(description="为什么这笔不该做")
    watch_for: str | None = Field(default=None, description="出现什么条件会让你重新考虑")
    recheck_after_hours: float | None = Field(
        default=None,
        description="多少小时后值得重新评估这个标的（引擎到期会用行情自动校验这次拒绝对不对）。",
    )
    bias_if_forced: Side | None = Field(
        default=None,
        description="若被强制必须做，你会选哪个方向（long/short）。用于评测'拒绝'判断的质量——"
        "拒绝后价格若朝你的 bias 反方向走说明拒绝是对的。无明确方向可留空。",
    )


# --- 持仓中调整 -----------------------------------------------------------

class Adjustment(BaseModel):
    action: AdjustAction
    reason: str
    thesis_still_valid: bool = Field(description="原始逻辑是否还成立（不成立应退出）")
    new_sl_price: float | None = Field(default=None, description="move_sl 时的新止损")
    reduce_pct: float | None = Field(
        default=None,
        description="partial_exit 时减仓百分比 0~100，按**当前剩余仓位**算（如剩余 80% 仓再减 50% = 减到 40%）。",
    )
    add_qty_pct: float | None = Field(default=None, description="add 时加仓量（占原仓位%）")
    wake_conditions: list[WakeCondition] | None = Field(
        default=None, description="重设唤醒条件（None=沿用原计划的）",
    )


# --- 手动镜像（用户把实盘交易录进评测台，Claude 不介入）--------------------

class ManualPlan(BaseModel):
    """手动账户的精简进场提交：用户实盘怎么下的这里怎么记，引擎照常撮合/核算/评测。

    setup_key = 用户自己的 setup 标签（如 'eia_fade'/'breakout_pullback'），
    scorecard_by_setup 按它聚合——量化"我的哪类 setup 有 edge"。
    """
    symbol: str
    side: Side
    setup_key: str = Field(description="你自己的 setup 标签（按类型聚合评测的键）")
    entry_type: EntryType = "market"
    entry_price: float = Field(description="进场价（market 也填参考价；limit 按此价挂单）")
    sl_price: float
    tp_price: float | None = Field(default=None, description="止盈目标；留空=只靠止损/手动平")
    risk_pct: float = Field(default=1.0, description="本笔风险占权益%")
    leverage: float = Field(default=2.0)
    thesis: str | None = Field(default=None, description="一句话逻辑（可选，便于复盘）")

    def to_trade_plan(self) -> "TradePlan":
        # 无 TP 时给一个远目标占位（引擎要求非空），实际出场靠 SL/手动
        sign = 1.0 if self.side == "long" else -1.0
        dist = abs(self.entry_price - self.sl_price)
        tp = self.tp_price if self.tp_price is not None else self.entry_price + sign * 5 * dist
        return TradePlan(
            symbol=self.symbol, side=self.side, strategy_type="other",
            thesis=self.thesis or f"[manual/{self.setup_key}]",
            setup_key=self.setup_key, entry_type=self.entry_type,
            entry_price=self.entry_price, entry_trigger="手动镜像实盘",
            leverage=self.leverage, risk_pct=self.risk_pct,
            sl_price=self.sl_price, sl_basis="用户实盘设定",
            tp_targets=[TpTarget(price=tp, reduce_pct=100.0)],
        )


# --- Setup 闸门（Claude 的收窄角色：受约束否决 + 读非结构化事件）-----------

VetoCategory = Literal[
    "imminent_event",        # 临近二元事件（宏观数据/监管裁决/解锁），信号可能被事件碾过
    "data_anomaly",          # 触发数据可疑（陈旧/单点尖刺/来源异常），不是干净实例
    "signal_contradiction",  # 新闻/事件与 setup 方向直接矛盾（如做多信号撞上负面突发）
    "other",
]

EventKind = Literal["macro", "regulatory", "listing", "unlock", "exchange", "narrative", "other"]
Severity = Literal["low", "medium", "high"]


class EventAnnotation(BaseModel):
    """Claude 读非结构化事件后产出的结构化标注——喂回特征库的"文档即数据"通道。

    无论 confirm 还是 veto，看到值得记录的事件都应标注（不只为否决服务）。
    """
    kind: EventKind
    severity: Severity
    note: str = Field(description="一句话说清事件是什么、为什么值得记录")
    symbol: str | None = Field(default=None, description="关联标的；全市场事件留空")
    event_ts: str | None = Field(default=None, description="事件（预计）发生时刻 ISO8601，未知留空")


class SetupGateDecision(BaseModel):
    """Setup 触发后 Claude 的闸门裁决。不回答"该不该交易"——先验来自回测；
    只回答"是不是干净实例 + 有无定性否决理由"。"""
    verdict: Literal["confirm", "veto"]
    veto_category: VetoCategory | None = Field(
        default=None, description="veto 时必填的否决类别；confirm 留空"
    )
    reasoning: str = Field(description="一两句话：confirm 说明为何干净，veto 说明否决依据")
    event_annotations: list[EventAnnotation] = Field(
        default_factory=list,
        description="本次看到的值得结构化记录的事件（可为空；confirm 也可以有标注）",
    )


# --- 复盘 -----------------------------------------------------------------

class Review(BaseModel):
    plan_adherence: str = Field(description="计划执行得怎么样、有没有违反纪律")
    discipline_violations: list[str] = Field(default_factory=list)
    entry_timing: str = Field(description="进场时机评价")
    exit_timing: str = Field(description="出场时机评价")
    skill_vs_luck: SkillLuck
    skill_vs_luck_note: str = Field(description="为什么这样归类")
    lessons: str = Field(description="下次能改进什么")
