/**
 * OFI Draft Tool — el pequeño servidor de ofidraft.com.
 *
 * Casi toda la web son ficheros estáticos (`public/`) que Cloudflare sirve
 * sin pasar por aquí. Por este fichero solo pasan las rutas de
 * `run_worker_first` en `wrangler.jsonc`:
 *
 *   /api/version           → la última versión y de cuándo son sus datos.
 *   /api/fallo             → el formulario de fallos, ideas y drafts mal leídos, por correo.
 *   /datos/*               → los datos para la app (todavía no hay).
 *   /descargar/instalador  → el instalador, con la contraseña del equipo
 *                            (desde el 2026-10-15; antes era una redirección
 *                            de `public/_redirects` directa a GitHub).
 *
 * La zona del equipo (/equipo, con Cloudflare Access, un Durable Object y la
 * clave de Riot en el servidor) se quitó el 2026-10-20: el análisis de las
 * partidas va en la app de escritorio. Su código sigue en la historia de git
 * del repositorio de descargas (la última versión que lo lleva: 7b6b1a5).
 *
 * Sin dependencias: lo que hace falta (leer un JWT, codificar base64) está
 * escrito aquí con lo que trae el propio Worker.
 */
import { json, leerConTope, limpiar, mismoSitio, resumen } from "./util.js";

const REPO_DESCARGAS = "OFI-Dovahkiin/ofi-draft-tool-descargas";
const LATEST_JSON = `https://github.com/${REPO_DESCARGAS}/releases/latest/download/latest.json`;
const INSTALADOR = `https://github.com/${REPO_DESCARGAS}/releases/latest/download/OFI-Draft-Tool-instalador.exe`;

// La descarga con contraseña (ver `descargarInstalador`).
const DESCARGA = {
  // El formulario solo manda `clave=…`: con 2 KB sobra.
  cuerpoBytesMax: 2048,
  claveMax: 200,
  // Intentos por conexión cada diez minutos, bien o mal: frena a quien prueba
  // contraseñas y deja de sobra para el equipo.
  porVentana: 10,
  ventanaS: 600,
};

// El formulario de fallos: lo que se acepta.
const FALLO = {
  // El cuerpo entero, leído por trozos: dos adjuntos de 2 MB en base64 y el texto.
  cuerpoBytesMax: 6 * 1024 * 1024,
  draftMin: 20,
  draftMax: 4000,
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
// Lo que se cuenta: un fallo, una idea o un draft en el que el motor se
// equivoca. Va delante en el asunto para poder filtrarlo en el correo.
const TIPOS = { fallo: "Fallo", idea: "Idea", motor: "Draft" };
const DONDE = [
  "Tablero de champ select", "Armería (runas, items, hechizos)", "Análisis de draft", "Equipo", "Jugadores",
  "Tier list", "Fichas de campeón", "Historial", "En partida (overlay)", "Centro de mando o ajustes",
  "Instalar o actualizar", "La web", "Otra cosa",
  // La etiqueta de antes del 18-10 (decía «objetos»): se sigue aceptando.
  "Armería (runas, objetos, hechizos)",
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const ruta = url.pathname;
    try {
      if (ruta === "/api/version") return await apiVersion(request, ctx);
      if (ruta === "/api/fallo") return await apiFallo(request, env, ctx);
      if (ruta.startsWith("/api/")) return json({ error: "no-existe" }, 404);
      if (ruta.startsWith("/datos/")) return json({ error: "todavia-no" }, 404);
      if (ruta === "/descargar/instalador" || ruta === "/descargar/instalador.exe") {
        return await descargarInstalador(request, env, ctx);
      }
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error("fallo interno", ruta, e && e.stack ? e.stack : String(e));
      return json({ error: "interno", mensaje: "Algo ha fallado en la web. Prueba otra vez en un rato." }, 500);
    }
  },
};

// ---------------------------------------------------------------- utilidades

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

// ------------------------------------------------------- /descargar/instalador

/**
 * **El instalador, con la contraseña del equipo** (2026-10-15).
 *
 * Ese día entró mucha gente a la web, y la app es del equipo. La página de
 * Descargar pide la contraseña en un formulario normal (sin JavaScript) que
 * llega aquí:
 *
 *   - GET (un enlace viejo, el de Discord) → a la página, que la pide.
 *   - POST con `clave` → si es la del secreto `DESCARGA_CLAVE`, el instalador.
 *     Lo trae este servidor de GitHub y lo sirve como descarga de
 *     ofidraft.com, así que la página no enseña el enlace de GitHub.
 *   - Si no lo es, o se pasa de intentos, o falta el secreto, de vuelta a la
 *     página con el aviso que toca (`#clave-incorrecta`…, que el CSS enseña
 *     con `:target`, también sin JavaScript).
 *
 * **Sin el secreto, cerrado**: no se baja nada. La contraseña no va en el
 * código, que está en un repositorio público.
 *
 * **Lo que NO cierra:** el instalador sigue en el repositorio público de
 * descargas, y quien tenga el enlace directo de GitHub lo baja sin
 * contraseña. Cerrarlo del todo es hacer privado ese repositorio, y eso pide
 * cambiar antes de dónde se actualiza la app (`latest.json`).
 */
