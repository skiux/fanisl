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
    """Claude 进场提交。仓位与盈亏比由引擎按风险%和止损距离反推/核算，这里给依据与点位。"""
    symbol: str
    side: Side
    strategy_type: StrategyType
    thesis: str = Field(description="一句话能说清的交易逻辑/理由")

    mtf: MtfAnalysis
    macro_context: str = Field(description="相关宏观/基本面背景")
    risk_events: str = Field(description="临近的风险事件（数据/会议/解锁），无则写无")
    regime: Regime = Field(description="当前是趋势市还是震荡市")
    risk_appetite: str = Field(description="整体风险偏好 risk-on/off 与相关资产在做什么")

    entry_type: EntryType
    entry_price: float = Field(description="进场价位（市价单也给参考价）")
    entry_trigger: str = Field(description="进场触发条件")

    leverage: float = Field(description="杠杆倍数")
    risk_pct: float = Field(description="本笔最多亏总权益的百分比")

    sl_price: float = Field(description="止损价位")
    sl_basis: str = Field(description="止损依据（结构破位/百分比/ATR倍数）")
    sl_type: SlType = "hard"

    tp_targets: list[TpTarget] = Field(description="一个或多个止盈目标及各自减仓比例")

    wake_conditions: list[WakeCondition] = Field(
        default_factory=list,
        description="希望在哪些条件下被唤醒重评（价穿位/盈亏到阈值/到时）。空=只靠引擎默认(逼近止损止盈)兜底。",
    )

    confidence_pct: float | None = Field(default=None, description="主观胜率/信心 0~100，用于校准")
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


# --- 持仓中调整 -----------------------------------------------------------

class Adjustment(BaseModel):
    action: AdjustAction
    reason: str
    thesis_still_valid: bool = Field(description="原始逻辑是否还成立（不成立应退出）")
    new_sl_price: float | None = Field(default=None, description="move_sl 时的新止损")
    reduce_pct: float | None = Field(default=None, description="partial_exit 时减仓百分比 0~100")
    add_qty_pct: float | None = Field(default=None, description="add 时加仓量（占原仓位%）")
    wake_conditions: list[WakeCondition] | None = Field(
        default=None, description="重设唤醒条件（None=沿用原计划的）",
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
