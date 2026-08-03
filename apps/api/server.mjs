import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");
const webDir = path.join(rootDir, "apps/web");
const promptPaths = {
  system: path.join(rootDir, "prompts/system-prompt.md"),
  emotionClassifier: path.join(rootDir, "prompts/emotion-classifier.md"),
  memoryExtractor: path.join(rootDir, "prompts/memory-extractor.md"),
  responseRewriter: path.join(rootDir, "prompts/response-rewriter.md"),
  conversationSummarizer: path.join(rootDir, "prompts/conversation-summarizer.md"),
};
const dataDir = path.join(rootDir, "data");
const storePath = path.join(dataDir, "dev-store.json");
const backupDir = path.join(rootDir, "backups");
const RECENT_MESSAGE_LIMIT = 12;
const SUMMARY_TRIGGER_MESSAGE_COUNT = 24;
const SUMMARY_MIN_BATCH_MESSAGES = 8;
const SUMMARY_MAX_CHARS = 1600;
const MEMORY_TOTAL_LIMIT = 10;
const MEMORY_ALWAYS_USEFUL_LIMIT = 6;
const MEMORY_TOPIC_LIMIT = 6;
const MEMORY_CHAR_BUDGET = 2400;
const MEMORY_TITLE_MAX_CHARS = 20;
const MEMORY_CONTENT_MAX_CHARS = 200;
const AUTO_MEMORY_MAX_PER_TURN = 1;
const AUTO_MEMORY_EVIDENCE_REQUIRED = 2;
const AUTO_MEMORY_CANDIDATE_LIMIT = 12;
const AUTO_MEMORY_CANDIDATE_TTL_DAYS = 30;
const AUTOMATIC_LONG_TERM_MEMORY_TYPES = new Set([
  "shared_joke",
  "important_event",
  "relationship_context",
  "expression_preference",
  "emotional_pattern",
  "boundary",
  "sexual_boundary_preference",
  "persona_feedback",
]);
const EXPLICIT_PREFERENCE_TYPES = new Set([
  "expression_preference",
  "boundary",
  "sexual_boundary_preference",
  "persona_feedback",
]);
const MEMORY_ALWAYS_USEFUL_TYPES = [
  "expression_preference",
  "boundary",
  "sexual_boundary_preference",
  "persona_feedback",
];
const DEFAULT_MODEL = "ernie-4.5-turbo-128k";
const DEFAULT_AUTO_BACKUP_INTERVAL_HOURS = 6;
const DEFAULT_AUTO_BACKUP_RETENTION_COUNT = 14;
const SEARCH_STOPWORDS_PATTERN =
  /用户|石头|林石|之前|刚才|最近|今天|昨天|明天|这个|那个|这段|那段|这件事|那件事|聊天|对话|聊过|提到|觉得|开始|有点|一个|一些|自己|当前|现在|还是/g;

loadEnv(path.join(rootDir, ".env"));

const config = {
  port: Number(process.env.API_PORT || 3001),
  host: process.env.API_HOST || "127.0.0.1",
  apiKey: process.env.AI_STUDIO_API_KEY || "",
  baseUrl: stripTrailingSlash(
    process.env.AI_STUDIO_BASE_URL || "https://aistudio.baidu.com/llm/lmapi/v3",
  ),
  model: process.env.AI_STUDIO_MODEL || DEFAULT_MODEL,
  backupIntervalMs: getPositiveNumber(
    process.env.AUTO_BACKUP_INTERVAL_HOURS,
    DEFAULT_AUTO_BACKUP_INTERVAL_HOURS,
  ) * 60 * 60 * 1000,
  backupRetentionCount: getPositiveNumber(
    process.env.AUTO_BACKUP_RETENTION_COUNT,
    DEFAULT_AUTO_BACKUP_RETENTION_COUNT,
  ),
};