async function descargarInstalador(request, env, ctx) {
  const pagina = (aviso) => Response.redirect(new URL(`/descargar/${aviso ? "#" + aviso : ""}`, request.url).toString(), 303);
  if (request.method !== "POST") return pagina("");
  if (!mismoSitio(request)) return pagina("clave-incorrecta");

  // Intentos por conexión, contados como en el formulario de fallos: en la
  // caché de este centro de datos y con un resumen de la IP, no la IP.
  const ip = request.headers.get("cf-connecting-ip") || "sin-ip";
  const huella = await resumen(ip);
  const claveCache = new Request(`https://ofidraft.com/__limite/descarga/${huella}`);
  const cache = caches.default;
  const previa = await cache.match(claveCache);
  const n = previa ? parseInt(previa.headers.get("x-n") || "0", 10) : 0;
  if (n >= DESCARGA.porVentana) return pagina("demasiados-intentos");
  ctx.waitUntil(cache.put(claveCache, new Response("", { headers: { "x-n": String(n + 1), "cache-control": `max-age=${DESCARGA.ventanaS}` } })));

  const buena = typeof env.DESCARGA_CLAVE === "string" ? env.DESCARGA_CLAVE.trim() : "";
  if (!buena) return pagina("descarga-cerrada");

  const cuerpo = await leerConTope(request, DESCARGA.cuerpoBytesMax);
  if (cuerpo === null) return pagina("clave-incorrecta");
  const dada = (new URLSearchParams(cuerpo).get("clave") || "").trim().slice(0, DESCARGA.claveMax);
  if (!(await mismaClave(dada, buena))) return pagina("clave-incorrecta");

  const r = await fetch(INSTALADOR, { redirect: "follow", headers: { "user-agent": "ofidraft.com" } });
  if (!r.ok || !r.body) {
    console.error("descarga: GitHub no ha dado el instalador", r.status);
    return pagina("descarga-fallida");
  }
  const cabeceras = new Headers({
    "content-type": "application/octet-stream",
    "content-disposition": 'attachment; filename="OFI-Draft-Tool-instalador.exe"',
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  const largo = r.headers.get("content-length");
  if (largo) cabeceras.set("content-length", largo);
  return new Response(r.body, { status: 200, headers: cabeceras });
}

/**
 * Compara la contraseña sin dar pistas por el tiempo que tarda: se comparan
 * los dos resúmenes SHA-256 (siempre 32 bytes) con `timingSafeEqual`.
 */
async function mismaClave(dada, buena) {
  const cod = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", cod.encode(dada)),
    crypto.subtle.digest("SHA-256", cod.encode(buena)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
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
  if (!mismoSitio(request)) return json({ ok: false, mensaje: "Envíalo desde ofidraft.com/fallo." }, 403);

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

  const tipo = TIPOS[d.tipo] ? d.tipo : "fallo";
  const donde = DONDE.includes(d.donde) ? d.donde : "Otra cosa";
  // En el asunto, una sola línea y sin caracteres de control.
  const asunto = `[${TIPOS[tipo]}] ${tipo === "motor" ? "" : donde + ": "}${limpiar(d.que, 70).replace(/\s+/g, " ")}`;
  const texto = [
    tipo === "motor" ? `El draft:\n${limpiar(d.draft, FALLO.draftMax)}` : "",
    `${tipo === "idea" ? "La idea" : tipo === "motor" ? "Qué está mal" : "Qué ha pasado"}:\n${limpiar(d.que, FALLO.queMax)}`,
    tipo === "fallo" && d.esperaba ? `Qué esperaba:\n${limpiar(d.esperaba, FALLO.campoMax)}` : "",
    tipo === "motor" ? "" : `Dónde: ${donde}`,
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

function validarFallo(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return "No se ha entendido el envío.";
  for (const campo of ["tipo", "que", "draft", "esperaba", "donde", "version", "quien", "navegador", "web"]) {
    if (d[campo] != null && typeof d[campo] !== "string") return "No se ha entendido el envío.";
  }
  const que = String(d.que ?? "").trim();
  if (que.length < FALLO.queMin) return "Cuéntalo un poco más (al menos una frase).";
  if (que.length > FALLO.queMax) return `Qué ha pasado: como mucho ${FALLO.queMax} caracteres.`;
  for (const campo of ["esperaba", "donde", "version", "navegador"]) {
    if (String(d[campo] ?? "").length > FALLO.campoMax) return "Hay un campo demasiado largo.";
  }
  if (String(d.quien ?? "").length > FALLO.quienMax) return "El nick es demasiado largo.";
  if (d.tipo != null && !TIPOS[d.tipo]) return "No se ha entendido el envío.";
  const draft = String(d.draft ?? "").trim();
  if (draft.length > FALLO.draftMax) return `El draft: como mucho ${FALLO.draftMax} caracteres.`;
  if (d.tipo === "motor" && draft.length < FALLO.draftMin) return "Pega el draft: la «Hoja de Clash» o los diez campeones.";
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
