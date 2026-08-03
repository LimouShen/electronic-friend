const sideNavEl = document.querySelector("#sideNav");
const navToggleInlineEl = document.querySelector("#navToggleInline");
const navOpenEls = document.querySelectorAll("[data-nav-open]");
const navLinkEls = document.querySelectorAll(".nav-link");
const pageEls = document.querySelectorAll(".page");
const messagesEl = document.querySelector("#messages");
const composerEl = document.querySelector("#composer");
const inputEl = document.querySelector("#messageInput");
const sendButtonEl = document.querySelector("#sendButton");
const chatTitleEl = document.querySelector("#chatTitle");
const chatPageEl = document.querySelector("#chatPage");
const messageContextMenuEl = document.querySelector("#messageContextMenu");
const messageSelectionBarEl = document.querySelector("#messageSelectionBar");
const messageSelectionCountEl = document.querySelector("#messageSelectionCount");
const deleteSelectedMessagesButtonEl = document.querySelector("#deleteSelectedMessagesButton");
const cancelMessageSelectionButtonEl = document.querySelector("#cancelMessageSelectionButton");
const newConversationButtonEl = document.querySelector("#newConversationButton");
const historyListEl = document.querySelector("#historyList");
const personaPageEl = document.querySelector("#personaPage");
const memoryListEl = document.querySelector("#memoryList");
const memoryDetailPanelEl = document.querySelector("#memoryDetailPanel");
const memoryDetailBackdropEl = document.querySelector("#memoryDetailBackdrop");
const memoryTypeFilterEl = document.querySelector("#memoryTypeFilter");
const memoryStatusFilterEl = document.querySelector("#memoryStatusFilter");
const memoryCountEl = document.querySelector("#memoryCount");
const clearMemoriesButtonEl = document.querySelector("#clearMemoriesButton");
const clearMemoriesSettingsButtonEl = document.querySelector("#clearMemoriesSettingsButton");
const exportConversationsButtonEl = document.querySelector("#exportConversationsButton");
const exportMemoriesButtonEl = document.querySelector("#exportMemoriesButton");
const modelSelectEl = document.querySelector("#modelSelect");
const saveModelButtonEl = document.querySelector("#saveModelButton");
const modelStatusDotEl = document.querySelector("#modelStatusDot");
const installPwaButtonEl = document.querySelector("#installPwaButton");
const settingsInstallPwaButtonEl = document.querySelector("#settingsInstallPwaButton");
const pwaStatusEl = document.querySelector("#pwaStatus");
const appToastEl = document.querySelector("#appToast");
const personaPortraitEls = document.querySelectorAll(".mobile-persona-portrait, .persona-portrait");
const confirmationOverlayEl = document.querySelector("#confirmationOverlay");
const confirmationTitleEl = document.querySelector("#confirmationTitle");
const confirmationMessageEl = document.querySelector("#confirmationMessage");
const confirmationPhraseFieldEl = document.querySelector("#confirmationPhraseField");
const confirmationPhraseHintEl = document.querySelector("#confirmationPhraseHint");
const confirmationPhraseInputEl = document.querySelector("#confirmationPhraseInput");
const confirmationCancelButtonEl = document.querySelector("#confirmationCancelButton");
const confirmationConfirmButtonEl = document.querySelector("#confirmationConfirmButton");

let conversationId = localStorage.getItem("electronic-friend:conversation-id") || "";
let isSending = false;
let allMemories = [];
let localConversationDraft = null;
let deferredInstallPrompt = null;
const conversationStatuses = new Map();
let selectedMemoryId = "";
let messageSelectionMode = false;
const selectedMessageIds = new Set();
let contextMessage = null;
let longPressTimer = null;
let toastTimer = null;
let ignoreNextDocumentClick = false;
let pendingConfirmation = null;
let networkStatusCheckId = 0;

const MEMORY_TITLE_MAX_LENGTH = 20;
const MEMORY_CONTENT_MAX_LENGTH = 200;
const PERSONA_PORTRAIT_FALLBACKS = [
  "/assets/shitou-head.png?v=3",
  "/assets/shitou-front.png?v=3",
];

const memoryTypes = [
  "shared_joke",
  "important_event",
  "relationship_context",
  "expression_preference",
  "emotional_pattern",
  "boundary",
  "sexual_boundary_preference",
  "current_state",
  "persona_feedback",
];
const memoryTypeLabels = {
  shared_joke: "共同梗",
  important_event: "重要事件",
  relationship_context: "关系语境",
  expression_preference: "说话偏好",
  emotional_pattern: "情绪模式",
  boundary: "边界",
  sexual_boundary_preference: "黄腔边界",
  current_state: "近期状态",
  persona_feedback: "石头反馈",
};
const memoryStatusLabels = {
  candidate: "待观察",
  active: "正使用",
  archived: "已停用",
};

populateMemoryFilters();
bindPersonaPortraitFallbacks();
bindEvents();
initPwa();
if (window.__stoneBootReady) window.__stoneBootReady();
init()
  .catch((error) => {
    console.error("App initialization failed", error);
    showToast("石头的数据暂时没加载完整，请稍后再试。");
  });