const store = loadStore();
const conversations = store.conversations;
const memories = store.memories;
const settings = store.settings;
config.model = normalizeModelName(settings.model || config.model || DEFAULT_MODEL);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "OPTIONS") {
      sendEmpty(res, 204);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, model: config.model });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/settings") {
      handleGetSettings(res);
      return;
    }

    if (req.method === "PATCH" && url.pathname === "/api/settings") {
      await handleUpdateSettings(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/export") {
      handleExportData(res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/export/conversations") {
      handleExportConversations(res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/export/memories") {
      handleExportMemories(res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/clear/memories") {
      await handleClearMemories(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/chat/messages") {
      await handleChatMessage(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/chat/conversations") {
      handleListConversations(res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/memories") {
      handleListMemories(url, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/memories") {
      await handleCreateMemory(req, res);
      return;
    }

    const memoryMatch = url.pathname.match(/^\/api\/memories\/([^/]+)$/);
    if (memoryMatch && req.method === "PATCH") {
      await handleUpdateMemory(memoryMatch[1], req, res);
      return;
    }

    if (memoryMatch && req.method === "DELETE") {
      await handleDeleteMemory(memoryMatch[1], res);
      return;
    }

    const messagesMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/messages$/);
    if (req.method === "GET" && messagesMatch) {
      handleGetMessages(messagesMatch[1], res);
      return;
    }

    const deleteMessagesMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/messages\/delete$/);
    if (req.method === "POST" && deleteMessagesMatch) {
      await handleDeleteConversationMessages(deleteMessagesMatch[1], req, res);
      return;
    }

    const messageMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/messages\/([^/]+)$/);
    if (req.method === "DELETE" && messageMatch) {
      await handleDeleteConversationMessage(messageMatch[1], messageMatch[2], res);
      return;
    }

    const conversationMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)$/);
    if (conversationMatch && req.method === "PATCH") {
      await handleUpdateConversation(conversationMatch[1], req, res);
      return;
    }

    if (conversationMatch && req.method === "DELETE") {
      await handleDeleteConversation(conversationMatch[1], res);
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      await serveStatic(
        url.pathname,
        res,
        req.method === "HEAD",
        req.headers["accept-encoding"] || "",
      );
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, {
      error: "server_error",
      message: "后端刚刚摔了一跤，等下再试试。",
    });
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  server.listen(config.port, config.host, () => {
    console.log(`Electronic Friend API running at http://${config.host}:${config.port}`);
    console.log(`Chat UI available at http://${config.host}:${config.port}`);
    startAutoBackup();
  });
}

async function handleChatMessage(req, res) {
  if (!hasUsableApiKey(config.apiKey)) {
    sendJson(res, 500, {
      error: "missing_api_key",
      message: "还没有配置 AI_STUDIO_API_KEY，先在 .env 里填入 AI Studio 访问令牌。",
    });
    return;
  }

  const body = await readJson(req);
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const conversationId = body.conversation_id || randomUUID();
  const requestId = typeof body.request_id === "string"
    ? body.request_id.trim().slice(0, 128)
    : "";

  if (!content) {
    sendJson(res, 400, {
      error: "empty_content",
      message: "你得先说点什么，石头才能接话。",
    });
    return;
  }

  const now = new Date().toISOString();
  const conversation = getConversation(conversationId);
  const replay = findRequestReplay(conversation, requestId, content);
  let userMessage = replay.userMessage;

  if (replay.conflict) {
    sendJson(res, 409, {
      error: "request_id_conflict",
      message: "这次重试的内容和原消息对不上，先重新发送一次。",
    });
    return;
  }

  const completedReply = replay.completedReply;

  if (userMessage && completedReply) {
    sendChatResponse(res, userMessage, completedReply, conversation, { deduplicated: true });
    return;
  }

  if (!userMessage) {
    userMessage = {
      id: randomUUID(),
      conversation_id: conversationId,
      role: "user",
      content,
      status: "sent",
      input_type: body.input_type || "text",
      request_id: requestId || null,
      created_at: now,
    };
    conversation.messages.push(userMessage);
  }
  if (!conversation.title) {
    conversation.title = createConversationTitle(content);
  }
  conversation.last_active_at = now;
  pruneExpiredMemoryCandidates(memories);
  await saveConversations();

  const selectedMemories = selectRelevantMemories(content, conversation);
  const classification = await classifyMessage(content, conversation.messages, selectedMemories);
  applyClassification(userMessage, classification);
  await saveConversations();

  if (isHighRiskCrisis(content) || classification.risk_level === "high") {
    const assistantMessage = createAssistantMessage(
      conversationId,
      crisisSupportReply(),
      new Date().toISOString(),
      requestId,
    );
    conversation.messages.push(assistantMessage);
    conversation.last_active_at = assistantMessage.created_at;
    await saveConversations();

    sendChatResponse(res, userMessage, assistantMessage, conversation);
    return;
  }

  const systemPrompt = await readFile(promptPaths.system, "utf8");
  const modelMessages = buildModelMessages(
    systemPrompt,
    conversation,
    classification,
    selectedMemories,
  );
  const draftAssistantText = await callAiStudio(modelMessages);
  const assistantText = await rewriteResponse(
    content,
    draftAssistantText,
    classification,
    selectedMemories,
  );

  const assistantMessage = createAssistantMessage(
    conversationId,
    assistantText,
    new Date().toISOString(),
    requestId,
  );
  conversation.messages.push(assistantMessage);
  conversation.last_active_at = assistantMessage.created_at;

  const memoryChanges = await collectMemoryCandidates(
    userMessage,
    conversation.messages,
    classification,
  );
  const summaryChange = await maybeSummarizeConversation(conversation, selectedMemories);
  await saveConversations();

  sendChatResponse(res, userMessage, assistantMessage, conversation, {
    memory_changes: memoryChanges,
    summary_change: summaryChange,
  });
}

function findRequestReplay(conversation, requestId, content) {
  if (!requestId) {
    return { userMessage: null, completedReply: null, conflict: false };
  }

  const userMessage = (conversation.messages || []).find((message) =>
    message.role === "user" && message.request_id === requestId && !message.deleted_at) || null;
  const completedReply = (conversation.messages || []).find((message) =>
    message.role === "assistant" &&
    message.in_reply_to_request_id === requestId &&
    !message.deleted_at) || null;

  return {
    userMessage,
    completedReply,
    conflict: Boolean(userMessage && userMessage.content !== content),
  };
}

function sendChatResponse(res, userMessage, assistantMessage, conversation, meta = {}) {
  sendJson(res, 200, {
    user_message: userMessage,
    assistant_message: assistantMessage,
    conversation_state: {
      conversation_id: conversation.id,
      title: conversation.title || "这段聊天",
      pinned: Boolean(conversation.pinned),
      recent_summary: conversation.recent_summary || null,
      current_mood_hint: conversation.current_mood_hint || null,
      summarized_until_message_id: conversation.summarized_until_message_id || null,
      summary_updated_at: conversation.summary_updated_at || null,
      last_active_at: conversation.last_active_at,
    },
    meta,
  });
}

function createAssistantMessage(conversationId, content, createdAt, requestId = "") {
  return {
    id: randomUUID(),
    conversation_id: conversationId,
    role: "assistant",
    content,
    status: "sent",
    input_type: null,
    in_reply_to_request_id: requestId || null,
    created_at: createdAt,
  };
}

function isHighRiskCrisis(content) {
  const normalized = content.replace(/\s+/g, "");
  const highRiskSignals = [
    "不想活",
    "不活了",
    "想死",
    "想自杀",
    "自杀",
    "结束生命",
    "伤害自己",
    "撑不下去",
    "活不下去",
    "死了算了",
    "一了百了",
  ];

  return highRiskSignals.some((signal) => normalized.includes(signal));
}

function crisisSupportReply() {
  return [
    "先别一个人扛着。你现在这个状态很危险，我认真说。",
    "先把手边可能伤到自己的东西放远一点，然后马上联系一个现实里能到你身边的人。朋友、家人、同事都行，别自己硬撑。",
    "如果你觉得自己可能马上会做危险的事，直接联系当地紧急服务。你先把现实的人拉进来，我在这儿陪你把这几分钟撑过去。",
  ].join("\n\n");
}

function handleGetMessages(conversationId, res) {
  const conversation = conversations.get(conversationId);
  if (!conversation) {
    sendJson(res, 404, {
      error: "conversation_not_found",
      message: "这段聊天暂时没找到，可能还没开始聊。",
    });
    return;
  }

  sendJson(res, 200, {
    messages: getVisibleMessages(conversation.messages),
    conversation_state: {
      conversation_id: conversation.id,
      title: conversation.title || "这段聊天",
      pinned: Boolean(conversation.pinned),
      recent_summary: conversation.recent_summary || null,
      current_mood_hint: conversation.current_mood_hint || null,
      summarized_until_message_id: conversation.summarized_until_message_id || null,
      summary_updated_at: conversation.summary_updated_at || null,
      last_active_at: conversation.last_active_at,
    },
  });
}

function handleListConversations(res) {
  const items = [...conversations.values()]
    .filter((conversation) => getVisibleMessages(conversation.messages).length > 0)
    .sort(compareConversations)
    .map(formatConversationSummary);

  sendJson(res, 200, { conversations: items });
}

function handleGetSettings(res) {
  sendJson(res, 200, formatPublicSettings());
}

async function handleUpdateSettings(req, res) {
  const body = await readJson(req);

  if (body.model !== undefined) {
    const nextModel = normalizeModelName(body.model);
    if (!getAvailableModels().includes(nextModel)) {
      sendJson(res, 400, {
        error: "unsupported_model",
        message: "这个模型现在不在可选列表里。",
        available_models: getAvailableModels(),
      });
      return;
    }

    settings.model = nextModel;
    config.model = nextModel;
  }

  settings.updated_at = new Date().toISOString();
  await saveConversations();
  sendJson(res, 200, formatPublicSettings());
}

async function handleUpdateConversation(conversationId, req, res) {
  const conversation = conversations.get(conversationId);

  if (!conversation) {
    sendJson(res, 404, {
      error: "conversation_not_found",
      message: "这段聊天暂时没找到。",
    });
    return;
  }

  const body = await readJson(req);

  if (body.title !== undefined) {
    conversation.title = normalizeConversationTitle(body.title);
  }

  if (body.pinned !== undefined) {
    conversation.pinned = Boolean(body.pinned);
  }

  conversation.updated_at = new Date().toISOString();
  await saveConversations();
  sendJson(res, 200, { conversation: formatConversationSummary(conversation) });
}

async function handleDeleteConversation(conversationId, res) {
  const conversation = conversations.get(conversationId);

  if (!conversation) {
    sendJson(res, 404, {
      error: "conversation_not_found",
      message: "这段聊天暂时没找到。",
    });
    return;
  }

  conversations.delete(conversationId);
  await saveConversations();
  sendJson(res, 200, { conversation_id: conversationId });
}

async function handleDeleteConversationMessage(conversationId, messageId, res) {
  const conversation = conversations.get(conversationId);

  if (!conversation) {
    sendJson(res, 404, {
      error: "conversation_not_found",
      message: "这段聊天暂时没找到。",
    });
    return;
  }

  const result = deleteConversationMessages(conversation, [messageId], memories);
  if (result.deleted_count === 0) {
    sendJson(res, 404, {
      error: "message_not_found",
      message: "这条消息暂时没找到。",
    });
    return;
  }

  await saveConversations();
  sendJson(res, 200, formatMessageDeletionResponse(conversation, result));
}

async function handleDeleteConversationMessages(conversationId, req, res) {
  const conversation = conversations.get(conversationId);

  if (!conversation) {
    sendJson(res, 404, {
      error: "conversation_not_found",
      message: "这段聊天暂时没找到。",
    });
    return;
  }

  const body = await readJson(req);
  const messageIds = Array.isArray(body.message_ids) ? body.message_ids : [];

  if (!messageIds.length) {
    sendJson(res, 400, {
      error: "empty_message_ids",
      message: "先选几条要删的消息。",
    });
    return;
  }

  const result = deleteConversationMessages(conversation, messageIds, memories);
  await saveConversations();
  sendJson(res, 200, formatMessageDeletionResponse(conversation, result));
}

function handleExportData(res) {
  sendJson(res, 200, {
    exported_at: new Date().toISOString(),
    conversations: Object.fromEntries(conversations.entries()),
    memories,
  });
}

function handleExportConversations(res) {
  sendJson(res, 200, {
    exported_at: new Date().toISOString(),
    kind: "conversations",
    count: conversations.size,
    conversations: Object.fromEntries(conversations.entries()),
  });
}

function handleExportMemories(res) {
  sendJson(res, 200, {
    exported_at: new Date().toISOString(),
    kind: "memories",
    count: memories.length,
    memories,
  });
}

async function handleClearMemories(req, res) {
  const body = await readJson(req);

  if (body.confirm !== "CLEAR_MEMORIES") {
    sendJson(res, 400, {
      error: "confirmation_required",
      message: "清空记忆需要确认。",
    });
    return;
  }

  const deletedCount = memories.length;
  memories.splice(0, memories.length);
  await saveConversations();
  sendJson(res, 200, { deleted_count: deletedCount });
}

function handleListMemories(url, res) {
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");
  const filtered = memories
    .filter((memory) => !type || memory.type === type)
    .filter((memory) => !status || memory.status === status)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));

  sendJson(res, 200, { memories: filtered.map((memory) => formatMemoryForClient(memory)) });
}

