import assert from "node:assert/strict";
import { server } from "./server.mjs";

const port = 3123;
const baseUrl = `http://127.0.0.1:${port}`;

try {
  await listen();
  await waitForServer();
  await cleanupTestMemories();

  const settings = await requestJson("/api/settings");
  assert.equal(typeof settings.model, "string");
  assert.equal(Array.isArray(settings.available_models), true);
  assert.equal(typeof settings.api_key_configured, "boolean");
  assert.equal(settings.apiKey, undefined);
  assert.equal(settings.api_key, undefined);

  const savedSettings = await requestJson("/api/settings", {
    method: "PATCH",
    body: { model: settings.model },
  });
  assert.equal(savedSettings.model, settings.model);

  const rejectedModel = await requestJson("/api/settings", {
    method: "PATCH",
    body: { model: "TEST_UNAVAILABLE_MODEL" },
    expectedStatus: 400,
  });
  assert.equal(rejectedModel.error, "unsupported_model");

  const health = await requestJson("/api/health");
  assert.equal(health.model, settings.model);

  const before = await requestJson("/api/memories");
  assert.equal(Array.isArray(before.memories), true);

  const created = await requestJson("/api/memories", {
    method: "POST",
    expectedStatus: 201,
    body: {
      type: "expression_preference",
      content: "TEST_MEMORY_DELETE_ME 记忆管理自动测试。",
      display_title: "TEST_MEMORY_DELETE_ME",
      status: "candidate",
      sensitivity: "normal",
      user_confirmed: false,
    },
  });
  const memoryId = created.memory.id;

  try {
    assert.equal(created.memory.status, "candidate");
    assert.equal(created.memory.user_confirmed, false);

    const confirmed = await requestJson(`/api/memories/${memoryId}`, {
      method: "PATCH",
      body: { status: "active", user_confirmed: true },
    });
    assert.equal(confirmed.memory.status, "active");
    assert.equal(confirmed.memory.user_confirmed, true);

    const archived = await requestJson(`/api/memories/${memoryId}`, {
      method: "PATCH",
      body: { status: "archived" },
    });
    assert.equal(archived.memory.status, "archived");

    const restored = await requestJson(`/api/memories/${memoryId}`, {
      method: "PATCH",
      body: { status: "active" },
    });
    assert.equal(restored.memory.status, "active");

    const exported = await requestJson("/api/export/memories");
    assert.equal(Boolean(exported.exported_at), true);
    assert.equal(exported.kind, "memories");
    assert.equal(typeof exported.count, "number");
    assert.equal(Array.isArray(exported.memories), true);
    assert.equal(exported.memories.some((memory) => memory.id === memoryId), true);
    assert.equal(exported.conversations, undefined);

    const rejectedClear = await requestJson("/api/clear/memories", {
      method: "POST",
      body: { confirm: "NO" },
      expectedStatus: 400,
    });
    assert.equal(rejectedClear.error, "confirmation_required");
  } finally {
    await requestJson(`/api/memories/${memoryId}`, {
      method: "DELETE",
      expectedStatus: 200,
    }).catch(() => {});
    await cleanupTestMemories();
  }

  console.log("Memory management tests passed");
} finally {
  await closeServer();
}

function listen() {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer() {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close(() => resolve());
  });
}

async function waitForServer() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const health = await requestJson("/api/health");
      if (health.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error("Server did not start");
}

async function cleanupTestMemories() {
  const payload = await requestJson("/api/memories");
  const testMemories = payload.memories.filter((memory) =>
    `${memory.display_title || ""} ${memory.content || ""}`.includes("TEST_MEMORY_DELETE_ME"),
  );

  for (const memory of testMemories) {
    await requestJson(`/api/memories/${memory.id}`, {
      method: "DELETE",
      expectedStatus: 200,
    }).catch(() => {});
  }
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  const expectedStatus = options.expectedStatus || 200;

  assert.equal(response.status, expectedStatus, `${path} returned ${response.status}`);
  return payload;
}