function bindEvents() {
  navToggleInlineEl.addEventListener("click", toggleNav);
  for (const button of navOpenEls) {
    button.addEventListener("click", toggleNav);
  }

  for (const link of navLinkEls) {
    link.addEventListener("click", async () => {
      if (isMobileNavLayout()) closeNav();
      await showPage(link.dataset.page);
    });
  }

  composerEl.addEventListener("submit", sendMessage);
  inputEl.addEventListener("input", resizeInput);
  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      composerEl.requestSubmit();
    }
  });

  newConversationButtonEl.addEventListener("click", startNewConversation);
  deleteSelectedMessagesButtonEl.addEventListener("click", deleteSelectedMessages);
  cancelMessageSelectionButtonEl.addEventListener("click", () => setMessageSelectionMode(false));
  messageContextMenuEl.addEventListener("click", handleMessageContextAction);
  document.addEventListener("click", (event) => {
    if (ignoreNextDocumentClick) {
      ignoreNextDocumentClick = false;
      return;
    }
    closeConversationMenus();
    if (!messageContextMenuEl.contains(event.target)) {
      closeMessageContextMenu();
    }
  });
  document.addEventListener("scroll", closeMessageContextMenu, true);

  memoryTypeFilterEl.addEventListener("change", () => {
    closeMemoryDetailPanel();
    renderMemories(getFilteredMemories());
  });
  memoryStatusFilterEl.addEventListener("change", () => {
    closeMemoryDetailPanel();
    renderMemories(getFilteredMemories());
  });
  memoryDetailBackdropEl.addEventListener("click", closeMemoryDetailPanel);
  window.addEventListener("resize", () => {
    if (!isMobilePersonaLayout()) closeMemoryDetailPanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMemoryDetailPanel();
      settleConfirmation(false);
    }
  });
  clearMemoriesButtonEl.addEventListener("click", () => clearAllMemories(clearMemoriesButtonEl));
  clearMemoriesSettingsButtonEl.addEventListener("click", () => clearAllMemories(clearMemoriesSettingsButtonEl));
  saveModelButtonEl.addEventListener("click", saveModelSetting);
  modelSelectEl.addEventListener("change", () => {
    setModelConnectionStatus(false);
  });
  installPwaButtonEl.addEventListener("click", () => installPwa(installPwaButtonEl));
  settingsInstallPwaButtonEl.addEventListener("click", () => installPwa(settingsInstallPwaButtonEl));

  exportConversationsButtonEl.addEventListener("click", () =>
    exportData("/api/export/conversations", `electronic-friend-conversations-${today()}.json`, exportConversationsButtonEl),
  );
  exportMemoriesButtonEl.addEventListener("click", () =>
    exportData("/api/export/memories", `electronic-friend-memories-${today()}.json`, exportMemoriesButtonEl),
  );
  confirmationCancelButtonEl.addEventListener("click", () => settleConfirmation(false));
  confirmationConfirmButtonEl.addEventListener("click", () => settleConfirmation(true));
  confirmationPhraseInputEl.addEventListener("input", updateConfirmationButtonState);
  confirmationOverlayEl.addEventListener("click", (event) => {
    if (event.target === confirmationOverlayEl) settleConfirmation(false);
  });
}

function bindPersonaPortraitFallbacks() {
  for (const portrait of personaPortraitEls) {
    let fallbackIndex = 0;
    const loadNextFallback = () => {
      const nextSource = PERSONA_PORTRAIT_FALLBACKS[fallbackIndex];
      fallbackIndex += 1;
      if (nextSource) {
        portrait.src = nextSource;
      }
    };

    portrait.addEventListener("error", loadNextFallback);
    if (portrait.complete && portrait.naturalWidth === 0) {
      loadNextFallback();
    }
  }
}

function initPwa() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    setInstallButtonsVisible(true);
    setPwaStatus("可以装到手机桌面。");
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    setInstallButtonsVisible(false);
    localStorage.setItem("electronic-friend:pwa-installed", "true");
    setPwaStatus("已经住进手机里了。");
  });

  window.addEventListener("online", updateNetworkStatus);
  window.addEventListener("offline", updateNetworkStatus);
  setInstallButtonsVisible(Boolean(deferredInstallPrompt));
  updateNetworkStatus();
}

async function installPwa(button) {
  if (!deferredInstallPrompt) {
    setPwaStatus(isStandalonePwa()
      ? "已经是手机桌面版。"
      : "如果浏览器没弹安装，可以用浏览器菜单添加到主屏幕。");
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "安装中";

  try {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    setInstallButtonsVisible(false);
    setPwaStatus(choice.outcome === "accepted" ? "装好了。" : "没装也行，浏览器里照样能聊。");
  } catch {
    setPwaStatus("安装没弹出来，换手机浏览器菜单试试。");
  } finally {
    button.textContent = originalText;
    button.disabled = false;
  }
}

function setInstallButtonsVisible(visible) {
  installPwaButtonEl.hidden = !visible;
  settingsInstallPwaButtonEl.hidden = !visible;
}

async function updateNetworkStatus() {
  const checkId = ++networkStatusCheckId;

  try {
    const response = await fetch(`/api/health?network-status=${Date.now()}`, {
      cache: "no-store",
    });
    const payload = await readJsonResponse(response);

    if (checkId !== networkStatusCheckId) return;
    if (response.ok && payload.ok === true) {
      if (isStandalonePwa() || !deferredInstallPrompt) {
        setPwaStatus("");
      }
      return;
    }
  } catch {
    // iOS may report navigator.onLine incorrectly around VPN and network changes.
  }

  if (checkId === networkStatusCheckId) {
    setPwaStatus("没连上电脑里的石头。确认石头开关和手机 Tailscale 都已连接。");
  }
}

function setPwaStatus(message) {
  if (pwaStatusEl) {
    pwaStatusEl.textContent = message;
  }
}

function isStandalonePwa() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
}

async function loadSettings() {
  setModelConnectionStatus(false);

  try {
    const response = await fetch("/api/settings");
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.message || "模型状态没读到");
    }

    renderModelOptions(payload.available_models || [], payload.model);
    setModelConnectionStatus(Boolean(payload.api_key_configured));
  } catch (error) {
    setModelConnectionStatus(false);
  }
}