function formatMemoryForClient(memory, conversationPool = conversations) {
  const sourceIds = new Set(
    (Array.isArray(memory.source_message_ids) ? memory.source_message_ids : [])
      .map((id) => String(id)),
  );
  let source = null;

  if (sourceIds.size) {
    for (const conversation of conversationPool.values()) {
      const message = (conversation.messages || []).find((item) =>
        sourceIds.has(String(item.id)) && !item.deleted_at && item.status !== "deleted");
      if (!message) continue;
      source = {
        conversation_id: conversation.id,
        conversation_title: conversation.title || "这段聊天",
        message_created_at: message.created_at || null,
      };
      break;
    }
  }

  return { ...memory, source };
}

async function handleCreateMemory(req, res) {
  const body = await readJson(req);
  const memory = normalizeMemory(body, {
    id: randomUUID(),
    status: body.status || "active",
    user_confirmed: Boolean(body.user_confirmed ?? true),
    source_message_ids: body.source_message_ids || [],
  });

  memories.push(memory);
  await saveConversations();
  sendJson(res, 201, { memory: formatMemoryForClient(memory) });
}

async function handleUpdateMemory(memoryId, req, res) {
  const body = await readJson(req);
  const memory = memories.find((item) => item.id === memoryId);

  if (!memory) {
    sendJson(res, 404, { error: "memory_not_found" });
    return;
  }

  for (const key of ["type", "content", "display_title", "status", "sensitivity"]) {
    if (body[key] !== undefined) {
      memory[key] = body[key];
    }
  }

  if (body.user_confirmed !== undefined) {
    memory.user_confirmed = Boolean(body.user_confirmed);
    if (memory.user_confirmed) {
      memory.auto_managed = false;
      memory.expires_at = "";
    }
  }

  memory.updated_at = new Date().toISOString();
  await saveConversations();
  sendJson(res, 200, { memory: formatMemoryForClient(memory) });
}

async function handleDeleteMemory(memoryId, res) {
  const index = memories.findIndex((item) => item.id === memoryId);

  if (index === -1) {
    sendJson(res, 404, { error: "memory_not_found" });
    return;
  }

  const [memory] = memories.splice(index, 1);
  await saveConversations();
  sendJson(res, 200, { memory });
}

function getConversation(conversationId) {
  if (!conversations.has(conversationId)) {
    conversations.set(conversationId, {
      id: conversationId,
      title: "",
      pinned: false,
      messages: [],
      recent_summary: "",
      current_mood_hint: "",
      summarized_until_message_id: "",
      summary_updated_at: "",
      created_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
    });
  }

  return conversations.get(conversationId);
}

function normalizeConversation(id, conversation) {
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  const createdAt = conversation.created_at || messages[0]?.created_at || new Date().toISOString();
  const lastActiveAt =
    conversation.last_active_at ||
    messages.at(-1)?.created_at ||
    createdAt;

  return {
    ...conversation,
    id: conversation.id || id,
    title: conversation.title || createConversationTitle(messages.find((message) => message.role === "user")?.content || ""),
    pinned: Boolean(conversation.pinned),
    messages,
    recent_summary: conversation.recent_summary || "",
    current_mood_hint: conversation.current_mood_hint || "",
    summarized_until_message_id: conversation.summarized_until_message_id || "",
    summary_updated_at: conversation.summary_updated_at || "",
    created_at: createdAt,
    last_active_at: lastActiveAt,
    updated_at: conversation.updated_at || lastActiveAt,
  };
}

function loadStore() {
  if (!existsSync(storePath)) {
    return { conversations: new Map(), memories: [], settings: {} };
  }

  try {
    const parsed = JSON.parse(readFileSyncSafe(storePath));
    return {
      conversations: new Map(
      Object.entries(parsed.conversations || {}).map(([id, conversation]) => [
        id,
        normalizeConversation(id, conversation),
      ]),
      ),
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
      settings: parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {},
    };
  } catch (error) {
    console.error("Failed to load local store", error.message);
    return { conversations: new Map(), memories: [], settings: {} };
  }
}

