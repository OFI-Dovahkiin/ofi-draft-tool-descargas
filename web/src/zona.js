/**
 * La zona del equipo: ofidraft.com/equipo/.
 *
 * **Dos puertas.** La primera es Cloudflare Access: nadie llega aquí sin haber
 * entrado con un correo de la lista y el código que le llega. La segunda está
 * aquí: se comprueba la firma del pase que pone Access
 * (`Cf-Access-Jwt-Assertion`). Así, si algún día la ruta quedara fuera de
 * Access por un error de configuración, la zona seguiría cerrada.
 *
 * Mientras no estén puestos los secretos EQUIPO_DOMINIO y EQUIPO_AUD (hasta
 * que se configure Access), /equipo/ lleva a /zona/, la página pública que
 * cuenta qué hay dentro.
 *
 * Las páginas de la zona son ficheros de `public/equipo/` (están en el
 * repositorio público, así que no llevan nada del equipo: son el esqueleto).
 * Lo del equipo vive en el almacén (`almacen.js`) y llega por /equipo/api/.
 */
import { zona } from "./almacen.js";
import { partidasDe } from "./propias.js";
import { buscarCinco, buscarEquipo, ClaveRiot, clashDelDia, EsperaRiot, huellaClave, scoutearJugador } from "./riot.js";
import { Invalido } from "./tipos.js";
import { esLocal, json, leerConTope, mismoSitio } from "./util.js";

const CUERPO_MAX = 128 * 1024;

// Lo que pueden cargar las páginas de la zona: lo de esta web y, de Data
// Dragon (el servidor de Riot), los nombres y los iconos de campeones,
// objetos, runas y hechizos.
const DDRAGON = "https://ddragon.leagueoflegends.com";
const CSP_ZONA = [
  "default-src 'self'",
  `img-src 'self' data: ${DDRAGON}`,
  "style-src 'self'",
  "script-src 'self'",
  `connect-src 'self' ${DDRAGON}`,
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function cabecerasZona(h) {
  h.set("content-security-policy", CSP_ZONA);
  h.set("x-robots-tag", "noindex, nofollow");
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "same-origin");
  h.set("x-frame-options", "DENY");
  h.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
}

function configurada(env) {
  return !!(env.EQUIPO_DOMINIO && env.EQUIPO_AUD && env.ZONA);
}

/** Para la página pública /zona/: si ya se puede entrar. */
export const zonaAbierta = configurada;