function renderModelOptions(models, currentModel) {
  const uniqueModels = [...new Set([currentModel, ...models].filter(Boolean))];
  modelSelectEl.innerHTML = "";

  for (const model of uniqueModels) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelSelectEl.append(option);
  }

  if (currentModel) {
    modelSelectEl.value = currentModel;
  }
}

async function saveModelSetting() {
  const originalText = saveModelButtonEl.textContent;
  saveModelButtonEl.disabled = true;
  saveModelButtonEl.textContent = "保存中";
  setModelConnectionStatus(false);

  try {
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelSelectEl.value }),
    });
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.message || "没保存上");
    }

    renderModelOptions(payload.available_models || [], payload.model);
    setModelConnectionStatus(Boolean(payload.api_key_configured));
    showToast(payload.api_key_configured ? "已接上" : "密钥还没配好");
    saveModelButtonEl.textContent = "好了";
  } catch (error) {
    setModelConnectionStatus(false);
    showToast(error.message || "没保存上");
    saveModelButtonEl.textContent = "没保存";
  } finally {
    setTimeout(() => {
      saveModelButtonEl.textContent = originalText;
      saveModelButtonEl.disabled = false;
    }, 900);
  }
}

function setModelConnectionStatus(connected) {
  modelStatusDotEl.classList.toggle("connected", connected);
  modelStatusDotEl.classList.toggle("disconnected", !connected);
  modelStatusDotEl.setAttribute("aria-label", connected ? "模型已接上" : "模型未接上");
}

function showToast(message) {
  if (!message) return;
  clearTimeout(toastTimer);
  appToastEl.textContent = message;
  appToastEl.hidden = false;
  toastTimer = setTimeout(() => {
    appToastEl.hidden = true;
  }, 2000);
}

async function sendMessage(event) {
  event.preventDefault();
  const content = inputEl.value.trim();

  if (!content || isSending) {
    return;
  }

  setSending(true);
  ensureDraftConversation(content);
  const requestConversationId = conversationId;
  conversationStatuses.set(requestConversationId, "loading");
  renderConversations();
  const userEl = appendMessage("user", content);
  inputEl.value = "";
  resizeInput();

  const pendingEl = appendMessage("assistant pending", "石头正在憋坏水...");
  const requestId = createClientRequestId();

  await submitChatMessage({
    content,
    requestId,
    requestConversationId,
    userEl,
    pendingEl,
  });
}

async function submitChatMessage({ content, requestId, requestConversationId, userEl, pendingEl }) {
  setSending(true);

  try {
    const response = await fetch("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: requestConversationId || undefined,
        content,
        input_type: "text",
        request_id: requestId,
      }),
    });
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.message || "发送失败了");
    }

    const responseConversationId = payload.conversation_state.conversation_id;
    if (conversationId === requestConversationId) {
      conversationId = responseConversationId;
      localStorage.setItem("electronic-friend:conversation-id", conversationId);
      setChatTitle(payload.conversation_state.title);
      applyMessageMetadata(userEl, payload.user_message);
      pendingEl.className = "message assistant";
      pendingEl.querySelector("p").textContent = payload.assistant_message.content;
      applyMessageMetadata(pendingEl, payload.assistant_message);
    }
    if (localConversationDraft?.id === requestConversationId) {
      localConversationDraft = null;
    }
    conversationStatuses.delete(requestConversationId);
    conversationStatuses.set(responseConversationId, "done");
    await loadConversations({ silent: true });
    scrollMessagesToBottom();
  } catch (error) {
    conversationStatuses.delete(requestConversationId);
    renderConversations();
    renderSendFailure(pendingEl, error, () => retryChatMessage({
      content,
      requestId,
      requestConversationId,
      userEl,
      pendingEl,
    }));
    scrollMessagesToBottom();
  } finally {
    setSending(false);
    inputEl.focus();
  }
}

async function retryChatMessage(context) {
  if (isSending) return;
  context.pendingEl.className = "message assistant pending";
  context.pendingEl.innerHTML = "";
  const paragraph = document.createElement("p");
  paragraph.textContent = "石头重新接一下，刚才那句不重复记。";
  context.pendingEl.append(paragraph);
  conversationStatuses.set(context.requestConversationId, "loading");
  renderConversations();
  await submitChatMessage(context);
}

function renderSendFailure(pendingEl, error, onRetry) {
  pendingEl.className = "message assistant failed";
  pendingEl.innerHTML = "";
  const paragraph = document.createElement("p");
  paragraph.textContent = error.message || "刚刚没接上。你的话还在，点一下再试。";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "message-retry-button";
  retry.textContent = "再试一次";
  retry.addEventListener("click", onRetry, { once: true });
  pendingEl.append(paragraph, retry);
}

function createClientRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function appendMessage(role, content, options = {}) {
  const row = document.createElement("div");
  row.className = [
    "message-row",
    role.includes("user") ? "user-row" : "assistant-row",
  ].join(" ");

  const article = document.createElement("article");
  article.className = `message ${role}`;

  const paragraph = document.createElement("p");
  paragraph.textContent = content;
  article.append(paragraph);
  row.append(article);
  if (options.message) {
    applyMessageMetadata(article, options.message);
  }

  messagesEl.append(row);
  scrollMessagesToBottom();

  return article;
}

function applyMessageMetadata(article, message) {
  if (!message?.id || message.status === "deleted" || message.deleted_at) return;
  if (message.role !== "user" && message.role !== "assistant") return;

  article.dataset.messageId = message.id;
  article.dataset.messageRole = message.role;
  article.dataset.messageContent = message.content || "";
  const row = article.closest(".message-row");
  if (row && !row.querySelector(".message-select-indicator")) {
    const indicator = document.createElement("button");
    indicator.className = "message-select-indicator";
    indicator.type = "button";
    indicator.setAttribute("aria-label", "选择这条消息");
    indicator.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleSelectedMessage(message.id, article);
    });
    row.prepend(indicator);
  }
  article.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openMessageContextMenu(article, event.clientX, event.clientY);
  });
  article.addEventListener("pointerdown", (event) => startLongPress(event, article));
  article.addEventListener("pointermove", cancelLongPress);
  article.addEventListener("pointerup", cancelLongPress);
  article.addEventListener("pointercancel", cancelLongPress);
  article.addEventListener("click", () => {
    if (messageSelectionMode) {
      toggleSelectedMessage(message.id, article);
    }
  });
  updateMessageSelectionState(article);
}

