"""知识引擎的 LLM 接入层（按 backend 注册，见设计文档"三个注册表"）。

- GeminiClient：httpx 直连 generativelanguage（AI Studio key）。视频转录走 file_data 传
  YouTube URL（含音轨+画面），可带 start/end offset 做 clip 二次细读。
- VertexGeminiClient：同一套 prompt/schema 走 Agent Platform（Vertex）端点，用 ADC 鉴权。
  AI Studio 的项目被封或当日免费额度用尽时的第二条通道。
- ClaudeBackend（L1 提取）留位：官方 key 到位后实现；过渡期 PendingBackend（会话提取）。
"""

from __future__ import annotations

import json
import logging
import pathlib
import time

import httpx

_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
_VERTEX_BASE = "https://aiplatform.googleapis.com/v1/projects/{project}/locations/global/publishers/google/models"
log = logging.getLogger("analyzer.knowledge.llm")

_ADC_PATH = pathlib.Path.home() / ".config" / "gcloud" / "application_default_credentials.json"
_METADATA_TOKEN_URL = ("http://metadata.google.internal/computeMetadata/v1/"
                       "instance/service-accounts/default/token")
_MAX_OUTPUT_TOKENS = 65535   # 一期 30 分钟视频的转录+视觉笔记约 1.5 万 token，留足余量


class TruncatedGeneration(RuntimeError):
    """生成被截断（MAX_TOKENS 等）——不能当成功结果落库。"""

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

    def _parse(self, data: dict) -> dict:
        """取回结构化结果，并挡住截断——截断的转录会变成一份残缺 L0 静默入库。

        2026-08-13 实测：Vertex 通道把一期 23 分钟的视频只转了前 3 分钟就 MAX_TOKENS 收尾，
        字数从 1 万掉到 1 千，而调用方无从察觉。finishReason 不是 STOP 一律按失败处理。
        """
        self.last_usage = data.get("usageMetadata")
        cand = data["candidates"][0]
        reason = cand.get("finishReason")
        if reason not in (None, "STOP"):
            raise TruncatedGeneration(f"生成未正常结束：finishReason={reason}")
        return json.loads(cand["content"]["parts"][0]["text"])

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
        return self._parse(r.json())

    def transcribe_youtube(self, url: str, *, start_s: int | None = None,
                           end_s: int | None = None) -> dict:
        """URL 直读视频 → {lang, transcript, visual_notes}。offset 用于 clip 二次细读。"""
        # mime_type 对 AI Studio 可省，Vertex 必填（缺了报 empty mimeType parameter）
        fd: dict = {"file_data": {"file_uri": url, "mime_type": "video/*"}}
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

    鉴权两条路，不引 google-auth：
    - 开发机：读 ADC 文件（gcloud auth application-default login 生成的 authorized_user），
      它本来就是一份 refresh_token 授权，直接换 access token；
    - GCE 实例：ADC 文件不存在时走元数据服务器，用实例服务账号签发的 token，
      盘上不留任何长期凭据。
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
        tok, ttl = self._fetch_token()
        self._token, self._token_exp = tok, time.time() + ttl
        return self._token

    def _fetch_token(self) -> tuple[str, float]:
        """取 access token：开发机用 ADC 文件，GCE 上用元数据服务器（零凭据落盘）。

        顺序是"文件优先"：开发机上 `gcloud auth application-default login` 生成的
        authorized_user 文件本身就是明确的选择；服务器上不放这个文件，自动落到元数据
        服务器——实例服务账号签发的 token，不需要在盘上留任何长期凭据。
        """
        if _ADC_PATH.exists():
            cred = json.loads(_ADC_PATH.read_text())
            if cred.get("type") != "authorized_user":
                raise RuntimeError(
                    f"{_ADC_PATH} 的 type 是 {cred.get('type')!r}，本通道只支持 "
                    "authorized_user（gcloud auth application-default login 生成的）。"
                    "服务账号请改用 GCE 元数据服务器：删掉该文件即可自动走那条路。")
            r = httpx.post("https://oauth2.googleapis.com/token", timeout=30.0, data={
                "client_id": cred["client_id"], "client_secret": cred["client_secret"],
                "refresh_token": cred["refresh_token"], "grant_type": "refresh_token"})
            r.raise_for_status()
            d = r.json()
            return d["access_token"], float(d.get("expires_in", 3600))

        try:
            r = httpx.get(_METADATA_TOKEN_URL, timeout=5.0,
                          headers={"Metadata-Flavor": "Google"})
            r.raise_for_status()
            d = r.json()
            return d["access_token"], float(d.get("expires_in", 3600))
        except Exception as e:
            raise RuntimeError(
                f"取不到 Google access token。开发机：跑 gcloud auth application-default login "
                f"生成 {_ADC_PATH}；GCE 实例：给实例绑定服务账号并授予 roles/aiplatform.user、"
                f"且实例 scope 含 cloud-platform。元数据服务器错误：{e}") from e

    def generate_json(self, parts: list[dict], schema: dict) -> dict:
        r = httpx.post(
            f"{_VERTEX_BASE.format(project=self.project)}/{self.model}:generateContent",
            headers={"Authorization": f"Bearer {self._access_token()}"},
            json={
                "contents": [{"role": "user", "parts": _camelize(parts)}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseSchema": schema,
                    # Vertex 的默认输出上限比 AI Studio 低，不显式给会把长视频截断
                    "maxOutputTokens": _MAX_OUTPUT_TOKENS,
                },
            },
            timeout=self.timeout_s,
        )
        r.raise_for_status()
        return self._parse(r.json())


