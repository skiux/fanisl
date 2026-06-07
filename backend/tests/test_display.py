from analyzer.storage import display_messages


def test_user_text_and_assistant_text():
    raw = [
        {"role": "user", "content": "BTC?"},
        {"role": "assistant", "content": [{"type": "text", "text": "偏空。"}]},
    ]
    assert display_messages(raw) == [
        {"role": "user", "content": "BTC?"},
        {"role": "assistant", "content": "偏空。"},
    ]


def test_tool_roundtrip_collapses_to_final_answer():
    # 一次工具往返：assistant(thinking+tool_use) → user(tool_result) → assistant(text)
    raw = [
        {"role": "user", "content": "BTC?"},
        {
            "role": "assistant",
            "content": [
                {"type": "thinking", "thinking": "...", "signature": "x"},
                {"type": "tool_use", "id": "t1", "name": "get_market_snapshot", "input": {}},
            ],
        },
        {
            "role": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": "t1", "content": "{...}", "is_error": False}
            ],
        },
        {"role": "assistant", "content": [{"type": "text", "text": "结论"}]},
    ]
    assert display_messages(raw) == [
        {"role": "user", "content": "BTC?"},
        {"role": "assistant", "content": "结论"},
    ]


def test_assistant_multiple_text_blocks_joined():
    raw = [{"role": "assistant", "content": [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]}]
    assert display_messages(raw) == [{"role": "assistant", "content": "a\nb"}]


def test_empty():
    assert display_messages([]) == []