async function init() {
  setBootProgress("正在读取石头的设置。");
  await loadSettings();

  if (!conversationId) {
    showWelcomeMessage();
    setBootProgress("正在读取最近的对话。");
    await loadConversations();
    return;
  }

  try {
    setBootProgress("正在打开上次的对话。");
    const response = await fetch(
      `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
    );

    if (!response.ok) {
      localStorage.removeItem("electronic-friend:conversation-id");
      conversationId = "";
      showWelcomeMessage();
      await loadConversations();
      return;
    }

    const payload = await readJsonResponse(response);
    setChatTitle(payload.conversation_state?.title);
    if (!payload.messages?.length) {
      showWelcomeMessage();
      await loadConversations();
      return;
    }

    renderMessages(payload.messages);
    await loadConversations();
  } catch {
    showWelcomeMessage();
    await loadConversations();
  }
}

function renderMessages(messages) {
  messagesEl.innerHTML = "";
  for (const message of messages) {
    if (
      (message.role === "user" || message.role === "assistant") &&
      message.status !== "deleted" &&
      !message.deleted_at
    ) {
      appendMessage(message.role, message.content, { message });
    }
  }
  syncMessageSelectionUi();
}

function showWelcomeMessage() {
  messagesEl.innerHTML = "";
  selectedMessageIds.clear();
  setMessageSelectionMode(false);
  setChatTitle("石头");
  appendMessage(
    "assistant",
    "来了，今天先从哪儿开始说？上班破事、帅哥八卦，还是单纯想骂两句。",
  );
}

function setMessageSelectionMode(nextValue) {
  messageSelectionMode = Boolean(nextValue);
  chatPageEl.classList.toggle("message-selection-mode", messageSelectionMode);
  messageSelectionBarEl.hidden = !messageSelectionMode;
  closeMessageContextMenu();
  if (!messageSelectionMode) {
    selectedMessageIds.clear();
  }
  syncMessageSelectionUi();
}

function startLongPress(event, article) {
  if (messageSelectionMode || event.pointerType === "mouse") return;
  cancelLongPress();
  longPressTimer = setTimeout(() => {
    openMessageContextMenu(article, event.clientX, event.clientY);
  }, 520);
}

function cancelLongPress() {
  clearTimeout(longPressTimer);
  longPressTimer = null;
}

function openMessageContextMenu(article, clientX, clientY) {
  if (!article?.dataset.messageId || isSending) return;
  contextMessage = {
    id: article.dataset.messageId,
    content: article.dataset.messageContent || article.querySelector("p")?.textContent || "",
    article,
  };

  const menuWidth = 174;
  const menuHeight = 142;
  const left = Math.min(Math.max(clientX - menuWidth / 2, 12), window.innerWidth - menuWidth - 12);
  const top = Math.min(Math.max(clientY + 10, 12), window.innerHeight - menuHeight - 12);
  messageContextMenuEl.style.left = `${left}px`;
  messageContextMenuEl.style.top = `${top}px`;
  messageContextMenuEl.hidden = false;
  ignoreNextDocumentClick = true;
}

function closeMessageContextMenu() {
  messageContextMenuEl.hidden = true;
  contextMessage = null;
}

async function handleMessageContextAction(event) {
  const action = event.target.closest("button")?.dataset.messageAction;
  if (!action || !contextMessage) return;

  const current = contextMessage;
  closeMessageContextMenu();

  if (action === "copy") {
    await copyMessageText(current.content);
    return;
  }

  if (action === "delete") {
    await deleteMessages([current.id], event.target);
    return;
  }

  if (action === "select") {
    setMessageSelectionMode(true);
    selectedMessageIds.add(current.id);
    updateMessageSelectionState(current.article);
    syncMessageSelectionUi();
  }
}

async function copyMessageText(content) {
  try {
    await navigator.clipboard.writeText(content);
    showToast("已复制");
  } catch {
    showToast("没复制上");
  }
}

function toggleSelectedMessage(messageId, article) {
  if (!messageSelectionMode) {
    setMessageSelectionMode(true);
  }

  if (selectedMessageIds.has(messageId)) {
    selectedMessageIds.delete(messageId);
  } else {
    selectedMessageIds.add(messageId);
  }

  updateMessageSelectionState(article);
  syncMessageSelectionUi();
}

function syncMessageSelectionUi() {
  for (const article of messagesEl.querySelectorAll(".message[data-message-id]")) {
    updateMessageSelectionState(article);
  }

  const count = selectedMessageIds.size;
  messageSelectionCountEl.textContent = `已选择 ${count} 条`;
  deleteSelectedMessagesButtonEl.disabled = !count;
}

function updateMessageSelectionState(article) {
  const messageId = article.dataset.messageId;
  const selected = Boolean(messageId && selectedMessageIds.has(messageId));
  article.classList.toggle("selected", selected);
  article.closest(".message-row")?.classList.toggle("selected", selected);
}

async function deleteSelectedMessages() {
  await deleteMessages([...selectedMessageIds], deleteSelectedMessagesButtonEl);
}

async function deleteMessages(messageIds, button) {
  const ids = [...new Set(messageIds.filter(Boolean))];
  if (!ids.length || !conversationId || isSending) return;

  const confirmed = window.confirm(
    ids.length === 1
      ? "确定删掉这条吗？删掉后石头后面就不会拿它接话。"
      : `确定删掉选中的 ${ids.length} 条吗？删掉后石头后面就不会拿它们接话。`,
  );
  if (!confirmed) return;

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "删除中";

  try {
    const response = ids.length === 1
      ? await fetch(
        `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(ids[0])}`,
        { method: "DELETE" },
      )
      : await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_ids: ids }),
      });
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.message || "没删掉");
    }

    selectedMessageIds.clear();
    if (payload.conversation_state?.title) {
      setChatTitle(payload.conversation_state.title);
    }

    if (payload.messages?.length) {
      renderMessages(payload.messages);
    } else {
      showWelcomeMessage();
    }

    await loadConversations({ silent: true });
    setMessageSelectionMode(false);
  } catch (error) {
    button.textContent = error.message || "没删掉";
  } finally {
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
      syncMessageSelectionUi();
    }, 900);
  }
}

function startNewConversation() {
  if (isMobileNavLayout()) closeNav();

  const now = new Date().toISOString();
  conversationId = createLocalConversationId();
  localStorage.setItem("electronic-friend:conversation-id", conversationId);
  localConversationDraft = {
    id: conversationId,
    title: "新聊天",
    pinned: false,
    preview: "还没聊几句。",
    message_count: 0,
    created_at: now,
    last_active_at: now,
    local: true,
  };
  conversationStatuses.delete(conversationId);
  showWelcomeMessage();
  showPage("chatPage");
  renderConversations();
  inputEl.focus();
}

async function loadConversations(options = {}) {
  if (!options.silent && !historyListEl.children.length) {
    historyListEl.innerHTML = '<p class="empty-history">石头翻聊天记录中...</p>';
  }

  try {
    const response = await fetch("/api/chat/conversations");
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.message || "历史对话加载失败");
    }

    renderConversations(payload.conversations || []);
  } catch (error) {
    historyListEl.innerHTML = `<p class="empty-history">${error.message || "历史对话加载失败"}</p>`;
  }
}

function renderConversations(conversations = null) {
  if (Array.isArray(conversations)) {
    renderConversations.lastItems = conversations;
  }

  const items = mergeLocalConversationDraft(renderConversations.lastItems || []);
  historyListEl.innerHTML = "";

  if (!items.length) {
    historyListEl.innerHTML = '<p class="empty-history">还没有旧对话。先跟石头聊几句，这里就会有记录。</p>';
    return;
  }

  for (const conversation of items) {
    historyListEl.append(createConversationItem(conversation));
  }
}

function createConversationItem(conversation) {
  const status = conversationStatuses.get(conversation.id);
  const item = document.createElement("article");
  item.className = [
    "conversation-item",
    conversation.id === conversationId ? "active" : "",
    status ? `status-${status}` : "",
  ].filter(Boolean).join(" ");
  item.dataset.conversationId = conversation.id;

  const titleButton = document.createElement("button");
  titleButton.className = "conversation-title-button";
  titleButton.type = "button";
  titleButton.textContent = conversation.title || "这段聊天";
  titleButton.addEventListener("click", () => continueConversation(conversation.id));

  const meta = document.createElement("p");
  meta.className = "conversation-meta";
  meta.textContent = `最后对话：${formatDate(conversation.last_active_at)} · ${conversation.message_count || 0} 条`;

  const moreButton = document.createElement("button");
  moreButton.className = "conversation-more";
  moreButton.type = "button";
  moreButton.setAttribute("aria-label", "对话操作");
  moreButton.textContent = "...";

  const statusIndicator = document.createElement("span");
  statusIndicator.className = "conversation-status";
  statusIndicator.setAttribute("aria-hidden", "true");

  const menu = document.createElement("div");
  menu.className = "conversation-menu";
  menu.hidden = true;

  const pinButton = createButton(conversation.pinned ? "取消置顶" : "置顶", async (event) => {
    event.stopPropagation();
    await updateConversation(conversation.id, { pinned: !conversation.pinned }, pinButton);
    await loadConversations();
  });
  const renameButton = createButton("重命名", async (event) => {
    event.stopPropagation();
    const nextTitle = window.prompt("给这段聊天换个名字", conversation.title || "这段聊天");
    if (!nextTitle?.trim()) return;
    await updateConversation(conversation.id, { title: nextTitle.trim() }, renameButton);
    await loadConversations();
  });
  const removeButton = createButton("删除", (event) => {
    event.stopPropagation();
    deleteConversation(conversation.id, conversation.title || "这段聊天", removeButton);
  },
    "danger-button",
  );
  const info = document.createElement("p");
  info.className = "conversation-menu-info";
  info.textContent = `最后对话时间：${formatDate(conversation.last_active_at)}`;

  menu.append(pinButton, renameButton, removeButton, info);

  moreButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = menu.hidden;
    closeConversationMenus();
    menu.hidden = !willOpen;
  });
  menu.addEventListener("click", (event) => event.stopPropagation());

  item.append(titleButton, meta, statusIndicator, moreButton, menu);
  return item;
}

function mergeLocalConversationDraft(conversations) {
  if (!localConversationDraft) return conversations;

  const hasDraft = conversations.some((conversation) => conversation.id === localConversationDraft.id);
  if (hasDraft) {
    localConversationDraft = null;
    return conversations;
  }

  return [localConversationDraft, ...conversations];
}

function ensureDraftConversation(firstMessageContent) {
  if (!conversationId) {
    const now = new Date().toISOString();
    conversationId = createLocalConversationId();
    localStorage.setItem("electronic-friend:conversation-id", conversationId);
    localConversationDraft = {
      id: conversationId,
      title: createLocalTitle(firstMessageContent),
      pinned: false,
      preview: firstMessageContent,
      message_count: 1,
      created_at: now,
      last_active_at: now,
      local: true,
    };
    return;
  }

  if (localConversationDraft?.id === conversationId) {
    localConversationDraft = {
      ...localConversationDraft,
      title: localConversationDraft.title === "新聊天"
        ? createLocalTitle(firstMessageContent)
        : localConversationDraft.title,
      preview: firstMessageContent,
      message_count: Math.max(localConversationDraft.message_count || 0, 1),
      last_active_at: new Date().toISOString(),
    };
  }
}

function closeConversationMenus() {
  for (const menu of document.querySelectorAll(".conversation-menu")) {
    menu.hidden = true;
  }
}

async function updateConversation(nextConversationId, changes, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "处理中";

  try {
    const response = await fetch(`/api/chat/conversations/${encodeURIComponent(nextConversationId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    });
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.message || "没改上");
    }

    if (nextConversationId === conversationId && payload.conversation?.title) {
      setChatTitle(payload.conversation.title);
    }

    button.textContent = "好了";
  } catch (error) {
    button.textContent = error.message || "没改上";
  } finally {
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 900);
  }
}

