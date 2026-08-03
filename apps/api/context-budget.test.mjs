import assert from "node:assert/strict";
import {
  buildModelMessages,
  deleteConversationMessages,
  findRequestReplay,
  formatMemoryForClient,
  getRecentVisibleMessages,
  getSummaryBatch,
  getVisibleMessages,
  selectRelevantMemories,
} from "./server.mjs";

function testRequestReplayIsIdempotent() {
  const conversation = {
    messages: [
      { id: "u-1", role: "user", content: "今天烦死了", request_id: "req-1" },
      { id: "a-1", role: "assistant", content: "谁又惹你了", in_reply_to_request_id: "req-1" },
    ],
  };
  const replay = findRequestReplay(conversation, "req-1", "今天烦死了");
  assert.equal(replay.userMessage.id, "u-1");
  assert.equal(replay.completedReply.id, "a-1");
  assert.equal(replay.conflict, false);
  assert.equal(findRequestReplay(conversation, "req-1", "换了一句话").conflict, true);
}

function testMemorySourceUsesConversationAndDate() {
  const sourceMessage = message(1, "user");
  const conversationPool = new Map([["c-1", {
    id: "c-1",
    title: "领导又发疯",
    messages: [sourceMessage],
  }]]);
  const formatted = formatMemoryForClient(
    memory(1, "relationship_context", "领导反馈会触发自我否定", {
      source_message_ids: [sourceMessage.id],
    }),
    conversationPool,
  );
  assert.deepEqual(formatted.source, {
    conversation_id: "c-1",
    conversation_title: "领导又发疯",
    message_created_at: sourceMessage.created_at,
  });
}

function message(index, role = index % 2 === 0 ? "user" : "assistant") {
  return {
    id: `m-${index}`,
    role,
    content: `${role}-${index}：关于领导反馈和项目复盘的第 ${index} 条内容`,
    created_at: new Date(2026, 0, 1, 9, index).toISOString(),
  };
}

function memory(id, type, content, overrides = {}) {
  return {
    id,
    type,
    content,
    display_title: overrides.display_title || content.slice(0, 24),
    status: overrides.status || "active",
    sensitivity: overrides.sensitivity || "normal",
    user_confirmed: overrides.user_confirmed ?? true,
    source_message_ids: overrides.source_message_ids || [],
    created_at: overrides.created_at || `2026-01-${String(id).padStart(2, "0")}T00:00:00.000Z`,
    updated_at: overrides.updated_at || `2026-01-${String(id).padStart(2, "0")}T00:00:00.000Z`,
  };
}

function testShortConversationDoesNotSummarize() {
  const conversation = {
    messages: Array.from({ length: 20 }, (_, index) => message(index + 1)),
  };

  const batch = getSummaryBatch(conversation);

  assert.equal(batch.visibleMessages.length, 20);
  assert.equal(
    batch.visibleMessages.length <= 24,
    true,
    "20 条以内的会话不应触发摘要",
  );
  assert.equal(batch.messagesToSummarize.length, 8);
  assert.equal(getRecentVisibleMessages(conversation.messages, 12).at(0).id, "m-9");
}

function testLongConversationSummarizesOnlyOlderMessages() {
  const conversation = {
    messages: Array.from({ length: 30 }, (_, index) => message(index + 1)),
    recent_summary: "之前在聊工作烦心事。",
  };

  const batch = getSummaryBatch(conversation);
  const modelMessages = buildModelMessages(
    "system",
    conversation,
    { emotion: "烦躁", intent: ["吐槽"] },
    [],
  );

  assert.equal(batch.visibleMessages.length, 30);
  assert.equal(batch.messagesToSummarize.length, 18);
  assert.equal(batch.messagesToSummarize.at(0).id, "m-1");
  assert.equal(batch.messagesToSummarize.at(-1).id, "m-18");
  assert.equal(modelMessages.slice(1).length, 12, "模型调用只保留最近 12 条原文");
  assert.equal(modelMessages.at(-1).content.includes("第 30 条内容"), true);
  assert.equal(
    modelMessages[0].content.includes("之前在聊工作烦心事。"),
    true,
    "模型系统上下文应包含会话摘要",
  );
}

