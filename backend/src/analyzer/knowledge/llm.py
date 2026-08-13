"""知识引擎的 LLM 接入层（按 backend 注册，见设计文档"三个注册表"）。

- GeminiClient：httpx 直连 generativelanguage（AI Studio key）。视频转录走 file_data 传
  YouTube URL（含音轨+画面），可带 start/end offset 做 clip 二次细读。
- VertexGeminiClient：同一套 prompt/schema 走 Agent Platform（Vertex）端点，用 ADC 鉴权。
  AI Studio 的项目被封或当日免费额度用尽时的第二条通道。
- ClaudeBackend（L1 提取）留位：官方 key 到位后实现；过渡期 PendingBackend（会话提取）。
"""

from __future__ import annotations

import json
import pathlib
import time

import httpx

_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
_VERTEX_BASE = "https://aiplatform.googleapis.com/v1/projects/{project}/locations/global/publishers/google/models"
_ADC_PATH = pathlib.Path.home() / ".config" / "gcloud" / "application_default_credentials.json"

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
    def __init__(self, api_key: str, *, model: str = "gemini-3.5-flash",
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
                    # 不写 thinkingConfig：让模型自取（实测最小档 ~190 思考 token，相对视频
                    # 转录的十万级 token 是噪音）。原先写死 thinkingBudget: 0 省这点 token，
                    # 但 2026-08-12 `gemini-flash-latest` 别名换代后新模型拒绝 0
                    # （400 INVALID_ARGUMENT），整条摄取链因此断了一个月——不值得为此再冒险。
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


_CAMEL = {"file_data": "fileData", "file_uri": "fileUri", "video_metadata": "videoMetadata",
          "start_offset": "startOffset", "end_offset": "endOffset", "mime_type": "mimeType"}


def _camelize(obj):
    """请求体键名转驼峰：AI Studio 两种都收，Vertex 只认驼峰。"""
    if isinstance(obj, dict):
        return {_CAMEL.get(k, k): _camelize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_camelize(v) for v in obj]
    return obj


class VertexGeminiClient(GeminiClient):
    """Agent Platform（Vertex）通道：与 GeminiClient 同接口，只换鉴权与端点。

    鉴权用 ADC 的用户凭据（gcloud auth application-default login 生成的
    application_default_credentials.json）直接换 access token——不引 google-auth，
    ADC 的 authorized_user 本来就是一份 refresh_token 授权。
    """

    def __init__(self, project: str, *, model: str = "gemini-3.5-flash",
                 timeout_s: float = 420.0) -> None:
        super().__init__(api_key="", model=model, timeout_s=timeout_s)
        self.project = project
        self._token: str | None = None
        self._token_exp = 0.0

    def _access_token(self) -> str:
        if self._token and time.time() < self._token_exp - 60:
            return self._token
        if not _ADC_PATH.exists():
            raise RuntimeError(
                f"未找到 ADC（{_ADC_PATH}）；先跑 gcloud auth application-default login")
        cred = json.loads(_ADC_PATH.read_text())
        r = httpx.post("https://oauth2.googleapis.com/token", timeout=30.0, data={
            "client_id": cred["client_id"], "client_secret": cred["client_secret"],
            "refresh_token": cred["refresh_token"], "grant_type": "refresh_token"})
        r.raise_for_status()
        d = r.json()
        self._token, self._token_exp = d["access_token"], time.time() + d.get("expires_in", 3600)
        return self._token

    def generate_json(self, parts: list[dict], schema: dict) -> dict:
        r = httpx.post(
            f"{_VERTEX_BASE.format(project=self.project)}/{self.model}:generateContent",
            headers={"Authorization": f"Bearer {self._access_token()}"},
            json={
                "contents": [{"role": "user", "parts": _camelize(parts)}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseSchema": schema,
                },
            },
            timeout=self.timeout_s,
        )
        r.raise_for_status()
        data = r.json()
        self.last_usage = data.get("usageMetadata")
        return json.loads(data["candidates"][0]["content"]["parts"][0]["text"])


def make_client(settings, *, model: str | None = None) -> GeminiClient:
    """按配置选通道：填了 gcp_project 走 Vertex（ADC），否则走 AI Studio key。"""
    m = model or settings.gemini_model
    if settings.gcp_project:
        return VertexGeminiClient(settings.gcp_project, model=m)
    if not settings.gemini_api_key:
        raise SystemExit("既没有 gcp_project 也没有 gemini_api_key")
    return GeminiClient(settings.gemini_api_key, model=m)


def render_l0_text(tr: dict) -> str:
    """转录结果 → L0 raw 文本（转录 + 视觉笔记两节，L1 提取直接读）。"""
    lines = [tr.get("transcript", "").strip(), "", "## 视觉笔记（画面信息，带时间戳）"]
    for n in tr.get("visual_notes", []):
        lines.append(f"- [{n.get('t')}] ({n.get('kind')}) {n.get('note')}")
    return "\n".join(lines)
