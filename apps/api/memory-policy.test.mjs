import assert from "node:assert/strict";
import {
  applyAutomaticMemoryCandidate,
  hasDurableMemorySignal,
  pruneExpiredMemoryCandidates,
  selectAutomaticMemoryCandidates,
  selectRelevantMemories,
  shouldRunMemoryExtractor,
} from "./server.mjs";

function candidate(overrides = {}) {
  return {
    existing_memory_id: "",
    type: "shared_joke",
    content: "用户和石头会把离谱同事叫作傻福同事。",
    display_title: "傻福同事",
    sensitivity: "normal",
    why_this_matters: "这是可以复用的共同梗",
    ...overrides,
  };
}

function options(sourceMessageId, overrides = {}) {
  return {
    sourceMessageId,
    memoryAction: "candidate",
    classification: {
      memory_action: "candidate",
      style_feedback: false,
    },
    now: `2026-07-${sourceMessageId === "message-1" ? "01" : "02"}T00:00:00.000Z`,
    ...overrides,
  };
}

function testDurableGateRejectsOrdinaryChatter() {
  assert.equal(
    hasDurableMemorySignal(
      { intent: ["吐槽", "工作吐槽"], style_feedback: false },
      "今天老板又提了个离谱需求，烦死了。",
    ),
    false,
  );
  assert.equal(
    hasDurableMemorySignal(
      { intent: ["情绪模式"], style_feedback: false },
      "我发现我每次被领导反馈都会先否定自己。",
    ),
    true,
  );
  assert.equal(
    hasDurableMemorySignal(
      { intent: ["闲聊", "关系信息"], style_feedback: false },
      "我老板姓王，今天出去玩的时候碰到他了。",
    ),
    true,
    "稳定人物身份锚点第一次出现也应进入待观察",
  );
  assert.equal(
    hasDurableMemorySignal(
      { intent: ["闲聊"], style_feedback: false },
      "今天出去玩碰到老板了。",
    ),
    false,
    "只提到人物但没有稳定身份信息时不应触发",
  );
}

function testAutomaticExtractionHasHardPerTurnLimit() {
  const selected = selectAutomaticMemoryCandidates([
    candidate(),
    candidate({ display_title: "不该进入第二条" }),
    null,
  ]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].display_title, "傻福同事");
}

function testMemoryReviewBypassesInconsistentClassifierAction() {
  const classification = {
    intent: ["闲聊", "记忆管理"],
    memory_action: "none",
    should_collect_memory_candidate: false,
    style_feedback: false,
  };

  assert.equal(
    shouldRunMemoryExtractor(
      classification,
      "你还记得我那个做摄影的朋友叫什么吗？",
    ),
    true,
    "记忆核对不能因为模型误给 memory_action=none 而跳过提取",
  );
  assert.equal(
    shouldRunMemoryExtractor(classification, "小本本入口在哪里？"),
    false,
    "普通记忆页面询问不应触发提取",
  );
}

function testEvidencePromotesWithoutDuplicating() {
  const memoryPool = [];
  const first = applyAutomaticMemoryCandidate(
    memoryPool,
    candidate(),
    options("message-1"),
  );

  assert.equal(first.action, "created");
  assert.equal(memoryPool.length, 1);
  assert.equal(memoryPool[0].status, "candidate");
  assert.equal(memoryPool[0].evidence_count, 1);
  assert.equal(memoryPool[0].auto_managed, true);

  const second = applyAutomaticMemoryCandidate(
    memoryPool,
    candidate({
      existing_memory_id: memoryPool[0].id,
      content: "用户和石头固定用“傻福同事”吐槽那个离谱同事。",
    }),
    options("message-2"),
  );

  assert.equal(second.action, "promoted");
  assert.equal(memoryPool.length, 1, "第二条证据必须更新旧记忆，不能新增");
  assert.equal(memoryPool[0].status, "active");
  assert.equal(memoryPool[0].evidence_count, 2);
  assert.equal(memoryPool[0].source_message_ids.length, 2);
}