def make_client(settings, *, model: str | None = None) -> GeminiClient:
    """按配置选通道。`GEMINI_CHANNEL=auto|vertex|aistudio`，默认 auto。

    auto 的语义是"**优先 Vertex，换不到 token 就回落到 AI Studio key**"——
    同一份 .env 要同时服务两台机器：服务器上 Vertex 用 GCE 元数据服务器拿 token（零凭据落盘），
    本机要 `gcloud auth application-default login`，用户暂时做不了。不回落的话本机恒 400。

    回落**响一声**（warning），不静默换通道：Vertex 该通而不通是要知道的事。
    显式写 vertex 或 aistudio 就不回落，坏了就报错。
    """
    m = model or settings.gemini_model
    channel = getattr(settings, "gemini_channel", "auto")

    def _aistudio() -> GeminiClient:
        if not settings.gemini_api_key:
            raise SystemExit("需要 GEMINI_API_KEY（或把 GEMINI_CHANNEL 设为 vertex）")
        return GeminiClient(settings.gemini_api_key, model=m)

    if channel == "aistudio":
        return _aistudio()
    if channel == "vertex":
        return VertexGeminiClient(settings.gcp_project, model=m)
    if not settings.gcp_project:
        return _aistudio()

    vertex = VertexGeminiClient(settings.gcp_project, model=m)
    try:
        vertex._access_token()   # 只验鉴权，不发生成请求
        return vertex
    except Exception as exc:  # noqa: BLE001 — 拿不到 token 就换通道，原因打出来
        if not settings.gemini_api_key:
            raise
        log.warning("Vertex 取 token 失败（%s: %.120s），回落到 AI Studio key。"
                    "服务器上应当走 Vertex——那边看到这条 warning 说明元数据服务器有问题。",
                    type(exc).__name__, exc)
        return _aistudio()


def render_l0_text(tr: dict) -> str:
    """转录结果 → L0 raw 文本（转录 + 视觉笔记两节，L1 提取直接读）。"""
    lines = [tr.get("transcript", "").strip(), "", "## 视觉笔记（画面信息，带时间戳）"]
    for n in tr.get("visual_notes", []):
        lines.append(f"- [{n.get('t')}] ({n.get('kind')}) {n.get('note')}")
    return "\n".join(lines)