async function saveConversations() {
  await mkdir(dataDir, { recursive: true });
  const conversationsObject = Object.fromEntries(conversations.entries());
  await writeFile(
    storePath,
    JSON.stringify({ conversations: conversationsObject, memories, settings }, null, 2),
    "utf8",
  );
}

function createBackupPayload(store = { conversations, memories, settings }, exportedAt = new Date().toISOString()) {
  const conversationEntries = store.conversations instanceof Map
    ? Object.fromEntries(store.conversations.entries())
    : store.conversations || {};
  const backupSettings = {
    model: typeof store.settings?.model === "string" ? store.settings.model : "",
    updated_at: typeof store.settings?.updated_at === "string" ? store.settings.updated_at : "",
  };

  return {
    backup_version: 1,
    exported_at: exportedAt,
    source: "automatic_local_backup",
    conversations: conversationEntries,
    memories: Array.isArray(store.memories) ? store.memories : [],
    settings: backupSettings,
  };
}

async function createAutomaticBackup(options = {}) {
  const targetDir = options.backupDir || backupDir;
  const now = options.now || new Date();
  const timestamp = now.toISOString();
  const filename = `shitou-backup-${timestamp.replace(/[:.]/g, "-")}.json`;
  const targetPath = path.join(targetDir, filename);
  const payload = createBackupPayload(options.store, timestamp);
  const retentionCount = options.retentionCount || config.backupRetentionCount;

  await mkdir(targetDir, { recursive: true });
  const temporaryPath = `${targetPath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(payload, null, 2), "utf8");
  await rename(temporaryPath, targetPath);
  await pruneAutomaticBackups(targetDir, retentionCount);

  return { path: targetPath, filename, exported_at: timestamp };
}

async function pruneAutomaticBackups(targetDir, retentionCount) {
  const entries = await readdir(targetDir, { withFileTypes: true });
  const backupFiles = entries
    .filter((entry) => entry.isFile() && /^shitou-backup-.*\.json$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  await Promise.all(
    backupFiles.slice(retentionCount).map((filename) => unlink(path.join(targetDir, filename))),
  );
}

function startAutoBackup() {
  void runAutomaticBackup("启动");
  const timer = setInterval(() => {
    void runAutomaticBackup("定时");
  }, config.backupIntervalMs);
  timer.unref();
}

async function runAutomaticBackup(reason) {
  try {
    const backup = await createAutomaticBackup();
    console.log(`已${reason}存档：${path.relative(rootDir, backup.path)}`);
  } catch (error) {
    console.error(`自动存档失败（${reason}）`, error.message);
  }
}

function formatConversationSummary(conversation) {
  const visibleMessages = getVisibleMessages(conversation.messages);
  const latest = visibleMessages.at(-1);

  return {
    id: conversation.id,
    title: conversation.title || "这段聊天",
    pinned: Boolean(conversation.pinned),
    preview: latest?.content ? latest.content.slice(0, 80) : "还没聊几句。",
    message_count: visibleMessages.length,
    created_at: conversation.created_at,
    last_active_at: conversation.last_active_at,
  };
}

function formatMessageDeletionResponse(conversation, result) {
  return {
    ...result,
    messages: getVisibleMessages(conversation.messages),
    conversation_state: {
      conversation_id: conversation.id,
      title: conversation.title || "这段聊天",
      pinned: Boolean(conversation.pinned),
      recent_summary: conversation.recent_summary || null,
      current_mood_hint: conversation.current_mood_hint || null,
      summarized_until_message_id: conversation.summarized_until_message_id || null,
      summary_updated_at: conversation.summary_updated_at || null,
      last_active_at: conversation.last_active_at,
    },
  };
}

function deleteConversationMessages(conversation, messageIds, memoryPool = memories, deletedAt = new Date().toISOString()) {
  const ids = new Set(messageIds.map((id) => String(id)).filter(Boolean));
  const deletedIds = [];

  for (const message of conversation.messages || []) {
    if (!ids.has(String(message.id)) || message.deleted_at || message.status === "deleted") {
      continue;
    }

    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }

    message.content = "";
    message.status = "deleted";
    message.deleted_at = deletedAt;
    message.updated_at = deletedAt;
    deletedIds.push(message.id);
  }

  let archivedMemoryCount = 0;
  if (deletedIds.length) {
    const deletedIdSet = new Set(deletedIds);
    for (const memory of memoryPool) {
      const sourceIds = Array.isArray(memory.source_message_ids) ? memory.source_message_ids : [];
      if (memory.status !== "archived" && sourceIds.some((id) => deletedIdSet.has(id))) {
        memory.status = "archived";
        memory.updated_at = deletedAt;
        archivedMemoryCount += 1;
      }
    }

    conversation.recent_summary = "";
    conversation.current_mood_hint = "";
    conversation.summarized_until_message_id = "";
    conversation.summary_updated_at = "";
    conversation.updated_at = deletedAt;
  }

  return {
    deleted_count: deletedIds.length,
    deleted_message_ids: deletedIds,
    archived_memory_count: archivedMemoryCount,
    summary_invalidated: deletedIds.length > 0,
  };
}

function compareConversations(a, b) {
  if (Boolean(a.pinned) !== Boolean(b.pinned)) {
    return a.pinned ? -1 : 1;
  }

  return String(b.last_active_at).localeCompare(String(a.last_active_at));
}

function createConversationTitle(content) {
  const cleaned = String(content || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "新聊天";
  }

  return cleaned.length > 22 ? `${cleaned.slice(0, 22)}...` : cleaned;
}

function normalizeConversationTitle(title) {
  const cleaned = String(title || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "这段聊天";
  }

  return cleaned.slice(0, 40);
}

function buildModelMessages(systemPrompt, conversation, classification, selectedMemories) {
  const recent = getRecentVisibleMessages(conversation.messages, RECENT_MESSAGE_LIMIT)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

  const contextSections = [
    "## 当前内部信号",
    "这些信息只供你调整回复策略，不要向用户暴露标签或 JSON。",
    `classification: ${JSON.stringify(classification)}`,
    `selected_memories: ${JSON.stringify(selectedMemories.map(formatMemoryForPrompt))}`,
  ];

  if (conversation.recent_summary) {
    contextSections.push(
      "",
      "## 当前会话摘要",
      "这是一段较早聊天的压缩上下文。自然使用，不要向用户说明你在读摘要。",
      truncateText(conversation.recent_summary, SUMMARY_MAX_CHARS),
    );
  }

  if (conversation.current_mood_hint) {
    contextSections.push(
      "",
      "## 当前短期状态提示",
      conversation.current_mood_hint,
    );
  }

  return [
    {
      role: "system",
      content: [
        systemPrompt,
        "",
        ...contextSections,
      ].join("\n"),
    },
    ...recent,
  ];
}

async function classifyMessage(userMessage, recentMessages, selectedMemories) {
  const prompt = await readFile(promptPaths.emotionClassifier, "utf8");
  const fallback = fallbackClassification(userMessage);

  try {
    const content = await callAiStudio([
      { role: "system", content: prompt },
      {
        role: "user",
        content: JSON.stringify(
          {
            user_message: userMessage,
            recent_messages: recentMessages.slice(-8).map(formatMessageForPrompt),
            selected_memories: selectedMemories.map(formatMemoryForPrompt),
          },
          null,
          2,
        ),
      },
    ], { responseFormat: "json_object", temperature: 0.2, maxTokens: 900 });
    return { ...fallback, ...parseJsonObject(content) };
  } catch (error) {
    console.error("Emotion classifier failed", error.message);
    return fallback;
  }
}

async function rewriteResponse(userMessage, draftResponse, classification, selectedMemories) {
  const prompt = await readFile(promptPaths.responseRewriter, "utf8");

  try {
    const content = await callAiStudio([
      { role: "system", content: prompt },
      {
        role: "user",
        content: JSON.stringify(
          {
            user_message: userMessage,
            draft_response: draftResponse,
            classification,
            selected_memories: selectedMemories.map(formatMemoryForPrompt),
          },
          null,
          2,
        ),
      },
    ], { responseFormat: "json_object", temperature: 0.35, maxTokens: 900 });
    const parsed = parseJsonObject(content);
    return typeof parsed.rewritten_response === "string"
      ? parsed.rewritten_response.trim()
      : draftResponse;
  } catch (error) {
    console.error("Response rewriter failed", error.message);
    return draftResponse;
  }
}

async function collectMemoryCandidates(userMessage, recentMessages, classification) {
  if (!shouldRunMemoryExtractor(classification, userMessage.content)) {
    return [];
  }

  const prompt = await readFile(promptPaths.memoryExtractor, "utf8");
  const priorUserMessages = recentMessages
    .filter((message) => message.role === "user" && message.id !== userMessage.id)
    .slice(-6);
  const allowedEvidenceMessageIds = [
    userMessage.id,
    ...priorUserMessages.map((message) => message.id),
  ];

  try {
    const content = await callAiStudio([
      { role: "system", content: prompt },
      {
        role: "user",
        content: JSON.stringify(
           {
             user_message: {
               id: userMessage.id,
               content: userMessage.content,
             },
             recent_messages: priorUserMessages.map(formatMessageForPrompt),
             classification,
             existing_memories: memories
               .filter((memory) => memory.status !== "archived")
               .slice(-60)
               .map(formatMemoryForPrompt),
          },
          null,
          2,
        ),
      },
    ], { responseFormat: "json_object", temperature: 0.2, maxTokens: 1400 });
    const parsed = parseJsonObject(content);
    const changes = [];

    if (parsed.memory_action === "forget" || classification.memory_action === "forget") {
      const archived = archiveMatchingMemories(userMessage.content);
      if (archived > 0) {
        changes.push({ action: "archived", count: archived });
      }
    }

    const expiredCount = pruneExpiredMemoryCandidates(memories);
    if (expiredCount > 0) {
      changes.push({ action: "expired", count: expiredCount });
    }

    const candidates = selectAutomaticMemoryCandidates(parsed.memories);

    for (const memoryCandidate of candidates) {
      const change = applyAutomaticMemoryCandidate(memories, memoryCandidate, {
        classification,
        memoryAction: parsed.memory_action,
        sourceMessageId: userMessage.id,
        allowedEvidenceMessageIds,
      });
      if (change) {
        changes.push(change);
      }
    }

    return changes;
  } catch (error) {
    console.error("Memory extractor failed", error.message);
    return [];
  }
}

async function maybeSummarizeConversation(conversation, selectedMemories) {
  const { visibleMessages, messagesToSummarize } = getSummaryBatch(conversation);

  if (visibleMessages.length <= SUMMARY_TRIGGER_MESSAGE_COUNT) {
    return { action: "skipped", reason: "message_count_below_threshold" };
  }

  if (messagesToSummarize.length < SUMMARY_MIN_BATCH_MESSAGES) {
    return { action: "skipped", reason: "not_enough_new_messages" };
  }

  const prompt = await readFile(promptPaths.conversationSummarizer, "utf8");

  try {
    const content = await callAiStudio([
      { role: "system", content: prompt },
      {
        role: "user",
        content: JSON.stringify(
          {
            old_summary: conversation.recent_summary || "",
            new_messages: messagesToSummarize.map(formatMessageForPrompt),
            selected_memories: selectedMemories.map(formatMemoryForPrompt),
          },
          null,
          2,
        ),
      },
    ], { responseFormat: "json_object", temperature: 0.2, maxTokens: 1800 });
    const parsed = parseJsonObject(content);
    const summary = typeof parsed.recent_summary === "string"
      ? parsed.recent_summary.trim()
      : conversation.recent_summary || "";

    if (!summary) {
      return { action: "skipped", reason: "empty_summary" };
    }

    conversation.recent_summary = truncateText(summary, SUMMARY_MAX_CHARS);
    conversation.current_mood_hint =
      typeof parsed.current_mood_hint === "string"
        ? truncateText(parsed.current_mood_hint.trim(), 160)
        : conversation.current_mood_hint || "";
    conversation.summarized_until_message_id = messagesToSummarize.at(-1).id;
    conversation.summary_updated_at = new Date().toISOString();

    return {
      action: "updated",
      summarized_message_count: messagesToSummarize.length,
      summarized_until_message_id: conversation.summarized_until_message_id,
    };
  } catch (error) {
    console.error("Conversation summarizer failed", error.message);
    return { action: "skipped", reason: "summarizer_failed" };
  }
}

function getSummaryBatch(conversation) {
  const visibleMessages = getVisibleMessages(conversation.messages);
  const summarizedIndex = conversation.summarized_until_message_id
    ? visibleMessages.findIndex((message) => message.id === conversation.summarized_until_message_id)
    : -1;
  const unsummarizedMessages = visibleMessages.slice(summarizedIndex + 1);
  const recentMessageIds = new Set(
    visibleMessages.slice(-RECENT_MESSAGE_LIMIT).map((message) => message.id),
  );
  const messagesToSummarize = unsummarizedMessages.filter(
    (message) => !recentMessageIds.has(message.id),
  );

  return { visibleMessages, messagesToSummarize };
}

function shouldRunMemoryExtractor(classification, content) {
  const candidateHasDurableSignal =
    classification.should_collect_memory_candidate &&
    hasDurableMemorySignal(classification, content) &&
    !isOneOffEmotionalCandidate(classification, content);
  const isMemoryReview = isMemoryReviewRequest(classification, content);

  return (
    candidateHasDurableSignal ||
    isMemoryReview ||
    classification.memory_action === "remember" ||
    classification.memory_action === "forget"
  );
}

function isMemoryReviewRequest(classification, content) {
  const intents = Array.isArray(classification.intent)
    ? classification.intent
    : [classification.intent].filter(Boolean);
  const hasMemoryManagementIntent = intents.some((intent) =>
    /记忆管理|记忆核对|回忆核对/.test(intent));
  const asksToRecall =
    /还记得|记得吗|记不记得|记住了吗|忘了没|忘没忘|叫什么|姓什么|谁来着|是哪一个|是哪个/.test(
      content,
    );
  return hasMemoryManagementIntent && asksToRecall;
}

function selectAutomaticMemoryCandidates(candidates) {
  return Array.isArray(candidates)
    ? candidates
        .filter((candidate) => candidate && typeof candidate === "object")
        .slice(0, AUTO_MEMORY_MAX_PER_TURN)
    : [];
}

function hasDurableMemorySignal(classification, content) {
  if (classification.style_feedback) {
    return true;
  }

  const intents = Array.isArray(classification.intent)
    ? classification.intent
    : [classification.intent].filter(Boolean);
  if (intents.some((intent) => /记住|记忆管理|风格反馈|边界反馈/.test(intent))) {
    return true;
  }

  const hasStableRelationshipAnchor =
    /(老板|领导|上司|同事|朋友|家人|室友|对象|前任|暧昧对象).{0,6}(姓|叫|名字|外号|昵称)/.test(content) ||
    /(姓|叫|名字是|外号是|昵称是).{1,8}(老板|领导|上司|同事|朋友|家人|室友|对象|前任|暧昧对象)/.test(content);
  if (hasStableRelationshipAnchor) {
    return true;
  }

  return /以后|每次|总是|天天|一直|反复|长期|习惯|通常|我发现|老是|别再|不要再|不喜欢|讨厌|更喜欢|叫他|叫她|就叫|辞职|离职|入职|换工作|换岗|转岗|升职|降职|被裁|失业|搬家|分手|恋爱|在一起了|结婚|毕业/.test(content);
}

function isOneOffEmotionalCandidate(classification, content) {
  const emotion = classification.emotion;
  const memoryAction = classification.memory_action;
  const hasStablePatternSignal = /每次|总是|天天|一直|反复|长期|通常|我发现|老是/.test(content);
  return (
    memoryAction === "candidate" &&
    ["自我否定", "难过", "焦虑", "疲惫", "孤独", "内耗"].includes(emotion) &&
    !classification.style_feedback &&
    !hasStablePatternSignal
  );
}

function applyAutomaticMemoryCandidate(memoryPool, candidate, options = {}) {
  const type = String(candidate?.type || "").trim();
  const content = String(candidate?.content || "").trim();
  if (!AUTOMATIC_LONG_TERM_MEMORY_TYPES.has(type) || !content) {
    return null;
  }

  const now = options.now || new Date().toISOString();
  const sourceMessageId = String(options.sourceMessageId || "").trim();
  const allowedEvidenceMessageIds = uniqueStrings(
    (options.allowedEvidenceMessageIds || [sourceMessageId])
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  );
  const classification = options.classification || {};
  const memoryAction = options.memoryAction || classification.memory_action || "none";
  const explicitlyConfirmed =
    memoryAction === "remember" ||
    classification.memory_action === "remember" ||
    (classification.style_feedback && EXPLICIT_PREFERENCE_TYPES.has(type)) ||
    (classification.memory_action === "forget" && type === "boundary");

  const requestedExistingId = String(candidate.existing_memory_id || "").trim();
  const existingById = requestedExistingId
    ? memoryPool.find((memory) =>
        memory.id === requestedExistingId &&
        memory.status !== "archived" &&
        areMemoryTypesCompatible(memory.type, type))
    : null;
  const existing = existingById || findSimilarMemory(memoryPool, {
    ...candidate,
    type,
    content,
  });
  const sensitivity =
    candidate.sensitivity === "sensitive" || existing?.sensitivity === "sensitive"
      ? "sensitive"
      : "normal";

  if (!existing && !explicitlyConfirmed && countAutomaticCandidates(memoryPool) >= AUTO_MEMORY_CANDIDATE_LIMIT) {
    return { action: "skipped", reason: "candidate_limit_reached" };
  }

  const priorSourceIds = existing?.source_message_ids || [];
  const requestedEvidenceIds = Array.isArray(candidate.supporting_message_ids)
    ? candidate.supporting_message_ids
    : [];
  const validatedEvidenceIds = uniqueStrings(
    requestedEvidenceIds
      .map((id) => String(id || "").trim())
      .filter((id) => allowedEvidenceMessageIds.includes(id)),
  );
  if (validatedEvidenceIds.length === 0 && sourceMessageId) {
    validatedEvidenceIds.push(sourceMessageId);
  }
  const sourceMessageIds = uniqueStrings([
    ...priorSourceIds,
    ...validatedEvidenceIds,
  ]);
  const priorEvidenceCount = existing
    ? Math.max(1, Number(existing.evidence_count) || priorSourceIds.length || 1)
    : 0;
  const newEvidenceCount = validatedEvidenceIds.filter(
    (id) => !priorSourceIds.includes(id),
  ).length;
  const evidenceCount = Math.max(
    sourceMessageIds.length,
    priorEvidenceCount + newEvidenceCount,
  );
  const shouldPromote =
    sensitivity === "normal" &&
    evidenceCount >= AUTO_MEMORY_EVIDENCE_REQUIRED;
  const status =
    existing?.status === "active" || explicitlyConfirmed || shouldPromote
      ? "active"
      : "candidate";
  const userConfirmed = Boolean(existing?.user_confirmed || explicitlyConfirmed);
  const autoManaged = !userConfirmed;
  const expiresAt = status === "candidate" && autoManaged
    ? addDays(now, AUTO_MEMORY_CANDIDATE_TTL_DAYS)
    : "";

  if (existing) {
    const wasActive = existing.status === "active";
    existing.type = type;
    existing.content = content.slice(0, MEMORY_CONTENT_MAX_CHARS);
    existing.display_title = String(
      candidate.display_title || existing.display_title || content,
    ).trim().slice(0, MEMORY_TITLE_MAX_CHARS);
    existing.status = status;
    existing.source_message_ids = sourceMessageIds;
    existing.sensitivity = sensitivity;
    existing.user_confirmed = userConfirmed;
    existing.why_this_matters = candidate.why_this_matters || existing.why_this_matters || "";
    existing.evidence_count = evidenceCount;
    existing.last_evidence_at = now;
    existing.auto_managed = autoManaged;
    existing.expires_at = expiresAt;
    existing.updated_at = now;
    return {
      action: status === "active" && !wasActive ? "promoted" : "updated",
      memory: existing,
    };
  }

  const memory = normalizeMemory(candidate, {
    id: randomUUID(),
    status,
    source_message_ids: sourceMessageIds,
    user_confirmed: userConfirmed,
    evidence_count: evidenceCount,
    last_evidence_at: now,
    auto_managed: autoManaged,
    expires_at: expiresAt,
    created_at: now,
    updated_at: now,
  });
  memoryPool.push(memory);
  return { action: "created", memory };
}

function findSimilarMemory(memoryPool, candidate) {
  let bestMatch = null;
  let bestScore = 0;

  for (const memory of memoryPool) {
    if (
      memory.status === "archived" ||
      !areMemoryTypesCompatible(memory.type, candidate.type)
    ) {
      continue;
    }
    const score = memorySimilarity(memory, candidate);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = memory;
    }
  }

  return bestScore >= 0.34 ? bestMatch : null;
}

function memorySimilarity(left, right) {
  const leftText = normalizeForSearch(`${left.display_title || ""}${left.content || ""}`);
  const rightText = normalizeForSearch(`${right.display_title || ""}${right.content || ""}`);
  if (!leftText || !rightText) {
    return 0;
  }
  if (leftText === rightText || leftText.includes(rightText) || rightText.includes(leftText)) {
    return 1;
  }

  const leftBigrams = new Set(extractBigrams(leftText));
  const rightBigrams = new Set(extractBigrams(rightText));
  let intersection = 0;
  for (const bigram of leftBigrams) {
    if (rightBigrams.has(bigram)) {
      intersection += 1;
    }
  }
  const union = leftBigrams.size + rightBigrams.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function extractBigrams(value) {
  const bigrams = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    bigrams.push(value.slice(index, index + 2));
  }
  return bigrams;
}

function areMemoryTypesCompatible(left, right) {
  if (left === right) {
    return true;
  }
  return (
    (left === "expression_preference" && right === "persona_feedback") ||
    (left === "persona_feedback" && right === "expression_preference")
  );
}

function countAutomaticCandidates(memoryPool) {
  return memoryPool.filter((memory) =>
    memory.status === "candidate" &&
    memory.auto_managed === true).length;
}

function pruneExpiredMemoryCandidates(memoryPool, now = new Date().toISOString()) {
  const nowTime = Date.parse(now);
  let removed = 0;

  for (let index = memoryPool.length - 1; index >= 0; index -= 1) {
    const memory = memoryPool[index];
    const expiresAt = Date.parse(memory.expires_at || "");
    if (
      memory.status === "candidate" &&
      memory.auto_managed === true &&
      Number.isFinite(expiresAt) &&
      expiresAt <= nowTime
    ) {
      memoryPool.splice(index, 1);
      removed += 1;
    }
  }

  return removed;
}

function addDays(isoTimestamp, days) {
  const date = new Date(isoTimestamp);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function selectRelevantMemories(content, conversation = {}, memoryPool = memories) {
  const recentText = getRecentVisibleMessages(conversation.messages || [], 6)
    .map((message) => message.content)
    .join("\n");
  const searchText = [
    content,
    conversation.recent_summary || "",
    conversation.current_mood_hint || "",
    recentText,
  ].join("\n");
  const normalized = normalizeForSearch(searchText);
  const activeMemories = memoryPool.filter((memory) => memory.status === "active");

  const alwaysUseful = activeMemories
    .filter((memory) => MEMORY_ALWAYS_USEFUL_TYPES.includes(memory.type))
    .sort(compareMemoryFreshness)
    .slice(0, MEMORY_ALWAYS_USEFUL_LIMIT);

  const scored = activeMemories
    .filter((memory) => !MEMORY_ALWAYS_USEFUL_TYPES.includes(memory.type))
    .map((memory) => ({
      memory,
      score: memoryScore(memory, normalized),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MEMORY_TOPIC_LIMIT)
    .map((item) => item.memory);

  return fitMemoriesToBudget(
    uniqueById([...alwaysUseful, ...scored]),
    MEMORY_TOTAL_LIMIT,
    MEMORY_CHAR_BUDGET,
  );
}

function memoryScore(memory, normalizedContent) {
  const haystack = normalizeForSearch(
    `${memory.display_title || ""} ${memory.content || ""}`,
  );
  const tokens = extractSearchKeywords(normalizedContent);
  let score = 0;

  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += 2;
    }
  }

  if (score === 0) {
    return 0;
  }

  if (memory.sensitivity === "sensitive" && score < 4) {
    return 0;
  }

  if (memory.status === "active") score += 3;
  if (["expression_preference", "boundary", "sexual_boundary_preference"].includes(memory.type)) {
    score += 3;
  }

  return score;
}

function compareMemoryFreshness(a, b) {
  const aTime = Date.parse(a.updated_at || a.created_at || "") || 0;
  const bTime = Date.parse(b.updated_at || b.created_at || "") || 0;

  if (a.status !== b.status) {
    return a.status === "active" ? -1 : 1;
  }

  return bTime - aTime;
}

function fitMemoriesToBudget(items, maxItems, maxChars) {
  const selected = [];
  let usedChars = 0;

  for (const item of items) {
    if (selected.length >= maxItems) {
      break;
    }

    const itemChars = JSON.stringify(formatMemoryForPrompt(item)).length;
    if (usedChars + itemChars > maxChars && selected.length > 0) {
      continue;
    }

    selected.push(item);
    usedChars += itemChars;
  }

  return selected;
}

function archiveMatchingMemories(content) {
  const normalized = normalizeForSearch(content);
  const keywords = extractSearchKeywords(normalized);
  let count = 0;

  for (const memory of memories) {
    if (memory.status === "archived") continue;
    const target = normalizeForSearch(`${memory.display_title || ""}${memory.content || ""}`);
    if (normalized.includes("忘") || normalized.includes("别提") || normalized.includes("不要再提")) {
      const hasOverlap = keywords.some((keyword) => target.includes(keyword));
      if (hasOverlap && target.length > 0) {
        memory.status = "archived";
        memory.updated_at = new Date().toISOString();
        count += 1;
      }
    }
  }

  return count;
}

function extractSearchKeywords(normalized) {
  const stripped = normalized
    .replace(/记住|记得|忘掉|忘记|别记|别提|不要再提|不要提/g, "")
    .replace(SEARCH_STOPWORDS_PATTERN, "");
  const keywords = new Set();

  for (let index = 0; index < stripped.length - 1; index += 1) {
    keywords.add(stripped.slice(index, index + 2));
  }

  return [...keywords].filter((keyword) => keyword.trim().length >= 2);
}

function normalizeMemory(input, overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id || input.id || randomUUID(),
    type: input.type || "current_state",
    content: String(input.content || "").trim().slice(0, MEMORY_CONTENT_MAX_CHARS),
    display_title: String(input.display_title || input.content || "未命名记忆").trim().slice(0, MEMORY_TITLE_MAX_CHARS),
    status: overrides.status || input.status || "candidate",
    source_message_ids: overrides.source_message_ids || input.source_message_ids || [],
    sensitivity: input.sensitivity || "normal",
    user_confirmed: Boolean(overrides.user_confirmed ?? input.user_confirmed ?? false),
    why_this_matters: input.why_this_matters || "",
    evidence_count: Number(overrides.evidence_count ?? input.evidence_count ?? 0),
    last_evidence_at: overrides.last_evidence_at || input.last_evidence_at || "",
    auto_managed: Boolean(overrides.auto_managed ?? input.auto_managed ?? false),
    expires_at: overrides.expires_at ?? input.expires_at ?? "",
    created_at: overrides.created_at || input.created_at || now,
    updated_at: overrides.updated_at || now,
  };
}

function applyClassification(message, classification) {
  message.emotion_label = classification.emotion || null;
  message.intent_label = Array.isArray(classification.intent)
    ? classification.intent.join(",")
    : classification.intent || null;
  message.risk_level = classification.risk_level || null;
  message.reply_mode = Array.isArray(classification.reply_mode)
    ? classification.reply_mode.join(",")
    : classification.reply_mode || null;
  message.dirty_joke_allowed = classification.dirty_joke_allowed || null;
  message.hot_guy_hook_allowed = Boolean(classification.hot_guy_hook_allowed);
  message.joke_level = classification.joke_level || null;
  message.memory_action = classification.memory_action || null;
}

function fallbackClassification(content) {
  if (isHighRiskCrisis(content)) {
    return {
      emotion: "难过",
      intent: ["危机信号"],
      intensity: "高",
      risk_level: "high",
      risk_types: ["self_harm"],
      reply_mode: ["安全回应"],
      sexual_boundary: "none",
      dirty_joke_allowed: "none",
      hot_guy_hook_allowed: false,
      analysis_directive: "avoid",
      joke_level: "none",
      memory_action: "none",
      style_feedback: false,
      should_collect_memory_candidate: false,
      short_reason: "关键词触发安全兜底",
    };
  }

  return {
    emotion: "不确定",
    intent: ["闲聊"],
    intensity: "低",
    risk_level: "none",
    risk_types: ["none"],
    reply_mode: ["陪伴", "玩笑接话"],
    sexual_boundary: "none",
    dirty_joke_allowed: "normal",
    hot_guy_hook_allowed: false,
    analysis_directive: "not_needed",
    joke_level: "medium",
    memory_action: content.includes("记住")
      ? "remember"
      : content.includes("忘")
        ? "forget"
        : "none",
    style_feedback: false,
    should_collect_memory_candidate: content.includes("记住") || content.includes("忘"),
    short_reason: "使用后端默认分类",
  };
}

async function callAiStudio(messages, options = {}) {
  const body = {
    model: config.model,
    messages,
    temperature: options.temperature ?? 0.85,
    top_p: options.topP ?? 0.8,
    max_completion_tokens: options.maxTokens ?? 800,
  };

  if (options.responseFormat) {
    body.response_format = { type: options.responseFormat };
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = extractAiStudioError(payload);
    console.error("AI Studio request failed", {
      status: response.status,
      error: message,
      code: payload.error?.code || payload.code,
      request_id: payload.id || payload.request_id,
    });
    throw new Error(message || "AI Studio request failed");
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI Studio returned empty content");
  }

  return content.trim();
}

function parseJsonObject(content) {
  const trimmed = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Model did not return valid JSON");
  }
}

function formatMessageForPrompt(message) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    created_at: message.created_at,
  };
}

function getVisibleMessages(messages = []) {
  return messages.filter((message) =>
    (message.role === "user" || message.role === "assistant") &&
    message.status !== "deleted" &&
    !message.deleted_at,
  );
}

function getRecentVisibleMessages(messages = [], limit = RECENT_MESSAGE_LIMIT) {
  return getVisibleMessages(messages).slice(-limit);
}

function truncateText(value, maxChars) {
  const text = String(value || "").trim();
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars - 3)}...`;
}