async function deleteConversation(nextConversationId, title, button) {
  const confirmed = window.confirm(`确定删掉“${title}”这段聊天吗？这一步不能撤回。`);
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = "删除中";

  try {
    const response = await fetch(`/api/chat/conversations/${encodeURIComponent(nextConversationId)}`, {
      method: "DELETE",
    });
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.message || "没删掉");
    }

    if (nextConversationId === conversationId) {
      startNewConversation();
    }

    await loadConversations();
  } catch (error) {
    button.textContent = error.message || "没删掉";
    button.disabled = false;
  }
}

async function continueConversation(nextConversationId) {
  if (isMobileNavLayout()) closeNav();

  if (localConversationDraft?.id === nextConversationId) {
    conversationId = nextConversationId;
    localStorage.setItem("electronic-friend:conversation-id", conversationId);
    showWelcomeMessage();
    await showPage("chatPage");
    renderConversations();
    inputEl.focus();
    return;
  }

  try {
    const response = await fetch(
      `/api/chat/conversations/${encodeURIComponent(nextConversationId)}/messages`,
    );
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.message || "这段聊天没找到");
    }

    conversationId = nextConversationId;
    localStorage.setItem("electronic-friend:conversation-id", conversationId);
    setChatTitle(payload.conversation_state?.title);
    renderMessages(payload.messages || []);
    await showPage("chatPage");
    await loadConversations();
    conversationStatuses.delete(nextConversationId);
    renderConversations();
    inputEl.focus();
  } catch (error) {
    renderConversations();
    window.alert(error.message || "没接上这段聊天");
  }
}

