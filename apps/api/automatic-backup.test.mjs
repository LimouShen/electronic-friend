import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAutomaticBackup, createBackupPayload } from "./server.mjs";

const testDirectory = await mkdtemp(path.join(os.tmpdir(), "electronic-friend-backup-"));

try {
  const store = {
    conversations: new Map([["conversation-1", {
      id: "conversation-1",
      title: "测试对话",
      messages: [{ id: "message-1", role: "user", content: "备份测试" }],
    }]]),
    memories: [{ id: "memory-1", type: "expression_preference", content: "别太鸡汤" }],
    settings: {
      model: "ernie-4.5-turbo-128k",
      apiKey: "must-never-be-backed-up",
    },
  };

  const payload = createBackupPayload(store, "2026-07-11T08:00:00.000Z");
  assert.equal(payload.backup_version, 1);
  assert.equal(payload.source, "automatic_local_backup");
  assert.equal(payload.conversations["conversation-1"].title, "测试对话");
  assert.equal(payload.memories[0].content, "别太鸡汤");
  assert.equal(payload.settings.model, "ernie-4.5-turbo-128k");
  assert.equal(payload.settings.apiKey, undefined, "自动存档不能包含 API 密钥");

  for (let index = 0; index < 3; index += 1) {
    await createAutomaticBackup({
      backupDir: testDirectory,
      store,
      retentionCount: 2,
      now: new Date(Date.UTC(2026, 6, 11, 8, index, 0)),
    });
  }

  const files = (await readdir(testDirectory))
    .filter((filename) => filename.endsWith(".json"))
    .sort();
  assert.equal(files.length, 2, "超过保留数量的旧自动存档应被清理");

  const latest = JSON.parse(await readFile(path.join(testDirectory, files.at(-1)), "utf8"));
  assert.equal(latest.conversations["conversation-1"].messages[0].content, "备份测试");
  assert.equal(latest.memories[0].type, "expression_preference");

  console.log("Automatic backup tests passed");
} finally {
  await rm(testDirectory, { recursive: true, force: true });
}