function testRelationshipEvidenceUsesOnlyRealUserMessageIds() {
  const memoryPool = [];
  const change = applyAutomaticMemoryCandidate(
    memoryPool,
    candidate({
      type: "relationship_context",
      content: "用户的老板姓王，用户会称他为王老板。",
      display_title: "王老板",
      supporting_message_ids: [
        "boss-message-1",
        "boss-message-2",
        "invented-message",
      ],
    }),
    options("boss-message-2", {
      allowedEvidenceMessageIds: ["boss-message-1", "boss-message-2"],
      now: "2026-07-30T08:00:00.000Z",
    }),
  );

  assert.equal(change.action, "created");
  assert.equal(memoryPool.length, 1);
  assert.deepEqual(
    memoryPool[0].source_message_ids,
    ["boss-message-1", "boss-message-2"],
    "只能采用后端提供的真实用户消息 ID",
  );
  assert.equal(memoryPool[0].evidence_count, 2);
  assert.equal(memoryPool[0].status, "active");
}

function testCurrentStateNeverBecomesAutomaticLongTermMemory() {
  const memoryPool = [];
  const change = applyAutomaticMemoryCandidate(
    memoryPool,
    candidate({
      type: "current_state",
      content: "用户今天很累。",
    }),
    options("message-1"),
  );

  assert.equal(change, null);
  assert.equal(memoryPool.length, 0);
}

function testExplicitRememberActivatesImmediately() {
  const memoryPool = [];
  const change = applyAutomaticMemoryCandidate(
    memoryPool,
    candidate({
      type: "expression_preference",
      content: "用户不喜欢鸡汤式安慰。",
      display_title: "不要鸡汤",
    }),
    options("message-1", {
      memoryAction: "remember",
      classification: {
        memory_action: "remember",
        style_feedback: true,
      },
    }),
  );

  assert.equal(change.action, "created");
  assert.equal(memoryPool[0].status, "active");
  assert.equal(memoryPool[0].user_confirmed, true);
  assert.equal(memoryPool[0].auto_managed, false);
}

function testSensitiveCandidateDoesNotAutoPromote() {
  const memoryPool = [];
  applyAutomaticMemoryCandidate(
    memoryPool,
    candidate({
      type: "emotional_pattern",
      content: "用户在被领导严厉反馈时容易进入自我否定。",
      sensitivity: "sensitive",
    }),
    options("message-1"),
  );
  applyAutomaticMemoryCandidate(
    memoryPool,
    candidate({
      existing_memory_id: memoryPool[0].id,
      type: "emotional_pattern",
      content: "用户遇到领导严厉反馈时容易先否定自己。",
      sensitivity: "sensitive",
    }),
    options("message-2"),
  );

  assert.equal(memoryPool.length, 1);
  assert.equal(memoryPool[0].evidence_count, 2);
  assert.equal(memoryPool[0].status, "candidate");
}

function testCandidateDoesNotEnterReplyContext() {
  const memoryPool = [
    {
      id: "candidate-1",
      type: "expression_preference",
      content: "用户可能喜欢短句。",
      display_title: "可能喜欢短句",
      status: "candidate",
      sensitivity: "normal",
      updated_at: "2026-07-01T00:00:00.000Z",
    },
    {
      id: "active-1",
      type: "expression_preference",
      content: "用户明确不喜欢鸡汤。",
      display_title: "不要鸡汤",
      status: "active",
      sensitivity: "normal",
      updated_at: "2026-07-02T00:00:00.000Z",
    },
  ];

  const selected = selectRelevantMemories("今天有点烦", { messages: [] }, memoryPool);
  assert.deepEqual(selected.map((memory) => memory.id), ["active-1"]);
}

function testOnlySystemCandidateExpires() {
  const memoryPool = [
    {
      id: "expired-auto",
      status: "candidate",
      auto_managed: true,
      expires_at: "2026-07-01T00:00:00.000Z",
    },
    {
      id: "manual-candidate",
      status: "candidate",
      auto_managed: false,
      expires_at: "2026-07-01T00:00:00.000Z",
    },
  ];

  const removed = pruneExpiredMemoryCandidates(
    memoryPool,
    "2026-07-31T00:00:00.000Z",
  );
  assert.equal(removed, 1);
  assert.deepEqual(memoryPool.map((memory) => memory.id), ["manual-candidate"]);
}

testDurableGateRejectsOrdinaryChatter();
testAutomaticExtractionHasHardPerTurnLimit();
testMemoryReviewBypassesInconsistentClassifierAction();
testEvidencePromotesWithoutDuplicating();
testRelationshipEvidenceUsesOnlyRealUserMessageIds();
testCurrentStateNeverBecomesAutomaticLongTermMemory();
testExplicitRememberActivatesImmediately();
testSensitiveCandidateDoesNotAutoPromote();
testCandidateDoesNotEnterReplyContext();
testOnlySystemCandidateExpires();

console.log("Memory policy tests passed");