/** Lo de dentro de la secreta, bien escrito aunque se pegue con https:// o una barra al final. */
function dominioDeAccess(env) {
  return String(env.EQUIPO_DOMINIO).trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function admins(env) {
  return String(env.EQUIPO_ADMINS || "").toLowerCase().split(/[\s,;]+/).filter(Boolean);
}

export async function zonaEquipo(request, env) {
  const url = new URL(request.url);
  const api = url.pathname.startsWith("/equipo/api/");
  if (!configurada(env)) {
    if (api) return json({ ok: false, mensaje: "La zona del equipo aún no está abierta." }, 503);
    return Response.redirect(new URL("/zona/", url).toString(), 302);
  }
  const correo = await quienEntra(request, env);
  if (!correo) {
    if (api) return json({ ok: false, sinPase: true, mensaje: "Tu sesión ha caducado: recarga la página para volver a entrar." }, 401);
    return sinPase();
  }
  const yo = { correo, admin: admins(env).includes(correo), local: esLocal(request) };
  if (api) return apiZona(request, env, yo, url);
  return paginaZona(request, env);
}

/** Las páginas: los ficheros de public/equipo/, con las cabeceras de la zona y sin guardarse en ningún sitio. */
async function paginaZona(request, env) {
  const r = await env.ASSETS.fetch(request);
  const respuesta = new Response(r.body, r);
  cabecerasZona(respuesta.headers);
  respuesta.headers.set("cache-control", "private, no-store");
  return respuesta;
}

function sinPase() {
  const h = new Headers({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  cabecerasZona(h);
  return new Response(
    `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Solo para el equipo · OFI Draft Tool</title><link rel="stylesheet" href="/assets/estilo.css">
<main class="documento"><div class="envoltura"><h1>Solo para el equipo</h1>
<p>Esta parte de la web es solo para el equipo OFI. Entra desde <a href="/equipo/">ofidraft.com/equipo</a> con tu correo: te llega un código para entrar.</p>
<p>¿Eres del equipo y no te deja? Pídele a Álvaro que añada tu correo. Y si quieres saber qué hay dentro, mira <a href="/zona/">la zona del equipo</a>.</p>
</div></main></html>`,
    { status: 403, headers: h },
  );
}

// ---------------------------------------------------------------- el pase de Access

/** El correo de quien entra, si el pase de Access es bueno; si no, null. */
async function quienEntra(request, env) {
  // En ofidraft.com, el pase lo pone Access en esta cabecera después de
  // comprobar su cookie. En las pruebas en el propio ordenador no hay Access
  // delante, y el pase puede venir en la misma cookie que pondría Access.
  const pase = request.headers.get("cf-access-jwt-assertion") || (esLocal(request) ? cookie(request, "CF_Authorization") : null);
  if (!pase) return null;
  const dominio = dominioDeAccess(env);
  // En las pruebas en el propio ordenador, y solo ahí, las llaves pueden venir
  // de un servidor de mentira: así se prueba esta misma comprobación entera.
  const certs = esLocal(request) && env.EQUIPO_CERTS_PRUEBAS
    ? env.EQUIPO_CERTS_PRUEBAS
    : `https://${dominio}/cdn-cgi/access/certs`;
  const correo = await comprobarPase(pase, dominio, String(env.EQUIPO_AUD).trim(), certs);
  return correo ? correo.toLowerCase() : null;
}

function cookie(request, nombre) {
  for (const parte of (request.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nombre) return v.join("=");
  }
  return null;
}

let llaves = { de: "", hasta: 0, pedidas: 0, porKid: {} };

/**
 * Las llaves públicas de Access, guardadas una hora. Con `forzar` (llega un
 * pase firmado con una llave que no tenemos: Access las ha rotado) se vuelven
 * a pedir, pero como mucho una vez por minuto, para que un pase inventado no
 * sirva para martillear a Cloudflare.
 */
async function llavesDeAccess(certs, forzar = false) {
  const ahora = Date.now();
  const frescas = llaves.de === certs && ahora < llaves.hasta;
  if (frescas && !(forzar && ahora - llaves.pedidas > 60_000)) return llaves.porKid;
  const r = await fetch(certs);
  if (!r.ok) throw new Error(`certs ${r.status}`);
  const { keys } = await r.json();
  const porKid = {};
  for (const k of keys || []) {
    if (k.kty !== "RSA") continue;
    porKid[k.kid] = await crypto.subtle.importKey("jwk", k, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  }
  llaves = { de: certs, hasta: Date.now() + 3600_000, pedidas: Date.now(), porKid };
  return porKid;
}

function base64UrlABytes(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Devuelve el correo del pase si es bueno; si no, null. */
export async function comprobarPase(pase, dominio, aud, certs, ahora = Date.now()) {
  try {
    const [c, p, f] = pase.split(".");
    if (!c || !p || !f) return null;
    const cabecera = JSON.parse(new TextDecoder().decode(base64UrlABytes(c)));
    const cuerpo = JSON.parse(new TextDecoder().decode(base64UrlABytes(p)));
    if (cabecera.alg !== "RS256" || typeof cabecera.kid !== "string") return null;
    let llave = (await llavesDeAccess(certs))[cabecera.kid];
    if (!llave) llave = (await llavesDeAccess(certs, true))[cabecera.kid];
    if (!llave) return null;
    const bien = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", llave, base64UrlABytes(f), new TextEncoder().encode(`${c}.${p}`));
    if (!bien) return null;
    const auds = Array.isArray(cuerpo.aud) ? cuerpo.aud : [cuerpo.aud];
    if (!auds.includes(aud)) return null;
    if (cuerpo.iss !== `https://${dominio}`) return null;
    const s = Math.floor(ahora / 1000);
    if (typeof cuerpo.exp !== "number" || cuerpo.exp < s) return null;
    if (typeof cuerpo.nbf === "number" && cuerpo.nbf > s + 60) return null;
    // Solo personas: un pase sin correo (un token de servicio) no entra.
    if (typeof cuerpo.email !== "string" || !cuerpo.email.includes("@")) return null;
    return cuerpo.email;
  } catch (e) {
    console.error("pase de Access", e && e.message ? e.message : String(e));
    return null;
  }
}

// ---------------------------------------------------------------- la API

function responder(r) {
  if (r.ok) return json(r);
  return json({ ok: false, mensaje: r.error }, r.estado || 400);
}

const NOMBRE_EXPORTACION = {
  build: ["builds_equipo.json", "builds"],
  apunte: ["apuntes_matchup.json", "apuntes"],
  draft: ["drafts_mal_leidos.json", "drafts"],
};

async function apiZona(request, env, yo, url) {
  const z = zona(env);
  const partes = url.pathname.slice("/equipo/api/".length).split("/").filter(Boolean);
  const metodo = request.method;
  let d = null;

  if (metodo === "POST") {
    // Solo desde las páginas de la zona: un navegador manda siempre `Origin`.
    if (!mismoSitio(request)) return json({ ok: false, mensaje: "Envíalo desde ofidraft.com/equipo." }, 403);
    if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
      return json({ ok: false, mensaje: "No se ha entendido el envío." }, 415);
    }
    const crudo = await leerConTope(request, CUERPO_MAX);
    if (crudo === null) return json({ ok: false, mensaje: "Es demasiado largo." }, 413);
    try {
      d = JSON.parse(crudo || "{}");
    } catch {
      return json({ ok: false, mensaje: "No se ha entendido el envío." }, 400);
    }
    if (!d || typeof d !== "object" || Array.isArray(d)) return json({ ok: false, mensaje: "No se ha entendido el envío." }, 400);
  } else if (metodo !== "GET") {
    return json({ ok: false, mensaje: "No se ha entendido el envío." }, 405, { allow: "GET, POST" });
  }

  const ruta = `${metodo} ${partes.map((x) => (/^\d+$/.test(x) ? ":id" : x)).join("/")}`;
  const id = partes.find((x) => /^\d+$/.test(x));
  const num = id ? Number(id) : null;

  try {
    switch (ruta) {
      case "GET yo": {
        const m = await z.entrar(yo.correo);
        return json({
          ok: true,
          ...m,
          admin: yo.admin,
          nuevo: !m.nick,
          riot: !!env.RIOT_KEY,
          resumen: await z.resumen(env.RIOT_KEY ? await huellaClave(env.RIOT_KEY) : ""),
        });
      }
      case "POST yo":
        return responder(await z.guardarPerfil(yo.correo, d));
      case "GET miembros":
        return json({ ok: true, ...(await z.miembros(yo.admin)) });
      case "POST miembros/borrar":
        return responder(await z.borrarMiembro(yo.admin, typeof d.email === "string" ? d.email.toLowerCase() : null));
      case "GET cosas":
        return responder(await z.listar(url.searchParams.get("tipo") || "", yo.correo, yo.admin));
      case "POST cosas":
        return responder(await z.crear(d.tipo, yo.correo, yo.admin, d.datos, d.padre ?? null));
      case "POST cosas/:id":
        return responder(await z.editar(num, yo.correo, yo.admin, d.datos));
      case "POST cosas/:id/voto":
        return responder(await z.votar(num, yo.correo, yo.admin, d.si === true));
      case "POST cosas/:id/estado":
        return responder(await z.cambiarEstado(num, yo.correo, yo.admin, d));
      case "POST cosas/:id/borrar":
        return responder(await z.borrar(num, yo.correo, yo.admin));
      case "GET cosas/:id/comentarios":
        return responder(await z.comentarios(num, yo.correo, yo.admin));
      case "GET exportar/build":
      case "GET exportar/apunte":
      case "GET exportar/draft": {
        if (!yo.admin) return json({ ok: false, mensaje: "Esto solo lo puede hacer un capitán." }, 403);
        const tipo = partes[1];
        const r = await z.exportar(tipo);
        if (!r.ok) return responder(r);
        const [fichero, clave] = NOMBRE_EXPORTACION[tipo];
        const cuerpo = {
          formato: `ofi-${clave}-equipo`,
          version: 1,
          exportado: new Date().toISOString(),
          nota: "Los campeones, objetos, runas y hechizos van por su número de Riot (el de Data Dragon).",
          [clave]: r.filas,
        };
        return new Response(JSON.stringify(cuerpo, null, 2), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "content-disposition": `attachment; filename="${fichero}"`,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      }
      case "GET scouting/recientes":
        if (!env.RIOT_KEY) return json({ ok: true, equipos: [] });
        return json({ ok: true, ...(await z.recientes(await huellaClave(env.RIOT_KEY))) });
      case "POST scouting/equipo":
      case "POST scouting/a-mano":
      case "POST scouting/guardado":
      case "POST scouting/jugador":
      case "POST riot/clash-del-dia":
      case "POST riot/propias": {
        if (!env.RIOT_KEY) {
          return json({ ok: false, sinClave: true, mensaje: "Falta la clave de Riot en Cloudflare (el secreto RIOT_KEY). Pídeselo a Álvaro." }, 503);
        }
        const c = { env, z, local: yo.local, fp: await huellaClave(env.RIOT_KEY) };
        if (ruta === "POST scouting/equipo") return json({ ok: true, ...(await buscarEquipo(c, d.riotId)) });
        if (ruta === "POST scouting/a-mano") return json({ ok: true, ...(await buscarCinco(c, d.riotIds)) });
        if (ruta === "POST scouting/guardado") {
          // Un equipo mirado estos días, tal cual se guardó (sin preguntar a Riot).
          const idEq = typeof d.id === "string" && /^[\w-]{1,80}$/.test(d.id) ? d.id : null;
          const eq = idEq ? await z.cache(`${c.fp}:equipo:${idEq}`) : null;
          if (!eq) return json({ ok: false, mensaje: "Ya no está: lo del rival se borra a los siete días." }, 404);
          return json({ ok: true, equipo: eq.datos, guardado: eq.guardado });
        }
        if (ruta === "POST scouting/jugador") return json({ ok: true, ...(await scoutearJugador(c, d.puuid)) });
        if (ruta === "POST riot/propias") return json({ ok: true, ...(await partidasDe(c, d.nick)) });
        return json({ ok: true, ...(await clashDelDia(c, await z.riotIdDe(yo.correo), d.fecha)) });
      }
      default:
        return json({ ok: false, mensaje: "No existe." }, 404);
    }
  } catch (e) {
    if (e instanceof Invalido) return json({ ok: false, mensaje: e.message }, 400);
    if (e instanceof EsperaRiot) {
      return json({ ok: false, esperaMs: e.ms, mensaje: `Riot nos deja pocas consultas seguidas: seguimos en ${Math.ceil(e.ms / 1000)} s.` }, 429);
    }
    if (e instanceof ClaveRiot) {
      return json({ ok: false, sinClave: true, mensaje: "La clave de Riot no vale (caducada o mal copiada). Álvaro tiene que poner una nueva en Cloudflare." }, 503);
    }
    throw e;
  }
}
