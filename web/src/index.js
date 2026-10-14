/**
 * OFI Draft Tool — el pequeño servidor de ofidraft.com.
 *
 * Casi toda la web son ficheros estáticos (`public/`) que Cloudflare sirve
 * sin pasar por aquí. Por este fichero solo pasan las rutas de
 * `run_worker_first` en `wrangler.jsonc`:
 *
 *   /api/version           → la última versión y de cuándo son sus datos.
 *   /api/fallo             → el formulario de «Avisar de un fallo», por correo.
 *   /equipo/*              → la zona del equipo: cerrada con Cloudflare Access.
 *   /datos/*               → los datos para la app (todavía no hay).
 *
 * La descarga del instalador (/descargar/instalador) no pasa por aquí: es una
 * redirección de `public/_redirects` (la escribe `generar/generar_web.py`), y
 * así no gasta peticiones del plan gratuito.
 *
 * Sin dependencias: lo que hace falta (leer un JWT, codificar base64) está
 * escrito aquí con lo que trae el propio Worker.
 */

const REPO_DESCARGAS = "OFI-Dovahkiin/ofi-draft-tool-descargas";
const LATEST_JSON = `https://github.com/${REPO_DESCARGAS}/releases/latest/download/latest.json`;

// El formulario de fallos: lo que se acepta.
const FALLO = {
  // El cuerpo entero, leído por trozos: dos adjuntos de 2 MB en base64 y el texto.
  cuerpoBytesMax: 6 * 1024 * 1024,
  queMin: 10,
  queMax: 5000,
  campoMax: 2000,
  quienMax: 80,
  adjuntosMax: 2,
  adjuntoBytesMax: 2 * 1024 * 1024,
  // Menos de esto desde que se abrió la página es un robot, no una persona.
  msMin: 3000,
  // Por dirección IP y cada diez minutos.
  porVentana: 5,
  ventanaS: 600,
};
const TIPOS_ADJUNTO = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  log: "text/plain",
  txt: "text/plain",
  jsonl: "text/plain",
};
// Las opciones de «Dónde» del formulario (generar/paginas_es.py, `fallo`).
// Lo que no sea una de estas llega como «Otra cosa»: este texto va al asunto
// del correo, y en un asunto no puede entrar nada que no hayamos escrito.
const DONDE = [
  "Tablero de champ select", "Armería (runas, objetos, hechizos)", "Análisis de draft", "Equipo", "Jugadores",
  "Tier list", "Fichas de campeón", "Historial", "En partida (overlay)", "Centro de mando o ajustes",
  "Instalar o actualizar", "La web", "Otra cosa",
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const ruta = url.pathname;
    try {
      if (ruta === "/api/version") return await apiVersion(request, ctx);
      if (ruta === "/api/fallo") return await apiFallo(request, env, ctx);
      if (ruta.startsWith("/api/")) return json({ error: "no-existe" }, 404);
      if (ruta === "/equipo" || ruta.startsWith("/equipo/")) return await zonaEquipo(request, env);
      if (ruta.startsWith("/datos/")) return json({ error: "todavia-no" }, 404);
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error("fallo interno", ruta, e && e.stack ? e.stack : String(e));
      return json({ error: "interno", mensaje: "Algo ha fallado en la web. Prueba otra vez en un rato." }, 500);
    }
  },
};

// ---------------------------------------------------------------- utilidades

function json(obj, estado = 200, cabeceras = {}) {
  return new Response(JSON.stringify(obj), {
    status: estado,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...cabeceras,
    },
  });
}