async function loadMemories() {
  memoryListEl.innerHTML = '<p class="empty-memory">石头翻小本本中...</p>';
  memoryCountEl.textContent = "";

  try {
    const response = await fetch("/api/memories");
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.message || "记忆加载失败");
    }

    allMemories = payload.memories || [];
    renderMemories(getFilteredMemories());
  } catch (error) {
    memoryListEl.innerHTML = `<p class="empty-memory">${error.message || "记忆加载失败"}</p>`;
  }
}

function renderMemories(memories) {
  memoryListEl.innerHTML = "";
  const total = allMemories.length;
  memoryCountEl.textContent = total ? `${memories.length} / ${total} 张小纸条` : "";

  if (!memories.length) {
    memoryListEl.innerHTML = allMemories.length
      ? '<p class="empty-memory">这组筛选下没有小纸条。</p>'
      : '<p class="empty-memory">还没有长期记忆。你可以在聊天里直接说“记住……”。</p>';
    renderMemoryDetail(null);
    closeMemoryDetailPanel();
    return;
  }

  if (!memories.some((memory) => memory.id === selectedMemoryId)) {
    selectedMemoryId = memories[0].id;
  }

  const titleCounts = new Map();
  for (const memory of memories) {
    const baseTitle = memory.display_title || "未命名记忆";
    const nextCount = (titleCounts.get(baseTitle) || 0) + 1;
    titleCounts.set(baseTitle, nextCount);
    const displayTitle = nextCount === 1 ? baseTitle : `${baseTitle} ${nextCount}`;
    memoryListEl.append(createMemoryItem(memory, displayTitle));
  }

  renderMemoryDetail(memories.find((memory) => memory.id === selectedMemoryId) || memories[0]);
}

function getFilteredMemories() {
  const type = memoryTypeFilterEl.value;
  const status = memoryStatusFilterEl.value;

  return allMemories
    .filter((memory) => !type || memory.type === type)
    .filter((memory) => !status || memory.status === status);
}

function createMemoryItem(memory, displayTitle) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = [
    "memory-item",
    memory.status === "archived" ? "archived" : "",
    memory.status === "candidate" ? "candidate" : "",
    memory.status === "active" ? "active" : "",
    memory.id === selectedMemoryId ? "selected" : "",
  ].filter(Boolean).join(" ");
  item.dataset.memoryId = memory.id;
  item.addEventListener("click", () => {
    selectedMemoryId = memory.id;
    renderMemories(getFilteredMemories());
    if (isMobilePersonaLayout()) openMemoryDetailPanel();
  });

  const title = document.createElement("strong");
  title.className = "memory-title";
  title.textContent = displayTitle || "未命名记忆";

  const content = document.createElement("p");
  content.className = "memory-summary";
  content.textContent = memory.content || "这张小纸条还没有内容。";

  const meta = document.createElement("div");
  meta.className = "memory-meta";
  meta.append(createBadge(memoryStatusLabels[memory.status] || memory.status, memory.status));

  const more = document.createElement("span");
  more.className = "memory-more";
  more.textContent = "›";
  more.setAttribute("aria-hidden", "true");

  item.append(title, content, meta, more);
  return item;
}

