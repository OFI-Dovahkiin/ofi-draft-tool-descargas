/* OFI Draft Tool — el service worker de la zona del equipo (/equipo/).
 *
 * Solo se registra en la zona **instalada** (assets/equipo.js), para que el
 * plan del Clash se abra aunque falle la conexión en mitad del torneo. En un
 * navegador normal no hay service worker ni copia.
 *
 * Qué guarda, y nada más:
 * - Las páginas de la zona, los estilos, el guion y el icono (son el
 *   esqueleto: no llevan nada del equipo).
 * - De lo del equipo, solo tu perfil (`/equipo/api/yo`) y los planes del Clash
 *   (`/equipo/api/cosas?tipo=plan`). Nunca la lista del equipo (lleva correos
 *   para los capitanes), ni el scouting del rival (se borra a los siete días),
 *   ni lo demás. Todo con la red primero; sin red, lo último guardado, con la
 *   cabecera `x-ofi-copia` para que la página avise de que es una copia.
 * - Los datos de Data Dragon (los nombres de Riot), por versión.
 *
 * Si la sesión de Access ha caducado, Access contesta con una redirección a su
 * página de entrada: eso NO es «sin conexión», y la página tiene que decir
 * que hay que volver a entrar (401 con `sinPase`).
 *
 * «Salir» borra todo lo guardado y quita este service worker (assets/equipo.js).
 */
const VERSION = "zona-v2";
const PROPIAS = `${VERSION}-propias`;
const DDRAGON = "https://ddragon.leagueoflegends.com";
const PRECARGA = ["/equipo/", "/equipo/plan/", "/assets/estilo.css", "/assets/equipo.js", "/assets/icono.svg"];
// Lo único del equipo que se guarda para verlo sin conexión.
const API_GUARDABLE = new Set(["/equipo/api/yo", "/equipo/api/cosas?tipo=plan"]);

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    try {
      const c = await caches.open(PROPIAS);
      await c.addAll(PRECARGA);
    } catch {
      /* sin sesión o sin conexión: se irá guardando al navegar */
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (!k.startsWith(VERSION)) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

/** La versión de Data Dragon de una dirección (/cdn/16.20.1/...), si la lleva. */
function versionDe(url) {
  const m = /^\/cdn\/(\d+\.\d+\.\d+)\//.exec(url.pathname);
  return m ? m[1] : null;
}

let versionDD = null;

async function deDataDragon(req, url) {
  // La lista de versiones cambia con cada parche: primero la red.
  if (url.pathname === "/api/versions.json") {
    try {
      const r = await fetch(req);
      if (r.ok) (await caches.open(`${VERSION}-dd-versiones`)).put(req, r.clone());
      return r;
    } catch {
      const g = await caches.match(req);
      if (g) return g;
      throw new Error("sin conexión");
    }
  }
  const v = versionDe(url) || versionDD || "sin-version";
  const nombre = `${VERSION}-dd-${v}`;
  if (v !== versionDD) {
    versionDD = v;
    // Una versión nueva: lo de las anteriores ya no se usa.
    for (const k of await caches.keys()) {
      if (k.startsWith(`${VERSION}-dd-`) && k !== nombre && k !== `${VERSION}-dd-versiones`) await caches.delete(k);
    }
  }
  const guardada = await caches.match(req);
  if (guardada) return guardada;
  const r = await fetch(req);
  if (r.ok && r.type === "cors") (await caches.open(nombre)).put(req, r.clone());
  return r;
}

function sesionCaducada() {
  return new Response(JSON.stringify({ ok: false, sinPase: true, mensaje: "Tu sesión ha caducado: recarga la página para volver a entrar." }), {
    status: 401,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function propia(req, url) {
  const api = url.pathname.startsWith("/equipo/api/");
  const guardable = !api || API_GUARDABLE.has(url.pathname + url.search);
  // Las de la API que pide la página, sin seguir redirecciones: una
  // redirección es Access pidiendo entrar otra vez, no un fallo de la red.
  // (Una dirección de la API escrita en la barra es una navegación: va tal cual.)
  const manual = api && req.mode !== "navigate";
  let r;
  try {
    r = await fetch(manual ? new Request(req, { redirect: "manual" }) : req);
  } catch (err) {
    const guardada = guardable ? await caches.match(req) : null;
    if (guardada) {
      const h = new Headers(guardada.headers);
      h.set("x-ofi-copia", guardada.headers.get("x-ofi-guardada") || "1");
      return new Response(guardada.body, { status: guardada.status, statusText: guardada.statusText, headers: h });
    }
    if (req.mode === "navigate") {
      const portada = await caches.match("/equipo/");
      if (portada) return portada;
    }
    throw err;
  }
  if (manual && r.type === "opaqueredirect") return sesionCaducada();
  if (guardable && r.ok && r.type === "basic" && !r.redirected) {
    // Se guarda con la hora, para que la página pueda decir de cuándo es.
    const h = new Headers(r.headers);
    h.set("x-ofi-guardada", String(Date.now()));
    const copia = new Response(await r.clone().blob(), { status: r.status, statusText: r.statusText, headers: h });
    (await caches.open(PROPIAS)).put(req, copia);
  }
  return r;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === DDRAGON) {
    if (url.pathname.endsWith(".json")) e.respondWith(deDataDragon(req, url));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/equipo/api/exportar/")) return;
  if (url.pathname.startsWith("/equipo/") || url.pathname.startsWith("/assets/")) e.respondWith(propia(req, url));
});
