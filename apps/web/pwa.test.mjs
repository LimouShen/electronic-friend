import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const webDir = path.dirname(__filename);
const rootDir = path.resolve(webDir, "../..");

const files = {
  html: path.join(webDir, "index.html"),
  app: path.join(webDir, "app.js"),
  styles: path.join(webDir, "styles.css"),
  manifest: path.join(webDir, "manifest.webmanifest"),
  sw: path.join(webDir, "sw.js"),
  offline: path.join(webDir, "offline.html"),
  server: path.join(rootDir, "apps/api/server.mjs"),
  packageJson: path.join(rootDir, "package.json"),
  productRequirements: path.join(rootDir, "docs/product-requirements.md"),
  designPrinciples: path.join(rootDir, "docs/design-principles.md"),
};

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function pngSize(filePath) {
  const buffer = readFileSync(filePath);
  assert.equal(buffer.toString("ascii", 1, 4), "PNG", `${filePath} must be a PNG`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

const html = await readFile(files.html, "utf8");
const app = await readFile(files.app, "utf8");
const styles = await readFile(files.styles, "utf8");
const manifest = JSON.parse(await readFile(files.manifest, "utf8"));
const sw = await readFile(files.sw, "utf8");
const offline = await readFile(files.offline, "utf8");
const serverSource = await readFile(files.server, "utf8");
const packageJson = JSON.parse(await readFile(files.packageJson, "utf8"));
const productRequirements = await readFile(files.productRequirements, "utf8");
const designPrinciples = await readFile(files.designPrinciples, "utf8");

test("manifest has installable app identity", () => {
  assert.equal(manifest.short_name, "石头");
  assert.equal(manifest.name, "石头 · 电子挚友");
  assert.equal(manifest.lang, "zh-CN");
});

test("manifest starts inside the app scope as standalone portrait PWA", () => {
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "portrait");
});

test("manifest keeps warm mobile chrome colors", () => {
  assert.equal(manifest.theme_color, "#fff7ef");
  assert.equal(manifest.background_color, "#fff7ef");
});

test("manifest declares required maskable PNG icons", () => {
  const iconSizes = manifest.icons.map((icon) => icon.sizes).sort();
  assert.deepEqual(iconSizes, ["192x192", "512x512"]);
  for (const icon of manifest.icons) {
    assert.equal(icon.type, "image/png");
    assert.match(icon.purpose, /maskable/);
    assert.ok(existsSync(path.join(webDir, icon.src)));
  }
});

test("PWA icons are real square PNGs", () => {
  assert.deepEqual(pngSize(path.join(webDir, "assets/pwa-icon-192.png")), {
    width: 192,
    height: 192,
  });
  assert.deepEqual(pngSize(path.join(webDir, "assets/pwa-icon-512.png")), {
    width: 512,
    height: 512,
  });
  assert.deepEqual(pngSize(path.join(webDir, "assets/pwa-apple-touch-icon.png")), {
    width: 180,
    height: 180,
  });
});

test("HTML exposes PWA metadata for mobile browsers", () => {
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/assets\/pwa-apple-touch-icon\.png"/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /name="theme-color" content="#fff7ef"/);
  assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
});

test("HTML keeps the existing core pages and mobile chat surface", () => {
  for (const pageId of ["chatPage", "personaPage", "settingsPage"]) {
    assert.match(html, new RegExp(`id="${pageId}"`));
  }
  assert.match(html, /id="composer"/);
  assert.match(html, /石头的小本本/);
});

test("settings page keeps export and PWA helper copy quiet", () => {
  assert.match(html, /<p>JSON<\/p>/);
  assert.match(html, /数据控制/);
  assert.match(html, /<span>对话导出<\/span>/);
  assert.match(html, /<span>记忆导出<\/span>/);
  assert.match(html, /<span>清空记忆<\/span>/);
  assert.match(html, /id="clearMemoriesSettingsButton"/);
  assert.match(html, /内测版 v0\.1/);
  assert.doesNotMatch(html, /私人陪伴 · 内测版/);
  assert.doesNotMatch(html, /可以分别导出对话或记忆/);
  assert.doesNotMatch(html, /导出对话数据/);
  assert.doesNotMatch(html, /导出记忆数据/);
  assert.doesNotMatch(html, /历史聊天和会话摘要/);
  assert.doesNotMatch(html, /<span>石头的小本本<\/span>/);
  assert.doesNotMatch(app, /手机浏览器可添加到主屏幕/);
});

test("standalone mode does not announce that the phone desktop version is ready", () => {
  assert.doesNotMatch(app, /手机桌面版已就位/);
});

test("settings page typography stays below page title and export buttons are compact", () => {
  assert.match(styles, /\.settings-block h2,[\s\S]*\.setting-field span\s*{[\s\S]*font-size: var\(--text-card-title\)/);
  assert.match(styles, /\.settings-block p\s*{[\s\S]*font-size: var\(--text-caption\)/);
  assert.match(styles, /\.model-control-row\s*{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\) auto/);
  assert.match(styles, /\.model-status-dot\.connected/);
  assert.match(styles, /\.data-control-list\s*{/);
  assert.match(styles, /\.data-control-list button\s*{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.doesNotMatch(styles, /\.export-inline-options/);
  assert.match(designPrinciples, /设置项标题.*必须小于页面标题/);
});

test("chat page exposes message cleanup without turning into a task tool", () => {
  assert.match(html, /id="messageContextMenu"/);
  assert.match(html, /data-message-action="copy"/);
  assert.match(html, /data-message-action="delete"/);
  assert.match(html, /data-message-action="select"/);
  assert.match(html, /id="messageSelectionBar"/);
  assert.match(html, /id="deleteSelectedMessagesButton"/);
  assert.match(app, /message-selection-mode/);
  assert.match(app, /startLongPress/);
  assert.match(app, /contextmenu/);
  assert.match(app, /messages\/delete/);
  assert.match(app, /method: "DELETE"/);
  assert.match(styles, /\.message-context-menu/);
  assert.match(styles, /\.message-selection-bar/);
  assert.match(styles, /\.message-selection-mode \.message\.assistant::before\s*{[\s\S]*display: none/);
  assert.doesNotMatch(html, /id="messageSelectToggle"/);
  assert.doesNotMatch(styles, /\.message-tools/);
  assert.doesNotMatch(html, /任务管理/);
});

test("settings page reads model state without exposing secrets", () => {
  assert.match(html, /id="modelSelect"/);
  assert.match(html, /id="saveModelButton"/);
  assert.match(html, /id="modelStatusDot"/);
  assert.match(html, /id="appToast"/);
  assert.match(app, /\/api\/settings/);
  assert.match(app, /api_key_configured/);
  assert.match(app, /showToast/);
  assert.doesNotMatch(app, /AI_STUDIO_API_KEY/);
  assert.doesNotMatch(html, /API Key/);
});

test("PRD points to the front-end design principles document", () => {
  assert.match(productRequirements, /docs\/design-principles\.md/);
  assert.match(designPrinciples, /全局文字层级/);
  assert.match(designPrinciples, /聊天页/);
  assert.match(designPrinciples, /石头档案页/);
  assert.match(designPrinciples, /设置页/);
});

test("app starts from one inline HTML response before best-effort legacy cleanup", () => {
  assert.match(html, /<!-- STONE_INLINE_STYLES -->/);
  assert.match(html, /<!-- STONE_INLINE_APP -->/);
  assert.doesNotMatch(html, /<link rel="stylesheet"/);
  assert.doesNotMatch(html, /script\.src/);
  assert.match(html, /正在载入聊天页面/);
  assert.match(html, /window\.setTimeout\(retireLegacyWorkers, 3000\)/);
  assert.match(html, /navigator\.serviceWorker\.getRegistrations\(\)/);
  assert.match(html, /registration\.unregister\(\)/);
  assert.match(html, /electronic-friend-pwa-/);
  assert.match(html, /caches\.delete\(name\)/);
  assert.doesNotMatch(html, /window\.location\.replace\("\/\?direct=/);
  assert.match(serverSource, /async function buildInlineIndex\(\)/);
  assert.match(serverSource, /data-stone-styles-version="24"/);
  assert.match(serverSource, /data-stone-app-version="24"/);
  assert.match(serverSource, /gzipSync\(content\)/);
  assert.match(serverSource, /"Content-Length": String\(responseBody\.length\)/);
  assert.doesNotMatch(html, /serviceWorker\.register/);
  assert.doesNotMatch(app, /serviceWorker\.register/);
  assert.match(app, /beforeinstallprompt/);
  assert.match(app, /appinstalled/);
  assert.match(app, /deferredInstallPrompt\.prompt\(\)/);
});

test("server delivers the complete startup shell in one compressed response", async () => {
  const { server } = await import("../api/server.mjs");
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/?inline-test=24`, {
      headers: { "Accept-Encoding": "gzip" },
    });
    const document = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-encoding"), "gzip");
    assert.match(document, /data-stone-styles-version="24"/);
    assert.match(document, /data-stone-app-version="24"/);
    assert.doesNotMatch(document, /STONE_INLINE_/);
    assert.doesNotMatch(document, /\/styles\.css/);
    assert.doesNotMatch(document, /\/app\.js/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("app verifies the private host instead of trusting Safari network state", () => {
  assert.match(app, /window\.addEventListener\("online"/);
  assert.match(app, /window\.addEventListener\("offline"/);
  assert.match(app, /display-mode: standalone/);
  assert.match(app, /\/api\/health\?network-status=/);
  assert.match(app, /cache: "no-store"/);
  assert.match(app, /payload\.ok === true/);
  assert.doesNotMatch(app, /if \(!navigator\.onLine\)/);
  assert.match(app, /没连上电脑里的石头/);
});

test("legacy service worker retires itself without intercepting requests", () => {
  assert.match(sw, /LEGACY_CACHE_PREFIX = "electronic-friend-pwa-"/);
  assert.match(sw, /self\.skipWaiting\(\)/);
  assert.match(sw, /self\.registration\.unregister\(\)/);
  assert.match(sw, /self\.clients\.matchAll/);
  assert.match(sw, /client\.navigate\(url\.href\)/);
  assert.doesNotMatch(sw, /addEventListener\("fetch"/);
  assert.doesNotMatch(sw, /APP_SHELL/);
  assert.doesNotMatch(sw, /cache\.addAll/);
});

test("Safari never stays blank when app startup fails", () => {
  assert.match(html, /id="bootGuard"/);
  assert.match(html, /正在连接石头/);
  assert.match(html, /window\.__stoneBootFail/);
  assert.match(html, /window\.__stoneBootProgress/);
  assert.match(html, /正在载入聊天页面/);
  assert.match(html, /window\.addEventListener\("error"/);
  assert.match(html, /window\.addEventListener\("unhandledrejection"/);
  assert.match(html, /已超过 20 秒/);
  assert.match(app, /if \(window\.__stoneBootReady\) window\.__stoneBootReady\(\);\s*init\(\)/);
  assert.match(app, /石头的数据暂时没加载完整/);
  assert.match(app, /正在读取石头的设置/);
  assert.match(app, /正在读取最近的对话/);
  assert.match(styles, /height: 100vh;\s+height: 100dvh;/);
});

test("retirement worker deletes only legacy PWA caches", () => {
  assert.match(sw, /name\.startsWith\(LEGACY_CACHE_PREFIX\)/);
  assert.match(sw, /caches\.delete\(name\)/);
  assert.doesNotMatch(sw, /caches\.delete\([^n]/);
  assert.doesNotMatch(sw, /fetch\(/);
});

test("legacy offline page can still recover without blocking direct startup", () => {
  assert.match(offline, /石头还没开/);
  assert.match(offline, /石头开关/);
  assert.match(offline, /\/api\/health\?retry=/);
  assert.match(offline, /registration\.unregister\(\)/);
  assert.match(offline, /caches\.delete\(name\)/);
  assert.match(offline, /window\.location\.replace/);
  assert.doesNotMatch(offline, /location\.reload/);
});

test("retirement worker contains no install shell for iPhone", () => {
  assert.doesNotMatch(sw, /shitou-halfbody/);
  assert.doesNotMatch(sw, /shitou-front-cutout/);
  assert.doesNotMatch(sw, /cache\.match/);
  assert.doesNotMatch(sw, /caches\.match/);
});

test("CSS handles safe areas and standalone display mode", () => {
  assert.match(styles, /env\(safe-area-inset-top\)/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /@media \(display-mode: standalone\)/);
});

test("CSS keeps the mobile composer ergonomic", () => {
  assert.match(styles, /\.composer/);
  assert.match(styles, /--text-body: 16px/);
  assert.match(styles, /\.composer textarea\s*{[\s\S]*font-size: var\(--text-body\)/);
  assert.match(styles, /@media \(max-width: 420px\)/);
  assert.match(styles, /#sendButton/);
});

test("mobile chat typography stays compact and readable", () => {
  assert.match(styles, /--text-page-title: 17px/);
  assert.match(styles, /--text-chat: 14px/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*h1\s*{[\s\S]*font-size: var\(--text-page-title\)/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.message\s*{[\s\S]*font-size: var\(--text-chat\)/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.composer textarea\s*{[\s\S]*font-size: var\(--text-chat\)/);
});

test("mobile sticky bars and composer stay compact", () => {
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*min-height: calc\(46px \+ env\(safe-area-inset-top\)\)/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.chat-page \.composer\s*{[\s\S]*padding: 6px/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*#sendButton\s*{[\s\S]*width: 40px/);
});

test("chat header title stays on one line with ellipsis", () => {
  assert.match(styles, /#chatTitle\s*{[\s\S]*overflow: hidden/);
  assert.match(styles, /#chatTitle\s*{[\s\S]*text-overflow: ellipsis/);
  assert.match(styles, /#chatTitle\s*{[\s\S]*white-space: nowrap/);
});

test("mobile chat layout prevents long titles and bubbles from widening the viewport", () => {
  assert.match(styles, /html\s*{[\s\S]*overflow-x: hidden/);
  assert.match(styles, /\.page-shell\s*{[\s\S]*max-width: 100vw/);
  assert.match(styles, /\.app-header\s+\.title-row > div\s*{[\s\S]*overflow: hidden/);
  assert.match(styles, /\.composer\s*{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.message\.assistant\s*{[\s\S]*max-width: calc\(100% - 44px\)/);
  assert.match(styles, /@media \(max-width: 420px\)[\s\S]*\.message\.assistant\s*{[\s\S]*max-width: calc\(100% - 38px\)/);
});

test("mobile history selection does not depend on hover and closes the drawer", () => {
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.conversation-more,[\s\S]*\.conversation-item:hover \.conversation-more\s*{[\s\S]*opacity: 1/);
  assert.match(app, /function closeNav\(\)/);
  assert.match(app, /function isMobileNavLayout\(\)/);
  assert.match(app, /if \(isMobileNavLayout\(\)\) closeNav\(\)/);
});

test("mobile history closes the drawer before loading conversation messages", () => {
  const continueStart = app.indexOf("async function continueConversation(nextConversationId)");
  const continueEnd = app.indexOf("async function loadMemories()", continueStart);
  const continueSource = app.slice(continueStart, continueEnd);
  assert.ok(continueStart >= 0 && continueEnd > continueStart);
  assert.ok(
    continueSource.indexOf("if (isMobileNavLayout()) closeNav();") < continueSource.indexOf("await fetch("),
    "the drawer must start closing before conversation loading begins",
  );
  assert.equal(
    (continueSource.match(/if \(isMobileNavLayout\(\)\) closeNav\(\);/g) || []).length,
    1,
    "history selection should use one immediate close instead of delayed close calls",
  );
});

test("mobile side navigation closes before async page loading", () => {
  assert.match(app, /link\.addEventListener\("click", async \(\) => {\s+if \(isMobileNavLayout\(\)\) closeNav\(\);\s+await showPage\(link\.dataset\.page\);/);
});

test("mobile new chat closes the side navigation before focusing the composer", () => {
  assert.match(app, /function startNewConversation\(\) {\s+if \(isMobileNavLayout\(\)\) closeNav\(\);/);
  assert.match(app, /showWelcomeMessage\(\);\s+showPage\("chatPage"\);\s+renderConversations\(\);\s+inputEl\.focus\(\);/);
  assert.match(app, /async function continueConversation\(nextConversationId\) {\s+if \(isMobileNavLayout\(\)\) closeNav\(\);[\s\S]*localConversationDraft\?\.id === nextConversationId[\s\S]*inputEl\.focus\(\);\s+return;/);
});

test("PWA work does not add tool-agent positioning", () => {
  const combined = [html, app, styles, sw, JSON.stringify(manifest)].join("\n");
  assert.doesNotMatch(combined, /calendar|email|任务管理|自动化 Agent|tool agent/i);
});

test("package.json exposes the PWA test command", () => {
  assert.equal(packageJson.scripts["test:pwa"], "node apps/web/pwa.test.mjs");
});

test("mobile profile uses the lightweight approved portrait asset", () => {
  assert.match(html, /src="\/assets\/shitou-front-cutout\.png\?v=3"/);
  assert.match(html, /alt="石头形象"/);
  assert.ok(existsSync(path.join(webDir, "assets/shitou-front-cutout.png")));
  assert.ok(existsSync(path.join(webDir, "assets/shitou-head.png")));
  assert.ok(existsSync(path.join(webDir, "assets/shitou-front.png")));
});

test("profile portrait bypasses stale image caches and has fallbacks", () => {
  assert.match(sw, /electronic-friend-pwa-/);
  assert.match(html, /\/assets\/shitou-front-cutout\.png\?v=3/);
  assert.doesNotMatch(sw, /\/assets\/shitou-front-cutout\.png/);
  assert.match(app, /PERSONA_PORTRAIT_FALLBACKS/);
  assert.match(app, /\/assets\/shitou-head\.png\?v=3/);
  assert.match(app, /\/assets\/shitou-front\.png\?v=3/);
  assert.match(app, /portrait\.addEventListener\("error", loadNextFallback\)/);
  assert.match(app, /portrait\.complete && portrait\.naturalWidth === 0/);
});

test("profile memory detail has a hidden backdrop for mobile sheet closing", () => {
  assert.match(html, /class="memory-detail-backdrop" id="memoryDetailBackdrop" hidden/);
  assert.match(html, /class="memory-detail-panel" id="memoryDetailPanel"/);
});

test("profile keeps memory list and detail in the existing workspace", () => {
  assert.match(html, /<div class="memory-workspace">/);
  assert.match(html, /<div class="memory-list" id="memoryList"><\/div>/);
  assert.match(html, /aria-label="记忆详情"/);
});

test("mobile memory item taps open the detail sheet without changing desktop selection flow", () => {
  assert.match(app, /selectedMemoryId = memory\.id/);
  assert.match(app, /renderMemories\(getFilteredMemories\(\)\)/);
  assert.match(app, /if \(isMobilePersonaLayout\(\)\) openMemoryDetailPanel\(\)/);
});

test("memory filters close any open mobile detail sheet before rerendering", () => {
  assert.match(app, /memoryTypeFilterEl\.addEventListener\("change", \(\) => {\s+closeMemoryDetailPanel\(\)/);
  assert.match(app, /memoryStatusFilterEl\.addEventListener\("change", \(\) => {\s+closeMemoryDetailPanel\(\)/);
});

test("mobile detail sheet can be dismissed by backdrop, escape, and desktop resize", () => {
  assert.match(app, /memoryDetailBackdropEl\.addEventListener\("click", closeMemoryDetailPanel\)/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /if \(!isMobilePersonaLayout\(\)\) closeMemoryDetailPanel\(\)/);
});

test("memory detail renders a close control for the mobile sheet", () => {
  assert.match(app, /createButton\("收起", closeMemoryDetailPanel, "memory-detail-close"\)/);
  assert.match(app, /setAttribute\("aria-label", "收起记忆详情"\)/);
});

test("mobile profile page uses natural page scrolling instead of locked nested scrolling", () => {
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.persona-page\s*{[\s\S]*overflow-y: auto/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.persona-content\s*{[\s\S]*overflow: visible/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.memory-list\s*{[\s\S]*overflow: visible/);
});

test("mobile profile header stays sticky while the profile page scrolls", () => {
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.persona-page \.content-header\s*{[\s\S]*position: sticky/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.persona-page \.content-header\s*{[\s\S]*top: 0/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.nav-float-button\s*{[\s\S]*top: calc\(5px \+ env\(safe-area-inset-top\)\)/);
});

test("mobile memory notebook title keeps a left aligned inset", () => {
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.section-header\s*{[\s\S]*padding: 14px 14px 8px 18px/);
});

test("mobile memory detail is implemented as a bottom sheet", () => {
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.memory-detail-panel\s*{[\s\S]*position: fixed/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*bottom: 0/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*transform: translateY\(calc\(100% \+ 24px\)\)/);
  assert.match(styles, /\.memory-detail-open \.memory-detail-panel\s*{[\s\S]*transform: translateY\(0\)/);
});

test("desktop profile keeps the side-panel detail while mobile adds sheet-only close styling", () => {
  assert.match(styles, /\.memory-detail-panel\s*{[\s\S]*display: grid;[\s\S]*grid-template-rows: auto auto auto auto auto/);
  assert.match(styles, /\.memory-detail-close\s*{[\s\S]*display: none/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.memory-detail-close\s*{[\s\S]*display: inline-flex/);
});

test("mobile profile has the UI mockup summary card and chips", () => {
  assert.match(html, /class="mobile-persona-summary"/);
  assert.match(html, /class="mobile-persona-portrait"\s+src="\/assets\/shitou-front-cutout\.png\?v=3"/);
  assert.match(html, /class="mobile-persona-chips"/);
  assert.match(styles, /\.mobile-persona-summary\s*{\s*display: none/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.mobile-persona-summary\s*{[\s\S]*display: grid/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.mobile-persona-summary\s*{[\s\S]*overflow: visible/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.mobile-persona-portrait\s*{[\s\S]*margin-top: -42px/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.mobile-persona-portrait\s*{[\s\S]*margin-bottom: 10px/);
});

test("memory notebook removes feature subtitle and uses select placeholders", () => {
  assert.doesNotMatch(html, /记忆功能/);
  assert.match(html, /<option value="">类型<\/option>/);
  assert.match(html, /<option value="">状态<\/option>/);
});

test("mobile clear memory action is text-only and transparent", () => {
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.memory-toolbar button\s*{[\s\S]*border-color: transparent/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.memory-toolbar button\s*{[\s\S]*background: transparent/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.memory-toolbar button\s*{[\s\S]*font-size: 12px/);
});

test("mobile memory cards use dot marker, arrow affordance, and right status edge", () => {
  assert.match(app, /more\.textContent = "›"/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.memory-item::after\s*{[\s\S]*border-radius: 50%/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.memory-item::before\s*{[\s\S]*inset: 0 0 0 auto/);
  assert.match(styles, /\.memory-item\.active::before\s*{[\s\S]*background: #4d9f5b/);
  assert.match(styles, /\.memory-item\.candidate::before\s*{[\s\S]*background: #e19a3e/);
  assert.match(styles, /\.memory-item\.archived::before\s*{[\s\S]*background: #cf5547/);
});

test("mobile memory badges are rounded squares placed in the right grid area", () => {
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.memory-meta\s*{[\s\S]*grid-column: 3/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.memory-meta\s*{[\s\S]*align-self: center/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.memory-badge\s*{[\s\S]*font-size: 10px/);
});

test("mobile layout gives text, badges, and arrows separate grid columns", () => {
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.memory-item\s*{[\s\S]*grid-template-columns: 16px minmax\(0, 1fr\) 44px 16px/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.memory-item\s*{[\s\S]*height: 80px/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.memory-title\s*{[\s\S]*grid-column: 2/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.memory-summary\s*{[\s\S]*grid-column: 2/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.memory-more\s*{[\s\S]*grid-column: 4/);
});

test("mobile persona cards hide subtitles and keep body close to heading", () => {
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.profile-title-line\s*{[\s\S]*gap: 0/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.profile-block h3\s*{[\s\S]*display: none/);
});

test("memory detail enforces and displays character limits", () => {
  assert.match(app, /const MEMORY_TITLE_MAX_LENGTH = 20/);
  assert.match(app, /const MEMORY_CONTENT_MAX_LENGTH = 200/);
  assert.match(app, /titleInput\.maxLength = MEMORY_TITLE_MAX_LENGTH/);
  assert.match(app, /contentInput\.maxLength = MEMORY_CONTENT_MAX_LENGTH/);
  assert.match(app, /className = "field-counter"/);
});

test("memory detail actions are one row with semantic colors", () => {
  assert.match(app, /createButton\("确认"/);
  assert.match(app, /"confirm-button"/);
  assert.match(app, /"enable-button"/);
  assert.match(app, /"disable-button"/);
  assert.match(app, /"delete-button"/);
  assert.match(styles, /\.memory-detail-actions\s*{[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.confirm-button\s*{[\s\S]*background: #e6a43d/);
  assert.match(styles, /\.enable-button\s*{[\s\S]*background: #4d9f5b/);
  assert.match(styles, /\.disable-button\s*{[\s\S]*background: #cf5547/);
  assert.match(styles, /\.delete-button\s*{[\s\S]*background: rgba\(116, 109, 100, 0\.12\)/);
});

test("message selection keeps every bubble in the content column", () => {
  assert.match(
    styles,
    /\.message-selection-mode \.message-row > \.message\s*{[\s\S]*grid-column: 2;[\s\S]*min-width: 0;/,
  );
});

test("data export requires confirmation and memory clearing keeps typed confirmation", () => {
  assert.match(html, /id="confirmationOverlay"/);
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /id="confirmationPhraseInput"/);
  assert.match(app, /async function exportData\([\s\S]*await requestConfirmation\(\{/);
  assert.match(app, /confirmLabel: "确认导出"/);
  assert.match(app, /if \(!confirmed\) return;/);
  assert.match(app, /async function clearAllMemories\([\s\S]*requiredText: "清空记忆"/);
  assert.match(app, /function updateConfirmationButtonState\(\)[\s\S]*confirmationConfirmButtonEl\.disabled/);
  assert.doesNotMatch(app, /window\.confirm\(`确定导出/);
  assert.doesNotMatch(app, /window\.prompt\("要清空石头的小本本/);
  assert.match(styles, /\.confirmation-overlay\s*{/);
  assert.match(app, /body: JSON\.stringify\(\{ confirm: "CLEAR_MEMORIES" \}\)/);
});

test("failed chat messages expose an idempotent retry action", () => {
  assert.match(app, /request_id: requestId/);
  assert.match(app, /function retryChatMessage/);
  assert.match(app, /className = "message-retry-button"/);
  assert.match(app, /retry\.textContent = "再试一次"/);
  assert.match(styles, /\.message-retry-button\s*\{/);
});

test("memory detail shows only conversation title and date as provenance", () => {
  assert.match(app, /className = "memory-source"/);
  assert.match(app, /来自「\$\{source\.conversation_title\}」 · \$\{dateText\}/);
  assert.doesNotMatch(app, /memory\.source\.message_content/);
  assert.match(styles, /\.memory-source\s*\{/);
});

test("product decisions match the iPhone PWA acceptance scope", () => {
  assert.match(productRequirements, /iPhone Safari 与添加到主屏幕后的 PWA/);
  assert.match(productRequirements, /系统输入法完成语音转文字/);
  assert.match(productRequirements, /MVP 阶段保持只读/);
  assert.match(productRequirements, /P3\.5：私人云端可用/);
});

let passed = 0;
for (const item of tests) {
  try {
    await item.fn();
    passed += 1;
    console.log(`ok ${passed} - ${item.name}`);
  } catch (error) {
    console.error(`not ok ${passed + 1} - ${item.name}`);
    throw error;
  }
}

console.log(`\n${passed} PWA checks passed.`);