function renderMemoryDetail(memory) {
  memoryDetailPanelEl.innerHTML = "";

  if (!memory) {
    const empty = document.createElement("p");
    empty.className = "empty-memory-detail";
    empty.textContent = "选一张小纸条，石头就把完整内容摊开给你看。";
    memoryDetailPanelEl.append(empty);
    return;
  }

  const heading = document.createElement("div");
  heading.className = "memory-detail-heading";
  const headingText = document.createElement("div");
  const eyebrow = document.createElement("span");
  eyebrow.textContent = "正在查看";
  const title = document.createElement("h3");
  title.textContent = memory.display_title || "未命名记忆";
  headingText.append(eyebrow, title);
  const close = createButton("收起", closeMemoryDetailPanel, "memory-detail-close");
  close.setAttribute("aria-label", "收起记忆详情");
  heading.append(headingText, close);

  const meta = document.createElement("div");
  meta.className = "memory-detail-meta";
  meta.append(createBadge(memoryStatusLabels[memory.status] || memory.status, memory.status));

  const source = document.createElement("p");
  source.className = "memory-source";
  source.textContent = formatMemorySource(memory.source);

  const titleLabel = document.createElement("label");
  titleLabel.className = "memory-detail-field";
  const titleText = document.createElement("span");
  titleText.textContent = "名称";
  const titleInput = document.createElement("input");
  titleInput.value = (memory.display_title || "未命名记忆").slice(0, MEMORY_TITLE_MAX_LENGTH);
  titleInput.maxLength = MEMORY_TITLE_MAX_LENGTH;
  titleInput.setAttribute("aria-label", "记忆名称");
  const titleCounter = document.createElement("span");
  titleCounter.className = "field-counter";
  titleLabel.append(titleText, titleInput, titleCounter);

  const contentLabel = document.createElement("label");
  contentLabel.className = "memory-detail-field";
  const contentText = document.createElement("span");
  contentText.textContent = "内容";
  const contentInput = document.createElement("textarea");
  contentInput.value = (memory.content || "").slice(0, MEMORY_CONTENT_MAX_LENGTH);
  contentInput.maxLength = MEMORY_CONTENT_MAX_LENGTH;
  contentInput.setAttribute("aria-label", "记忆内容");
  const contentCounter = document.createElement("span");
  contentCounter.className = "field-counter";
  contentLabel.append(contentText, contentInput, contentCounter);

  bindCharacterCounter(titleInput, titleCounter, MEMORY_TITLE_MAX_LENGTH);
  bindCharacterCounter(contentInput, contentCounter, MEMORY_CONTENT_MAX_LENGTH);

  const controls = document.createElement("div");
  controls.className = "memory-detail-actions";
  const edit = createButton("确认", () =>
    updateMemory(memory.id, {
      display_title: titleInput.value.trim().slice(0, MEMORY_TITLE_MAX_LENGTH),
      content: contentInput.value.trim().slice(0, MEMORY_CONTENT_MAX_LENGTH),
      type: memory.type,
    }, edit),
    "confirm-button",
  );
  const enable = createButton("启用", () =>
    updateMemory(memory.id, { status: "active", user_confirmed: true }, enable),
    "enable-button",
  );
  const disable = createButton("停用", () =>
    updateMemory(memory.id, { status: "archived" }, disable),
    "disable-button",
  );
  const remove = createButton("删除", () =>
    deleteMemory(memory.id, memory.display_title || memory.content || "这张小纸条", remove),
    "delete-button",
  );

  enable.disabled = memory.status === "active";
  disable.disabled = memory.status === "archived";

  controls.append(edit, enable, disable, remove);
  memoryDetailPanelEl.append(heading, meta, source, titleLabel, contentLabel, controls);
}

function formatMemorySource(source) {
  if (!source?.conversation_title || !source?.message_created_at) {
    return "手动写进小本本";
  }

  const date = new Date(source.message_created_at);
  const dateText = Number.isNaN(date.getTime())
    ? "日期未知"
    : new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  return `来自「${source.conversation_title}」 · ${dateText}`;
}

