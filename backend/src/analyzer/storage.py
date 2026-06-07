"""SQLite 存储：对话 + 消息。

content_json 存原始 content blocks（含 tool_use / tool_result），原样喂回 Claude。
每次操作开一个新连接（check_same_thread 友好），单用户本地工具足够。
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

_SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content_json    TEXT NOT NULL,
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Storage:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self.init_db()

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def init_db(self) -> None:
        with self._conn() as conn:
            conn.executescript(_SCHEMA)

    # --- 对话 -------------------------------------------------------------

    def create_conversation(self, title: str) -> int:
        ts = _now()
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO conversations(title, created_at, updated_at) VALUES (?,?,?)",
                (title, ts, ts),
            )
            return int(cur.lastrowid)

    def conversation_exists(self, conversation_id: int) -> bool:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT 1 FROM conversations WHERE id = ?", (conversation_id,)
            ).fetchone()
            return row is not None

    def get_conversation(self, conversation_id: int) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?",
                (conversation_id,),
            ).fetchone()
            return dict(row) if row else None

    def list_conversations(self) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, title, created_at, updated_at FROM conversations "
                "ORDER BY updated_at DESC"
            ).fetchall()
            return [dict(r) for r in rows]

    def touch_conversation(self, conversation_id: int) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE conversations SET updated_at = ? WHERE id = ?",
                (_now(), conversation_id),
            )

    # --- 消息 -------------------------------------------------------------

    def add_message(
        self, conversation_id: int, role: str, content: Any
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO messages(conversation_id, role, content_json, created_at) "
                "VALUES (?,?,?,?)",
                (
                    conversation_id,
                    role,
                    json.dumps(content, ensure_ascii=False),
                    _now(),
                ),
            )

    def get_history(self, conversation_id: int) -> list[dict]:
        """返回可直接喂给 Claude 的 messages 列表。"""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT role, content_json FROM messages "
                "WHERE conversation_id = ? ORDER BY id ASC",
                (conversation_id,),
            ).fetchall()
            return [
                {"role": r["role"], "content": json.loads(r["content_json"])}
                for r in rows
            ]

    def delete_conversation(self, conversation_id: int) -> None:
        # 消息通过 ON DELETE CASCADE 一并删除（_conn 已开 foreign_keys）
        with self._conn() as conn:
            conn.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))

    def update_title(self, conversation_id: int, title: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
                (title, _now(), conversation_id),
            )


def display_messages(raw: list[dict]) -> list[dict]:
    """把存储的原始 content blocks 折叠成干净的对话气泡 [{role, content}]。

    user 纯文本保留；user 的 tool_result（list）跳过；assistant 只取 text 块
    （丢 tool_use/thinking）。一次工具往返因此塌缩成「用户问题 + 最终回答」。
    """
    out: list[dict] = []
    for msg in raw:
        role = msg.get("role")
        content = msg.get("content")
        if role == "user":
            if isinstance(content, str):
                out.append({"role": "user", "content": content})
            # list = tool_result，内部数据，跳过
        elif role == "assistant":
            if isinstance(content, str):
                text = content
            else:
                text = "\n".join(
                    b.get("text", "")
                    for b in content
                    if isinstance(b, dict) and b.get("type") == "text" and b.get("text")
                )
            if text:
                out.append({"role": "assistant", "content": text})
    return out