function formatMemoryForPrompt(memory) {
  return {
    id: memory.id,
    type: memory.type,
    content: memory.content,
    display_title: memory.display_title,
    status: memory.status,
    sensitivity: memory.sensitivity,
    user_confirmed: memory.user_confirmed,
    evidence_count: Number(memory.evidence_count || 0),
    source_message_count: Array.isArray(memory.source_message_ids)
      ? memory.source_message_ids.length
      : 0,
  };
}

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function formatPublicSettings() {
  return {
    model: config.model,
    available_models: getAvailableModels(),
    api_key_configured: Boolean(hasUsableApiKey(config.apiKey)),
    base_url_configured: Boolean(config.baseUrl),
    updated_at: settings.updated_at || null,
  };
}

function getAvailableModels() {
  const configuredModels = String(process.env.AI_STUDIO_MODELS || "")
    .split(",")
    .map(normalizeModelName)
    .filter(Boolean);

  return uniqueStrings([
    ...configuredModels,
    process.env.AI_STUDIO_MODEL,
    settings.model,
    DEFAULT_MODEL,
  ].map(normalizeModelName).filter(Boolean));
}

function normalizeModelName(value) {
  return String(value || "").trim();
}

function getPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function uniqueStrings(items) {
  return [...new Set(items)];
}