async function updateMemory(memoryId, changes, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "处理中";

  try {
    const response = await fetch(`/api/memories/${encodeURIComponent(memoryId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    });
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.message || "没保存上");
    }

    button.textContent = "好了";
    await loadMemories();
    closeMemoryDetailPanel();
  } catch (error) {
    button.textContent = error.message || "没保存上";
  } finally {
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 700);
  }
}

async function deleteMemory(memoryId, title, button) {
  const confirmed = window.confirm(`确定删掉“${title}”吗？删掉后石头就不会再用这张小纸条。`);
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = "删除中";

  try {
    const response = await fetch(`/api/memories/${encodeURIComponent(memoryId)}`, {
      method: "DELETE",
    });
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.message || "没删掉");
    }

    await loadMemories();
  } catch (error) {
    button.textContent = error.message || "没删掉";
    button.disabled = false;
  }
}

async function clearAllMemories(button = clearMemoriesButtonEl) {
  const confirmed = await requestConfirmation({
    title: "清空全部记忆？",
    message: "这会删掉石头小本本里的所有内容，而且不能撤回。",
    confirmLabel: "确认清空",
    danger: true,
    requiredText: "清空记忆",
  });
  if (!confirmed) return;

  const originalText = getButtonLabel(button);
  button.disabled = true;
  setButtonLabel(button, "清空中");

  try {
    const response = await fetch("/api/clear/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "CLEAR_MEMORIES" }),
    });
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.message || "没清空");
    }

    allMemories = [];
    renderMemories([]);
    setButtonLabel(button, "已清空");
    showToast(`已清空 ${payload.deleted_count || 0} 条`);
  } catch (error) {
    setButtonLabel(button, error.message || "没清空");
    showToast(error.message || "没清空");
  } finally {
    setTimeout(() => {
      setButtonLabel(button, originalText);
      button.disabled = false;
    }, 900);
  }
}

async function exportData(endpoint, filename, button) {
  const dataLabel = endpoint.endsWith("/memories") ? "全部记忆" : "全部对话";
  const confirmed = await requestConfirmation({
    title: `导出${dataLabel}？`,
    message: "下载的 JSON 文件会包含你的私人内容，请只保存在自己信任的设备上。",
    confirmLabel: "确认导出",
  });
  if (!confirmed) return;

  const originalText = getButtonLabel(button);
  button.disabled = true;
  setButtonLabel(button, "导出中");

  try {
    const response = await fetch(endpoint);
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.message || "导出失败，先重启本地服务试试");
    }

    downloadJson(payload, filename);
    setButtonLabel(button, "已导出");
  } catch (error) {
    setButtonLabel(button, error.message || "导出失败");
  } finally {
    setTimeout(() => {
      setButtonLabel(button, originalText);
      button.disabled = false;
    }, 1000);
  }
}

function requestConfirmation({ title, message, confirmLabel = "确认", danger = false, requiredText = "" }) {
  if (pendingConfirmation) settleConfirmation(false);

  confirmationTitleEl.textContent = title;
  confirmationMessageEl.textContent = message;
  confirmationConfirmButtonEl.textContent = confirmLabel;
  confirmationConfirmButtonEl.classList.toggle("danger-confirm", danger);
  confirmationPhraseFieldEl.hidden = !requiredText;
  confirmationPhraseHintEl.textContent = requiredText ? `请输入“${requiredText}”继续` : "";
  confirmationPhraseInputEl.value = "";
  confirmationPhraseInputEl.dataset.requiredText = requiredText;
  confirmationOverlayEl.hidden = false;
  document.body.classList.add("confirmation-open");
  updateConfirmationButtonState();

  queueMicrotask(() => {
    if (requiredText) confirmationPhraseInputEl.focus();
    else confirmationConfirmButtonEl.focus();
  });

  return new Promise((resolve) => {
    pendingConfirmation = { resolve };
  });
}

function updateConfirmationButtonState() {
  const requiredText = confirmationPhraseInputEl.dataset.requiredText || "";
  confirmationConfirmButtonEl.disabled = Boolean(
    requiredText && confirmationPhraseInputEl.value.trim() !== requiredText,
  );
}

function settleConfirmation(confirmed) {
  if (!pendingConfirmation) return;
  const { resolve } = pendingConfirmation;
  pendingConfirmation = null;
  confirmationOverlayEl.hidden = true;
  confirmationPhraseInputEl.value = "";
  document.body.classList.remove("confirmation-open");
  resolve(Boolean(confirmed));
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 1000);
}

function toggleNav() {
  sideNavEl.classList.toggle("open");
}

function closeNav() {
  sideNavEl.classList.remove("open");
}

function isMobileNavLayout() {
  return window.matchMedia("(max-width: 860px)").matches;
}

async function showPage(pageId) {
  for (const page of pageEls) {
    page.classList.toggle("active", page.id === pageId);
  }

  for (const link of navLinkEls) {
    link.classList.toggle("active", link.dataset.page === pageId);
  }

  if (pageId === "personaPage") {
    await loadMemories();
  } else if (pageId === "settingsPage") {
    await loadSettings();
  } else {
    closeMemoryDetailPanel();
  }
}

function createButton(text, onClick, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  if (className) button.className = className;
  button.addEventListener("click", onClick);
  return button;
}

function createBadge(text, tone) {
  const badge = document.createElement("span");
  badge.className = `memory-badge ${tone}`;
  badge.textContent = text;
  return badge;
}

function bindCharacterCounter(input, counter, maxLength) {
  const update = () => {
    counter.textContent = `${input.value.length} / ${maxLength}`;
  };
  input.addEventListener("input", update);
  update();
}

function isMobilePersonaLayout() {
  return window.matchMedia("(max-width: 560px)").matches;
}

function openMemoryDetailPanel() {
  personaPageEl.classList.add("memory-detail-open");
  memoryDetailBackdropEl.hidden = false;
}

function closeMemoryDetailPanel() {
  personaPageEl.classList.remove("memory-detail-open");
  memoryDetailBackdropEl.hidden = true;
}

function populateMemoryFilters() {
  for (const type of memoryTypes) {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = memoryTypeLabels[type] || type;
    memoryTypeFilterEl.append(option);
  }
}

function setButtonLabel(button, text) {
  const strong = button.querySelector("strong");
  if (strong) {
    strong.textContent = text;
    return;
  }

  const label = button.querySelector("span");
  if (label) {
    label.textContent = text;
    return;
  }

  button.textContent = text;
}

function getButtonLabel(button) {
  return button.querySelector("strong")?.textContent ||
    button.querySelector("span")?.textContent ||
    button.textContent;
}

function setChatTitle(title) {
  const cleaned = String(title || "").trim();
  chatTitleEl.textContent = cleaned && cleaned !== "新聊天" ? cleaned : "石头";
}

function scrollMessagesToBottom() {
  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

function resizeInput() {
  inputEl.style.height = "auto";
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 150)}px`;
}

function setSending(nextValue) {
  isSending = nextValue;
  sendButtonEl.disabled = nextValue;
  inputEl.disabled = nextValue;
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function formatDate(value) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function createLocalConversationId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createLocalTitle(content) {
  const cleaned = String(content || "").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 24) : "新聊天";
}

function setBootProgress(message) {
  if (window.__stoneBootProgress) window.__stoneBootProgress(message);
}