function testDeletedMessagesLeaveModelContext() {
  const conversation = {
    messages: Array.from({ length: 14 }, (_, index) => message(index + 1)),
    recent_summary: "之前聊过一段已经跑偏的内容。",
    current_mood_hint: "用户被跑偏内容影响。",
    summarized_until_message_id: "m-4",
    summary_updated_at: "2026-01-01T10:00:00.000Z",
  };
  const memories = [
    memory(31, "current_state", "这条记忆来自跑偏消息。", {
      source_message_ids: ["m-13"],
    }),
  ];

  const result = deleteConversationMessages(conversation, ["m-13"], memories, "2026-01-01T11:00:00.000Z");
  const visible = getVisibleMessages(conversation.messages);
  const modelMessages = buildModelMessages(
    "system",
    conversation,
    { emotion: "平静", intent: ["闲聊"] },
    [],
  );

  assert.equal(result.deleted_count, 1);
  assert.equal(conversation.messages.find((item) => item.id === "m-13").content, "");
  assert.equal(visible.some((item) => item.id === "m-13"), false);
  assert.equal(getRecentVisibleMessages(conversation.messages, 12).some((item) => item.id === "m-13"), false);
  assert.equal(modelMessages.some((item) => item.content?.includes("第 13 条内容")), false);
  assert.equal(conversation.recent_summary, "", "删除消息后应保守清空旧摘要");
  assert.equal(memories[0].status, "archived", "被删除消息产生的记忆不应继续使用");
}

function testMemoryBudgetChoosesBoundariesAndTopic() {
  const memories = [
    memory(1, "expression_preference", "用户不喜欢鸡汤式安慰，希望石头直接一点。"),
    memory(2, "boundary", "用户要求不要主动提某个家庭细节。", { sensitivity: "sensitive" }),
    memory(3, "sexual_boundary_preference", "用户能接受轻度黄腔，但情绪重时要收住。"),
    memory(4, "persona_feedback", "用户希望石头别像客服，要像熟人。"),
    memory(5, "expression_preference", "用户喜欢短句，别写报告。"),
    memory(6, "persona_feedback", "用户喜欢石头嘴欠一点但不要刻薄。"),
    memory(7, "relationship_context", "领导反馈经常让用户烦躁并开始自我否定。", {
      sensitivity: "sensitive",
    }),
    memory(8, "important_event", "用户最近在准备项目复盘，领导反馈很多。"),
    memory(9, "emotional_pattern", "用户遇到领导反馈时容易自我否定。", {
      sensitivity: "sensitive",
    }),
    memory(10, "shared_joke", "用户和石头会把离谱同事叫傻福同事。"),
    memory(11, "important_event", "用户之前聊过搬家预算。"),
    memory(12, "relationship_context", "用户和某位朋友最近关系缓和。"),
    memory(13, "current_state", "用户这周睡眠一般。"),
    memory(14, "shared_joke", "用户喜欢石头顺手问有帅哥吗。"),
    memory(15, "important_event", "用户之前说过健身计划。"),
    memory(16, "relationship_context", "用户提到一个无关的咖啡店朋友。"),
    memory(17, "important_event", "用户计划周末整理房间。"),
    memory(18, "current_state", "用户最近在看一部剧。", { status: "archived" }),
  ];
  const conversation = {
    recent_summary: "这段对话在聊工作烦心事和领导反馈。",
    current_mood_hint: "用户想先吐槽，不急着要方案。",
    messages: [
      message(1),
      {
        id: "m-2",
        role: "user",
        content: "今天领导反馈又来了，烦得我开始怀疑自己。",
        created_at: "2026-01-01T09:02:00.000Z",
      },
    ],
  };

  const selected = selectRelevantMemories("今天又被领导反馈搞烦了", conversation, memories);
  const selectedIds = selected.map((item) => item.id);

  assert.equal(selected.length <= 10, true, "长期记忆单轮加载不应超过 10 条");
  assert.deepEqual(selectedIds.slice(0, 6), [6, 5, 4, 3, 2, 1]);
  assert.equal(selectedIds.includes(7), true, "应加载与领导反馈相关的关系记忆");
  assert.equal(selectedIds.includes(8), true, "应加载与项目复盘相关的重要事件");
  assert.equal(selectedIds.includes(9), true, "应加载明确相关的敏感情绪模式");
  assert.equal(selectedIds.includes(18), false, "归档记忆不能加载");
  assert.equal(selectedIds.includes(11), false, "无关记忆应被排除");
}

testShortConversationDoesNotSummarize();
testLongConversationSummarizesOnlyOlderMessages();
testDeletedMessagesLeaveModelContext();
testMemoryBudgetChoosesBoundariesAndTopic();
testRequestReplayIsIdempotent();
testMemorySourceUsesConversationAndDate();

console.log("Context budget tests passed");