async function resumen(texto) {
  const datos = new TextEncoder().encode(texto);
  const hash = await crypto.subtle.digest("SHA-256", datos);
  return [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * base64 estricto: sin saltos, con el relleno justo. Si no lo es, `null`.
 *
 * Con `Uint8Array.fromBase64` cuando el motor lo tiene (lo hace el propio
 * motor, sin bucle en JavaScript): el plan gratuito da 10 ms de CPU por
 * petición, y decodificar a mano 2 MB se los come varias veces.
 */
function base64Estricto(b64) {
  const limpio = String(b64).replace(/[\r\n]/g, "");
  if (limpio.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(limpio)) return null;
  try {
    return typeof Uint8Array.fromBase64 === "function" ? Uint8Array.fromBase64(limpio) : base64ABytes(limpio);
  } catch {
    return null;
  }
}

function base64ABytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlABytes(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  return base64ABytes(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
}

// ---------------------------------------------------------------- /api/version

/**
 * La última versión publicada, sacada del `latest.json` que lee la propia
 * app para actualizarse (lo deja `pipeline/publicar_version.py` en cada
 * versión del repositorio de descargas). Sus notas son
 * «motivo · datos del AAAA-MM-DD (N partidas) · commit abc1234».
 *
 * No es la API de GitHub a propósito: esa tiene un tope de peticiones por
 * dirección IP que se comparte con todo lo que corre en Cloudflare. Esto es
 * una descarga normal, y además se guarda diez minutos.
 */
async function apiVersion(request, ctx) {
  const cache = caches.default;
  const clave = new Request("https://ofidraft.com/__cache/version-v1");
  const guardada = await cache.match(clave);
  if (guardada) return guardada;

  const r = await fetch(LATEST_JSON, {
    redirect: "follow",
    headers: { "user-agent": "ofidraft.com", accept: "application/json" },
  });
  if (!r.ok) return json({ error: "github", estado: r.status }, 502, { "cache-control": "no-store" });
  const latest = await r.json();
  const respuesta = json(leerLatest(latest), 200, { "cache-control": "public, max-age=600" });
  ctx.waitUntil(cache.put(clave, respuesta.clone()));
  return respuesta;
}

function leerLatest(latest) {
  const notas = String(latest.notes || "");
  const fecha = /datos del (\d{4}-\d{2}-\d{2})/.exec(notas);
  const partidas = /\(([\d.]+) partidas\)/.exec(notas);
  return {
    version: String(latest.version || ""),
    publicada: String(latest.pub_date || ""),
    motivo: notas.split(" · ")[0] || "",
    datos: {
      fecha: fecha ? fecha[1] : null,
      partidas: partidas ? parseInt(partidas[1].replace(/\./g, ""), 10) : null,
    },
  };
}

// ---------------------------------------------------------------- /api/fallo

async function apiFallo(request, env, ctx) {
  if (request.method !== "POST") return json({ error: "metodo" }, 405, { allow: "POST" });
  if (!env.CORREO || !env.DESTINO) {
    return json({ ok: false, mensaje: "El formulario aún no está configurado. Escribe a contact@ofidraft.com." }, 503);
  }
  // Solo desde la propia web: un navegador manda siempre `Origin` en un POST.
  // No para a quien lo falsifique a mano, pero sí a las páginas de fuera.
  const origen = request.headers.get("origin");
  let mismoSitio = false;
  try {
    mismoSitio = !!origen && new URL(origen).host === new URL(request.url).host;
  } catch { /* origen roto: no es la web */ }
  if (!mismoSitio) return json({ ok: false, mensaje: "Envíalo desde ofidraft.com/fallo." }, 403);

  // El tamaño se cuenta leyendo, no fiándose del `content-length`: un envío
  // por trozos no lo trae.
  const crudo = await leerConTope(request, FALLO.cuerpoBytesMax);
  if (crudo === null) return json({ ok: false, mensaje: "Demasiado grande: como mucho dos adjuntos de 2 MB." }, 413);
  let d;
  try {
    d = JSON.parse(crudo);
  } catch {
    return json({ ok: false, mensaje: "No se ha entendido el envío." }, 400);
  }
  const error = validarFallo(d);
  if (error) return json({ ok: false, mensaje: error }, 400);

  // Los adjuntos, antes de contar el envío: uno roto es un 400, no un correo.
  const adjuntos = [];
  for (const a of d.adjuntos || []) {
    const ext = a.nombre.toLowerCase().split(".").pop();
    const bytes = base64Estricto(a.base64);
    if (!bytes) return json({ ok: false, mensaje: `«${limpiar(a.nombre, 80)}» no se ha podido leer.` }, 400);
    if (bytes.byteLength > FALLO.adjuntoBytesMax) return json({ ok: false, mensaje: `«${limpiar(a.nombre, 80)}» pasa de 2 MB.` }, 400);
    const tipo = TIPOS_ADJUNTO[ext];
    if (!esLoQueDice(bytes, tipo)) {
      return json({ ok: false, mensaje: `«${limpiar(a.nombre, 80)}» no es una imagen PNG o JPG ni un fichero de texto.` }, 400);
    }
    // El nombre, recortado sin perder la extensión.
    const base = a.nombre.slice(0, a.nombre.length - ext.length - 1).replace(/[^\w.\- ]+/g, "_").slice(0, 70);
    adjuntos.push({
      disposition: "attachment",
      filename: `${base || "adjunto"}.${ext}`,
      type: tipo,
      content: bytes,
    });
  }

  // La trampa y el reloj: un robot rellena el campo oculto o envía al instante.
  // Se le contesta que sí, para que no aprenda nada, y no se envía. Son datos
  // que manda el propio navegador: paran a los robots tontos, no a uno hecho
  // a mano para esta web (para ese está el límite de abajo).
  if (d.web || typeof d.ms !== "number" || d.ms < FALLO.msMin) return json({ ok: true });

  // Cinco por conexión cada diez minutos, contados en la caché de este centro
  // de datos con un resumen de la IP (no la IP). La caché no es atómica: varios
  // envíos a la vez pueden colarse. Si en Cloudflare se añade el limitador
  // `LIMITE_FALLO` (ver wrangler.jsonc), cuenta además ese.
  const ip = request.headers.get("cf-connecting-ip") || "sin-ip";
  const huella = await resumen(ip);
  if (env.LIMITE_FALLO) {
    const { success } = await env.LIMITE_FALLO.limit({ key: huella });
    if (!success) return json({ ok: false, mensaje: "Has enviado varios seguidos: espera unos minutos y vuelve a probar." }, 429);
  }
  const clave = new Request(`https://ofidraft.com/__limite/fallo/${huella}`);
  const cache = caches.default;
  const previa = await cache.match(clave);
  const n = previa ? parseInt(previa.headers.get("x-n") || "0", 10) : 0;
  if (n >= FALLO.porVentana) {
    return json({ ok: false, mensaje: "Has enviado varios seguidos: espera unos minutos y vuelve a probar." }, 429);
  }
  ctx.waitUntil(cache.put(clave, new Response("", { headers: { "x-n": String(n + 1), "cache-control": `max-age=${FALLO.ventanaS}` } })));

  const donde = DONDE.includes(d.donde) ? d.donde : "Otra cosa";
  // En el asunto, una sola línea y sin caracteres de control.
  const asunto = `[Fallo] ${donde}: ${limpiar(d.que, 70).replace(/\s+/g, " ")}`;
  const texto = [
    `Qué ha pasado:\n${limpiar(d.que, FALLO.queMax)}`,
    d.esperaba ? `Qué esperaba:\n${limpiar(d.esperaba, FALLO.campoMax)}` : "",
    `Dónde: ${donde}`,
    `Versión: ${limpiar(d.version, 40) || "no la ha dicho"}`,
    `Quién: ${limpiar(d.quien, FALLO.quienMax) || "no lo ha dicho"}`,
    `Navegador: ${limpiar(d.navegador, 200)}`,
    `País según Cloudflare: ${(request.cf && request.cf.country) || "?"}`,
    adjuntos.length ? `Adjuntos: ${adjuntos.map((a) => a.filename).join(", ")}` : "",
    "",
    "— Enviado desde ofidraft.com/fallo",
  ].filter(Boolean).join("\n\n");

  try {
    await env.CORREO.send({
      from: { name: "Web OFI Draft Tool", email: env.REMITENTE || "web@ofidraft.com" },
      to: env.DESTINO,
      subject: asunto,
      text: texto,
      ...(adjuntos.length ? { attachments: adjuntos } : {}),
    });
  } catch (e) {
    console.error("no se pudo enviar el correo", e && e.message ? e.message : String(e));
    return json({ ok: false, mensaje: "No se ha podido enviar ahora. Escribe a contact@ofidraft.com." }, 502);
  }
  return json({ ok: true }, 200, { "cache-control": "no-store" });
}

/** El cuerpo como texto, leído por trozos; `null` si pasa de `max` bytes. */
async function leerConTope(request, max) {
  if (!request.body) return "";
  const lector = request.body.getReader();
  const trozos = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await lector.cancel().catch(() => {});
      return null;
    }
    trozos.push(value);
  }
  const todo = new Uint8Array(total);
  let i = 0;
  for (const trozo of trozos) {
    todo.set(trozo, i);
    i += trozo.byteLength;
  }
  return new TextDecoder().decode(todo);
}

/**
 * El adjunto es lo que dice su extensión: un PNG empieza por su firma, un JPG
 * por FF D8 FF, y un texto no lleva bytes nulos y es UTF-8. Un ejecutable
 * renombrado a .png no pasa.
 */
function esLoQueDice(bytes, tipo) {
  if (tipo === "image/png") {
    const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length > firma.length && firma.every((b, i) => bytes[i] === b);
  }
  if (tipo === "image/jpeg") return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (tipo === "text/plain") {
    if (bytes.includes(0)) return false;
    // Un registro largo llega recortado por el principio (web.js manda el
    // final), y el corte puede caer en mitad de una letra: hasta tres bytes de
    // continuación al empezar no son un fichero roto.
    let i = 0;
    while (i < 3 && i < bytes.length && (bytes[i] & 0xc0) === 0x80) i++;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(i));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function limpiar(v, max) {
  // Fuera los caracteres de control salvo saltos de línea y tabuladores.
  return String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

function validarFallo(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return "No se ha entendido el envío.";
  for (const campo of ["que", "esperaba", "donde", "version", "quien", "navegador", "web"]) {
    if (d[campo] != null && typeof d[campo] !== "string") return "No se ha entendido el envío.";
  }
  const que = String(d.que ?? "").trim();
  if (que.length < FALLO.queMin) return "Cuenta un poco más qué ha pasado (al menos una frase).";
  if (que.length > FALLO.queMax) return `Qué ha pasado: como mucho ${FALLO.queMax} caracteres.`;
  for (const campo of ["esperaba", "donde", "version", "navegador"]) {
    if (String(d[campo] ?? "").length > FALLO.campoMax) return "Hay un campo demasiado largo.";
  }
  if (String(d.quien ?? "").length > FALLO.quienMax) return "El nick es demasiado largo.";
  const adjuntos = d.adjuntos ?? [];
  if (!Array.isArray(adjuntos)) return "Los adjuntos no se han entendido.";
  if (adjuntos.length > FALLO.adjuntosMax) return `Como mucho ${FALLO.adjuntosMax} adjuntos.`;
  for (const a of adjuntos) {
    if (!a || typeof a.nombre !== "string" || typeof a.base64 !== "string") return "Los adjuntos no se han entendido.";
    const ext = a.nombre.toLowerCase().split(".").pop();
    if (!TIPOS_ADJUNTO[ext]) return `«${limpiar(a.nombre, 80)}»: solo imágenes PNG o JPG y ficheros de texto o .log.`;
    // base64 ocupa 4/3 de lo que lleva dentro.
    if (a.base64.length * 0.75 > FALLO.adjuntoBytesMax + 4) return `«${limpiar(a.nombre, 80)}» pasa de 2 MB.`;
  }
  return null;
}

// ---------------------------------------------------------------- zona del equipo

/**
 * La zona del equipo la cierra Cloudflare Access: nadie llega aquí sin haber
 * entrado con un correo de la lista. Esto es la segunda puerta: comprueba la
 * firma del pase que pone Access (`Cf-Access-Jwt-Assertion`). Así, si algún
 * día la ruta quedara fuera de Access por un error de configuración, la zona
 * seguiría cerrada en vez de abierta.
 *
 * Mientras no estén puestos EQUIPO_DOMINIO y EQUIPO_AUD (el día que se
 * configure Access), la zona es solo una página de «lo que va a tener», sin
 * nada privado, y se sirve tal cual.
 */
async function zonaEquipo(request, env) {
  if (!env.EQUIPO_DOMINIO || !env.EQUIPO_AUD) return env.ASSETS.fetch(request);
  const pase = request.headers.get("cf-access-jwt-assertion");
  const correo = pase ? await comprobarPase(pase, env.EQUIPO_DOMINIO, env.EQUIPO_AUD) : null;
  if (!correo) {
    return new Response("Esta parte es solo para el equipo. Entra desde https://ofidraft.com/equipo/ con tu correo.", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const r = await env.ASSETS.fetch(request);
  const respuesta = new Response(r.body, r);
  respuesta.headers.set("cache-control", "private, no-store");
  return respuesta;
}

let llaves = { hasta: 0, pedidas: 0, porKid: {} };

/**
 * Las llaves públicas de Access, guardadas una hora. Con `forzar` (llega un
 * pase firmado con una llave que no tenemos: Access las ha rotado) se vuelven
 * a pedir, pero como mucho una vez por minuto, para que un pase inventado no
 * sirva para martillear a Cloudflare.
 */
async function llavesDeAccess(dominio, forzar = false) {
  const ahora = Date.now();
  if (ahora < llaves.hasta && !(forzar && ahora - llaves.pedidas > 60_000)) return llaves.porKid;
  const r = await fetch(`https://${dominio}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error(`certs ${r.status}`);
  const { keys } = await r.json();
  const porKid = {};
  for (const k of keys || []) {
    porKid[k.kid] = await crypto.subtle.importKey("jwk", k, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  }
  llaves = { hasta: Date.now() + 3600_000, pedidas: Date.now(), porKid };
  return porKid;
}

/** Devuelve el correo del pase si es bueno; si no, null. */
async function comprobarPase(pase, dominio, aud, ahora = Date.now()) {
  try {
    const [c, p, f] = pase.split(".");
    if (!c || !p || !f) return null;
    const cabecera = JSON.parse(new TextDecoder().decode(base64UrlABytes(c)));
    const cuerpo = JSON.parse(new TextDecoder().decode(base64UrlABytes(p)));
    if (cabecera.alg !== "RS256") return null;
    let llave = (await llavesDeAccess(dominio))[cabecera.kid];
    if (!llave) llave = (await llavesDeAccess(dominio, true))[cabecera.kid];
    if (!llave) return null;
    const bien = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", llave, base64UrlABytes(f), new TextEncoder().encode(`${c}.${p}`));
    if (!bien) return null;
    const auds = Array.isArray(cuerpo.aud) ? cuerpo.aud : [cuerpo.aud];
    if (!auds.includes(aud)) return null;
    if (cuerpo.iss !== `https://${dominio}`) return null;
    const s = Math.floor(ahora / 1000);
    if (typeof cuerpo.exp !== "number" || cuerpo.exp < s) return null;
    if (typeof cuerpo.nbf === "number" && cuerpo.nbf > s + 60) return null;
    return cuerpo.email || cuerpo.sub || "equipo";
  } catch {
    return null;
  }
}
