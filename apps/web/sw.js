const LEGACY_CACHE_PREFIX = "electronic-friend-pwa-";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    retireWorker(),
  );
});

async function retireWorker() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter((name) => name.startsWith(LEGACY_CACHE_PREFIX))
      .map((name) => caches.delete(name)),
  );

  const windowClients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  await self.registration.unregister();

  // Reload pages once after this replacement worker removes the old
  // navigation/cache handler. Failures are harmless; the next launch is direct.
  await Promise.allSettled(
    windowClients.map((client) => {
      const url = new URL(client.url);
      url.searchParams.set("worker-retired", "24");
      url.searchParams.set("t", String(Date.now()));
      return client.navigate(url.href);
    }),
  );
}