export {
  applyAutomaticMemoryCandidate,
  buildModelMessages,
  deleteConversationMessages,
  findRequestReplay,
  formatMemoryForClient,
  createAutomaticBackup,
  createBackupPayload,
  getRecentVisibleMessages,
  getSummaryBatch,
  getVisibleMessages,
  hasDurableMemorySignal,
  pruneExpiredMemoryCandidates,
  selectAutomaticMemoryCandidates,
  server,
  selectRelevantMemories,
  shouldRunMemoryExtractor,
};

function normalizeForSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？、,.!?;；:："'“”‘’（）()【】\[\]《》<>]/g, "");
}

async function serveStatic(pathname, res, headOnly = false, acceptEncoding = "") {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(webDir, safePath));

  if (!filePath.startsWith(webDir) || !existsSync(filePath)) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }

  const content = filePath === path.join(webDir, "index.html")
    ? await buildInlineIndex()
    : await readFile(filePath);
  const shouldGzip = /\bgzip\b/i.test(acceptEncoding) &&
    content.length >= 1024 &&
    isCompressibleContentType(contentTypeFor(filePath));
  const responseBody = shouldGzip ? gzipSync(content) : content;
  const headers = {
    "Content-Type": contentTypeFor(filePath),
    "Cache-Control": "no-store",
    "Content-Length": String(responseBody.length),
    "Vary": "Accept-Encoding",
  };

  if (shouldGzip) {
    headers["Content-Encoding"] = "gzip";
  }

  res.writeHead(200, headers);
  res.end(headOnly ? undefined : responseBody);
}

