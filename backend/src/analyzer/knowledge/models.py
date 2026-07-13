"""知识引擎 L1 单元的 pydantic 模型（信封 + Claim/Method/Concept 载荷）。

设计不变量（doc/knowledge-engine-design.md）：
- Claim 的评分语义在**提取时刻冻结**（ScoringSpec），评分器只做机械执行；
- 载荷进 JSONB（schema 演进不迁表），入库前必须过这里的校验；
- verifiability A/B/C 必须带 scoring_spec，D（不可评）不允许带——含糊率本身是指标。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

UnitKind = Literal["claim", "method", "concept"]
ScoringMethod = Literal["sign", "target_touch", "target_close", "range_hold", "relative_return"]
Verifiability = Literal["A", "B", "C", "D"]


class Horizon(BaseModel):
    type: Literal["by_date", "within_duration", "open_ended"]
    deadline: str | None = None        # ISO 日期（by_date 必填）
    duration_days: float | None = None  # within_duration 必填

    @model_validator(mode="after")
    def _check(self):
        if self.type == "by_date" and not self.deadline:
            raise ValueError("by_date 需要 deadline")
        if self.type == "within_duration" and not self.duration_days:
            raise ValueError("within_duration 需要 duration_days")
        return self


class ScoringSpec(BaseModel):
    """提取时冻结的评分规格——评分器唯一的输入约定。"""
    method: ScoringMethod
    eval_ladder: list[str] = Field(description="评分时点 ISO 日期列表（open_ended 用默认阶梯并注明系我方指定）")
    benchmark: str | None = Field(default=None, description="relative_return 的基准符号")
    success_def: str = Field(description="一句话成功定义（评分争议时的仲裁依据）")


class ClaimPayload(BaseModel):
    asset_text: str = Field(description="原文的资产表述")
    asset_symbol: str | None = Field(default=None, description="规范符号（可映射进 instruments 时）")
    priceable: bool = Field(description="行情库有无该资产价格序列（决定能否机械评分）")
    claim_class: Literal["price_target", "directional", "relative", "event_outcome", "timing", "risk_warning"]
    direction: Literal["up", "down", "flat", "range", "vol_up", "vol_down"] | None = None
    magnitude: dict | None = Field(default=None, description="目标价/区间/百分比，如 {target: 75}")
    horizon: Horizon
    condition_text: str | None = Field(default=None, description="前置条件原文（如'除非 OPEC 增产'）")
    condition_observable: bool = Field(default=False, description="条件能否机械判定")
    stance_strength: Literal["explicit", "hedged", "speculative"]
    verifiability: Verifiability
    scoring_spec: ScoringSpec | None = None

    @model_validator(mode="after")
    def _check(self):
        if self.verifiability in ("A", "B", "C") and self.scoring_spec is None:
            raise ValueError("A/B/C 级 claim 必须带冻结的 scoring_spec")
        if self.verifiability == "D" and self.scoring_spec is not None:
            raise ValueError("D 级（不可评）不应带 scoring_spec")
        if self.verifiability in ("A", "B") and not self.priceable:
            raise ValueError("A/B 级要求资产可定价")
        return self


class MethodPayload(BaseModel):
    name: str
    summary: str
    family: Literal["trend", "reversion", "carry", "event", "flow", "positioning", "other"]
    rules: list[str] = Field(description="进/出/仓位规则条目，尽量保留原始表述")
    claimed_performance: dict | None = Field(default=None, description="他自称的战绩（记录不采信）")
    data_requirements: list[str] = Field(default_factory=list)
    overlap_with_killed: list[str] = Field(
        default_factory=list, description="与已杀 H1-H22 的重叠（提取时判，防重杀尸体）")
    testability: Literal["A", "B", "C"] = Field(description="A=现有数据可回测 B=缺数据 C=纯酌情")


class ConceptPayload(BaseModel):
    canonical_statement: str = Field(description="归一化表述（L3 归并的抓手）")
    category: Literal["risk_mgmt", "psychology", "market_structure", "regime",
                      "execution", "macro_framework", "other"]
    stance: Literal["assert", "reject"] = "assert"
    regime_qualifier: str | None = Field(default=None, description="声明的适用条件（如有）")


_PAYLOADS = {"claim": ClaimPayload, "method": MethodPayload, "concept": ConceptPayload}


class KnowledgeUnit(BaseModel):
    """一条 L1 单元（信封的可校验部分；content/creator/发布时刻由 store 落库时补）。"""
    kind: UnitKind
    quote: str = Field(max_length=600, description="逐字原文引用（仲裁依据）")
    locator: str | None = Field(default=None, description="原文定位：字符偏移或视频时间点")
    payload: dict
    tags: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate_payload(self):
        self.payload = _PAYLOADS[self.kind].model_validate(self.payload).model_dump()
        return self
