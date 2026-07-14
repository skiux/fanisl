"""知识引擎的 LLM 接入层（按 backend 注册，见设计文档"三个注册表"）。

- GeminiClient：httpx 直连 generativelanguage（不引 SDK）。视频转录走 file_data 传
  YouTube URL（含音轨+画面），可带 start/end offset 做 clip 二次细读。
- ClaudeBackend（L1 提取）留位：官方 key 到位后实现；过渡期 PendingBackend（会话提取）。
"""

from __future__ import annotations

import json

import httpx

_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

# 转录+视觉笔记的结构化输出 schema（response_schema）
TRANSCRIBE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "lang": {"type": "STRING"},
        "transcript": {"type": "STRING", "description": "完整口播转录（保留原语言，分段）"},
        "visual_notes": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "t": {"type": "STRING", "description": "MM:SS 时间戳"},
                    "kind": {"type": "STRING", "description": "chart|table|text_slide|other"},
                    "note": {"type": "STRING",
                             "description": "画面信息的结构化描述：标的/周期/标注价位/表格数字"},
                },
                "required": ["t", "kind", "note"],
            },
        },
    },
    "required": ["lang", "transcript", "visual_notes"],
}

TRANSCRIBE_PROMPT = (
    "这是一个财经视频。请：\n"
    "1. 完整转录口播内容（保留原语言，忠实原话，不概括不省略）；\n"
    "2. 对画面中出现的**图表/表格/文字版面**给出带时间戳的视觉笔记：标的、周期、"
    "标注的关键价位/指标数值、表格数字——只记画面上真实可见的信息，不推断；\n"
    "3. 每个独立画面一条笔记，图表密集时以'讲解停留'的画面为准。"
)


class GeminiClient:
    def __init__(self, api_key: str, *, model: str = "gemini-flash-latest",
                 timeout_s: float = 420.0) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_s = timeout_s
        self.last_usage: dict | None = None   # 最近一次调用的 usageMetadata（成本可见性）

    def generate_json(self, parts: list[dict], schema: dict) -> dict:
        """带 response_schema 的结构化生成。parts 由调用方组装（text/file_data）。"""
        r = httpx.post(
            f"{_BASE}/{self.model}:generateContent",
            params={"key": self.api_key},
            json={
                "contents": [{"parts": parts}],
                "generationConfig": {
                    "response_mime_type": "application/json",
                    "response_schema": schema,
                    # 转录/结构化任务不需要扩展思考，省 token（thought 签名照常兼容）
                    "thinkingConfig": {"thinkingBudget": 0},
                },
            },
            timeout=self.timeout_s,
        )
        r.raise_for_status()
        data = r.json()
        self.last_usage = data.get("usageMetadata")
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(text)

    def transcribe_youtube(self, url: str, *, start_s: int | None = None,
                           end_s: int | None = None) -> dict:
        """URL 直读视频 → {lang, transcript, visual_notes}。offset 用于 clip 二次细读。"""
        fd: dict = {"file_data": {"file_uri": url}}
        if start_s is not None or end_s is not None:
            fd["video_metadata"] = {}
            if start_s is not None:
                fd["video_metadata"]["start_offset"] = f"{start_s}s"
            if end_s is not None:
                fd["video_metadata"]["end_offset"] = f"{end_s}s"
        return self.generate_json([fd, {"text": TRANSCRIBE_PROMPT}], TRANSCRIBE_SCHEMA)


def render_l0_text(tr: dict) -> str:
    """转录结果 → L0 raw 文本（转录 + 视觉笔记两节，L1 提取直接读）。"""
    lines = [tr.get("transcript", "").strip(), "", "## 视觉笔记（画面信息，带时间戳）"]
    for n in tr.get("visual_notes", []):
        lines.append(f"- [{n.get('t')}] ({n.get('kind')}) {n.get('note')}")
    return "\n".join(lines)
