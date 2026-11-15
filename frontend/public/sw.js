const BUILD = "__BUILD__";
const GEO = "__GEO__";
const PRECACHE = self.__PRECACHE__ || [];
const STATIC = `ee-static-${BUILD}`;
const GEOC = `ee-geo-${GEO}`;
const API = "ee-api";
const METADATA = "ee-metadata";
const RESULTS = "ee-results";
const TILES = "ee-tiles";
const MAX_TILES = 2500;
const MAX_API = 1500;
const METADATA_PATHS = new Set(["/api/v1/vis/catalog", "/api/v1/packs", "/api/v1/layers", "/api/v1/datasets"]);
const TRIM_EVERY = 64;
const CACHE_WAIT_MS = 3000;

function apiCache(url) {
  if (METADATA_PATHS.has(url.pathname)) return METADATA;
  return url.pathname === "/api/v1/vis/grid" ? API : RESULTS;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const s = await caches.open(STATIC);
    const g = await caches.open(GEOC);

    for (const url of PRECACHE) {

      try { await (url.startsWith("/geo/") ? g : s).add(url); } catch (e) {  }
    }

    const a = await caches.open(METADATA);
    for (const url of ["/api/v1/datasets", "/api/v1/vis/catalog"]) {
      try { const r = await fetch(url); if (r.ok) await a.put(url, r); } catch (e) {  }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([STATIC, GEOC, API, METADATA, RESULTS, TILES, "ee-geo-packs", "ee-tile-packs", "ee-snapshot-packs"]);

    const old = await caches.open(API);
    for (const req of await old.keys()) {
      const name = apiCache(new URL(req.url));
      if (name === API) continue;
      try {
        const target = await caches.open(name);
        if (!(await target.match(req, { ignoreVary: true }))) await target.put(req, await old.match(req, { ignoreVary: true }));
        await old.delete(req);
      } catch {  }
    }
    for (const k of await caches.keys()) if (k.startsWith("ee-") && !keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  if (keys.length <= max) return;
  for (const k of keys.slice(0, keys.length - max + Math.floor(max / 10))) await c.delete(k);
}

const maintenance = new Map();
async function maintain(cacheName, max) {
  let state = maintenance.get(cacheName);
  if (!state) { state = { writes: TRIM_EVERY - 1, pending: null }; maintenance.set(cacheName, state); }
  state.writes++;
  if (state.pending || state.writes < TRIM_EVERY) return;
  state.pending = (async () => {
    do {
      state.writes = 0;
      await trim(cacheName, max);
    } while (state.writes >= TRIM_EVERY);
  })();
  try { await state.pending; } finally { state.pending = null; }
}

function saveResponse(event, cache, req, resp, name, max) {

  const copy = resp.clone();
  event.waitUntil((async () => {
    await cache.put(req, copy);
    if (max) await maintain(name, max);
  })().catch(() => {}));
}

function offlineJSON(message) {
  return new Response(JSON.stringify({ error: { code: "offline", message } }), { status: 503, headers: { "Content-Type": "application/json", "X-EE-Offline": "1" } });
}

function withHeader(resp, name, value) {
  const h = new Headers(resp.headers);
  h.set(name, value);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

async function cacheFirst(event, req, cacheName, maxEntries) {
  const c = await caches.open(cacheName);

  const hit = await caches.match(req, { ignoreVary: true });
  if (hit) return cacheName === API ? withHeader(hit, "X-EE-SW-Cache", hit.headers.get("date") || "1") : hit;
  try {
    const resp = await fetch(req);
    if (resp.ok) {
      saveResponse(event, c, req, resp, cacheName, maxEntries);
    }
    return resp;
  } catch (e) {
    return new Response("", { status: 504, statusText: "offline and not cached" });
  }
}

async function staleWhileRevalidate(event, req) {
  const c = await caches.open(RESULTS);
  const hit = await c.match(req, { ignoreVary: true }) || await (await caches.open(API)).match(req, { ignoreVary: true });
  const refresh = fetch(req).then(async (resp) => {
    if (resp.ok) saveResponse(event, c, req, resp, RESULTS, MAX_API);
    return resp;
  });
  if (hit) {
    event.waitUntil(refresh.catch(() => {}));
    return withHeader(hit, "X-EE-SW-Cache", hit.headers.get("date") || "1");
  }
  try { return await refresh; } catch (e) { return offlineJSON("Offline, and this result was never retrieved on this device."); }
}

async function networkFirst(event, req) {
  const name = apiCache(new URL(req.url));
  const c = await caches.open(name);
  const hit = await c.match(req, { ignoreVary: true }) || await (await caches.open(API)).match(req, { ignoreVary: true });
  const fallback = () => withHeader(hit.clone(), "X-EE-SW-Cache", hit.headers.get("date") || "1");
  const refresh = (async () => {
    try {
      const resp = await fetch(req);
      if (resp.ok) saveResponse(event, c, req, resp, name, name === METADATA ? undefined : MAX_API);
      if (resp.status >= 500 && hit) return fallback();
      return resp;
    } catch {
      return hit ? fallback() : offlineJSON("Offline, and this request was never cached on this device.");
    }
  })();
  if (!hit) return refresh;

  event.waitUntil(refresh.then(() => {}));
  let timer;
  try {
    return await Promise.race([refresh, new Promise((resolve) => { timer = setTimeout(() => resolve(fallback()), CACHE_WAIT_MS); })]);
  } finally { clearTimeout(timer); }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.hash === "#pack") return;

  if (url.origin === self.location.origin) {
    if (url.pathname === "/api/v1/health") return;
    if (url.pathname.startsWith("/api/v1/earthquakes")) return event.respondWith(networkFirst(event, req));

    if (url.pathname.startsWith("/api/v1/events")) return event.respondWith(networkFirst(event, req));

    if (METADATA_PATHS.has(url.pathname)) return event.respondWith(networkFirst(event, req));

    if (url.pathname === "/api/v1/vis/grid" && url.searchParams.has("v")) return event.respondWith(cacheFirst(event, req, API, MAX_API));
    if (url.pathname.startsWith("/api/v1/")) return event.respondWith(staleWhileRevalidate(event, req));
    if (url.pathname.startsWith("/geo/")) return event.respondWith(cacheFirst(event, req, GEOC));

    if (url.pathname.startsWith("/evidence/")) return event.respondWith(staleWhileRevalidate(event, req));
    if (req.mode === "navigate") {
      return event.respondWith(fetch(req).catch(async () => (await caches.match("/index.html", { ignoreVary: true })) || (await caches.match("/", { ignoreVary: true })) || new Response("Offline", { status: 503 })));
    }
    return event.respondWith(cacheFirst(event, req, STATIC));
  }

  if (url.hostname === "gibs.earthdata.nasa.gov" && url.pathname.startsWith("/wmts/")) return event.respondWith(cacheFirst(event, req, TILES, MAX_TILES));
  if (url.hostname.endsWith("amazonaws.com") && url.pathname.includes("terrarium/")) return event.respondWith(cacheFirst(event, req, TILES, MAX_TILES));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "cache-urls") {

    event.waitUntil((async () => {
      const c = await caches.open(STATIC);
      for (const u of event.data.urls) { try { if (!(await caches.match(u, { ignoreVary: true }))) await c.add(u); } catch (e) {  } }
    })());
    return;
  }
  if (event.data?.type !== "list-api") return;
  event.waitUntil((async () => {
    const keys = [...await (await caches.open(RESULTS)).keys(), ...await (await caches.open(API)).keys()];
    event.source?.postMessage({ type: "api-list", urls: keys.map((k) => k.url) });
  })());
});
