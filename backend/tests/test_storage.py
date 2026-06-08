"""对话存储单测（PG 测试库，conv_store 夹具做隔离）。"""


def test_storage_roundtrip(conv_store):
    s = conv_store
    cid = s.create_conversation("hi")
    assert s.conversation_exists(cid)
    assert not s.conversation_exists(cid + 999)

    s.add_message(cid, "user", "hello")
    s.add_message(cid, "assistant", [{"type": "text", "text": "hi there"}])

    hist = s.get_history(cid)
    assert hist[0] == {"role": "user", "content": "hello"}
    assert hist[1]["content"][0]["text"] == "hi there"
    assert len(s.list_conversations()) == 1


def test_delete_conversation_cascades(conv_store):
    s = conv_store
    cid = s.create_conversation("hi")
    s.add_message(cid, "user", "hello")
    s.delete_conversation(cid)
    assert not s.conversation_exists(cid)
    assert s.get_history(cid) == []  # 消息被级联删除
    assert s.list_conversations() == []


def test_update_title(conv_store):
    s = conv_store
    cid = s.create_conversation("old")
    s.update_title(cid, "new title")
    assert s.list_conversations()[0]["title"] == "new title"


def test_get_conversation(conv_store):
    s = conv_store
    cid = s.create_conversation("hi")
    c = s.get_conversation(cid)
    assert c["id"] == cid
    assert c["title"] == "hi"
    assert s.get_conversation(99999) is None
