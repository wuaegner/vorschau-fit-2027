/* Entschlüsselt die Vorschau im Browser. Der Schlüssel bleibt auf dem Gerät. */
const DB = 'vorschau', STORE = 'vault';
const scope = () => new URL(self.registration.scope);
const cache = new Map();
let vault = null;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

function loadVault() {
  return new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onerror = () => no(r.error);
    r.onsuccess = () => {
      const g = r.result.transaction(STORE).objectStore(STORE).get('v');
      g.onsuccess = () => ok(g.result || null);
      g.onerror = () => no(g.error);
    };
  });
}

async function plain(entry, key) {
  if (cache.has(entry.id)) return cache.get(entry.id);
  const res = await fetch(new URL(`d/${entry.id}.bin`, scope()));
  if (!res.ok) throw new Error('fehlt');
  const raw = new Uint8Array(await res.arrayBuffer());
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12));
  cache.set(entry.id, data);
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  return data;
}

async function serve(request, rel) {
  vault = vault || await loadVault();
  if (!vault) return Response.redirect(scope().href, 302);
  const entry = vault.manifest[rel];
  if (!entry) return new Response('Nicht gefunden', { status: 404 });
  const data = await plain(entry, vault.key);
  const headers = { 'Content-Type': entry.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (!range) return new Response(data, { headers: { ...headers, 'Content-Length': String(data.byteLength) } });
  const size = data.byteLength;
  let start, end;
  if (range[1] === '') {
    const tail = Math.min(Number(range[2]), size);
    start = size - tail;
    end = size - 1;
  } else {
    start = Number(range[1]);
    end = range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
  }
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(data.slice(start, end + 1), {
    status: 206,
    headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` },
  });
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const app = new URL('app/', scope());
  if (url.origin !== app.origin || !url.pathname.startsWith(app.pathname)) return;
  const rel = decodeURIComponent(url.pathname.slice(app.pathname.length)) || 'challenge.html';
  e.respondWith(serve(e.request, rel).catch(() => new Response('Vorschau konnte nicht geladen werden', { status: 500 })));
});