async function buildInlineIndex() {
  const [html, styles, app] = await Promise.all([
    readFile(path.join(webDir, "index.html"), "utf8"),
    readFile(path.join(webDir, "styles.css"), "utf8"),
    readFile(path.join(webDir, "app.js"), "utf8"),
  ]);

  const safeStyles = styles.replace(/<\/style/gi, "<\\/style");
  const safeApp = app.replace(/<\/script/gi, "<\\/script");
  const document = html
    .replace(
      "<!-- STONE_INLINE_STYLES -->",
      `<style data-stone-styles-version="24">\n${safeStyles}\n</style>`,
    )
    .replace(
      "<!-- STONE_INLINE_APP -->",
      `<script type="module" data-stone-app-version="24">\n${safeApp}\n//# sourceURL=/app.inline.v24.js\n</script>`,
    );

  return Buffer.from(document, "utf8");
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(JSON.stringify(payload));
}

function sendEmpty(res, status) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end();
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSyncSafe(filePath);
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function readFileSyncSafe(filePath) {
  return readFileSync(filePath, "utf8");
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function hasUsableApiKey(value) {
  return value && !value.includes("请把你的") && !value.includes("YOUR_ACCESS_TOKEN");
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".webmanifest")) return "application/manifest+json; charset=utf-8";
  return "application/octet-stream";
}

function isCompressibleContentType(contentType) {
  return contentType.startsWith("text/") ||
    contentType.includes("javascript") ||
    contentType.includes("json") ||
    contentType.includes("manifest");
}

function extractAiStudioError(payload) {
  if (!payload || typeof payload !== "object") {
    return "unknown_error";
  }

  if (typeof payload.message === "string") {
    return payload.message;
  }

  if (typeof payload.error === "string") {
    return payload.error;
  }

  if (typeof payload.error?.message === "string") {
    return payload.error.message;
  }

  return JSON.stringify(payload).slice(0, 500);
}
