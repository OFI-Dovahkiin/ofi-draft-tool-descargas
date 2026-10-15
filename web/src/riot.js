/**
 * Lo que la zona del equipo le pregunta a la API de Riot: el scouting del
 * rival de Clash y las partidas de Clash de un día (para el repaso).
 *
 * **Las normas de Riot que se cumplen aquí, y por qué:**
 *
 * - La clave es la de Álvaro, como secreto de Cloudflare (`RIOT_KEY`): nunca
 *   llega al navegador ni está en el repositorio. Una clave personal vale
 *   para «un producto para el desarrollador o una comunidad pequeña y
 *   privada» (developer.riotgames.com/docs/portal): la zona está cerrada al
 *   equipo con Access.
 * - El rival de Clash no está escondido: el propio cliente enseña sus nombres
 *   en el cuadro del torneo. Nada de esto se usa en el champ select ni sale de
 *   la página de scouting (REGLA 7 de la app).
 * - Lo del rival se borra solo a los siete días (`almacen.js`).
 * - Cada número sale con su muestra: «3 de 5», nunca un porcentaje suelto
 *   (REGLA 9 de la app). Nada de calcular el elo o el MMR de nadie.
 * - Se respetan los límites de la clave (`Zona.riotPermiso`) y el «espera» de
 *   Riot (429), que se le pasa al navegador para que lo reintente él.
 */
import { fecha as validarFecha, Invalido, riotId as validarRiotId, PUESTOS } from "./tipos.js";

// Partidas que se miran de cada rival (las más nuevas de SoloQ y de Clash) y
// cuántas se bajan en cada llamada: el plan gratuito da 10 ms de CPU por
// petición, y cada partida es un JSON grande que hay que leer entero.
export const PARTIDAS_POR_JUGADOR = 10;
const PARTIDAS_POR_LLAMADA = 4;
const COLA_SOLO = 420;
const COLA_FLEX = 440;
const COLA_CLASH = 700;
const ORDEN = Object.fromEntries(PUESTOS.map((p, i) => [p, i]));

export class EsperaRiot extends Error {
  constructor(ms) {
    super("Riot pide esperar");
    this.ms = ms;
  }
}
export class ClaveRiot extends Error {}

/**
 * **La huella de la clave**, delante de todo lo que se guarda del scouting.
 * Riot cifra los PUUID con cada clave: con una clave nueva, los de la vieja ya
 * no valen. Así lo guardado con otra clave no se vuelve a usar (y se borra
 * solo a los siete días, como todo lo del rival).
 */
export async function huellaClave(clave) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ofi:${clave || ""}`));
  return [...new Uint8Array(h)].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function servidores(env) {
  return {
    plataforma: String(env.RIOT_PLATAFORMA || "euw1").toLowerCase(),
    region: String(env.RIOT_REGION || "europe").toLowerCase(),
  };
}

/**
 * Pide permiso al presupuesto común antes de gastar `n` peticiones.
 * Las esperas cortas (el límite por segundo) se esperan aquí, sin molestar a
 * la página; las largas (el de dos minutos, o un «espera» de Riot) se le
 * pasan a la página con un 429 para que cuente los segundos.
 */
export async function reservar(z, n) {
  let p = await z.riotPermiso(n);
  for (let i = 0; !p.ok && p.esperaMs <= 1500 && i < 3; i++) {
    await new Promise((r) => setTimeout(r, p.esperaMs));
    p = await z.riotPermiso(n);
  }
  if (!p.ok) throw new EsperaRiot(p.esperaMs);
}

/**
 * Una petición a Riot. `null` si Riot dice que no existe (404).
 * En las pruebas en el propio ordenador (`local`), y solo ahí, puede ir a un
 * servidor de mentira (`RIOT_BASE_PRUEBAS`).
 */
export async function pedir(c, host, ruta, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const camino = `${ruta}${qs ? `?${qs}` : ""}`;
  const url = c.local && c.env.RIOT_BASE_PRUEBAS
    ? `${c.env.RIOT_BASE_PRUEBAS}/${host}${camino}`
    : `https://${host}.api.riotgames.com${camino}`;
  const r = await fetch(url, { headers: { "X-Riot-Token": c.env.RIOT_KEY, accept: "application/json" } });
  if (r.status === 404) return null;
  if (r.status === 429) {
    const s = Math.min(Math.max(Number(r.headers.get("retry-after")) || 10, 1), 300);
    await c.z.riotParar(s * 1000);
    throw new EsperaRiot(s * 1000);
  }
  if (r.status === 401 || r.status === 403) throw new ClaveRiot("La clave de Riot no vale");
  // Un PUUID de otra clave, por ejemplo: Riot contesta 400.
  if (r.status === 400) throw new Invalido("Riot no ha entendido la consulta (puede que la clave de Riot haya cambiado). Vuelve a buscar el equipo.");
  if (!r.ok) throw new Error(`Riot ${r.status} en ${ruta.split("/").slice(0, 5).join("/")}`);
  return r.json();
}

const enc = encodeURIComponent;

function validarPuuid(v) {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{40,100}$/.test(v)) throw new Invalido("Jugador: no se ha entendido.");
  return v;
}

function textoRiotId(cuenta) {
  return cuenta && cuenta.gameName ? `${cuenta.gameName}#${cuenta.tagLine}` : "";
}

// ---------------------------------------------------------------- scouting

/**
 * Del Riot ID de cualquiera del equipo rival, su equipo de Clash entero.
 * Si no está apuntado a ningún Clash ahora mismo, `{ noEnClash: true }`: la
 * página deja entonces escribir los cinco a mano.
 */
export async function buscarEquipo(c, texto) {
  const { nombre, etiqueta } = validarRiotId(texto);
  const { plataforma, region } = servidores(c.env);
  const claveDe = `${c.fp}:equipo-de:${`${nombre}#${etiqueta}`.toLowerCase()}`;
  const visto = await c.z.cache(claveDe, 6 * 3600 * 1000);
  if (visto) {
    const eq = await c.z.cache(`${c.fp}:equipo:${visto.datos.equipo}`);
    if (eq) return { equipo: eq.datos, guardado: eq.guardado };
  }

  // La cuenta y su inscripción; luego su equipo y las cuentas de los demás.
  await reservar(c.z, 2);
  const cuenta = await pedir(c, region, `/riot/account/v1/accounts/by-riot-id/${enc(nombre)}/${enc(etiqueta)}`);
  if (!cuenta) throw new Invalido(`No hay ninguna cuenta ${nombre}#${etiqueta}. Mira que esté bien escrito, con su etiqueta.`);
  const inscripciones = (await pedir(c, plataforma, `/lol/clash/v1/players/by-puuid/${enc(cuenta.puuid)}`)) || [];
  const inscrito = inscripciones.find((p) => p && p.teamId);
  if (!inscrito) return { noEnClash: true, riotId: textoRiotId(cuenta) };
  await reservar(c.z, 1);
  const equipo = await pedir(c, plataforma, `/lol/clash/v1/teams/${enc(inscrito.teamId)}`);
  if (!equipo || !Array.isArray(equipo.players)) return { noEnClash: true, riotId: textoRiotId(cuenta) };

  const miembros = equipo.players.slice(0, 7).filter((p) => p && typeof p.puuid === "string");
  await reservar(c.z, miembros.filter((p) => p.puuid !== cuenta.puuid).length);
  const jugadores = [];
  for (const p of miembros) {
    const cta = p.puuid === cuenta.puuid ? cuenta : await pedir(c, region, `/riot/account/v1/accounts/by-puuid/${enc(p.puuid)}`);
    jugadores.push({
      puuid: p.puuid,
      riotId: textoRiotId(cta),
      puesto: PUESTOS.includes(p.position) ? p.position : "",
      capitan: p.role === "CAPTAIN",
    });
  }
  jugadores.sort((a, b) => (ORDEN[a.puesto] ?? 9) - (ORDEN[b.puesto] ?? 9));
  const datos = {
    id: String(equipo.id),
    nombre: String(equipo.name || ""),
    abreviatura: String(equipo.abbreviation || ""),
    nivel: Number.isInteger(equipo.tier) ? equipo.tier : null,
    jugadores,
  };
  await c.z.guardarCache([[`${c.fp}:equipo:${datos.id}`, datos], [claveDe, { equipo: datos.id }]]);
  return { equipo: datos, guardado: Date.now() };
}

/** Sin Clash: los Riot ID escritos a mano (hasta cinco), como en la app. */
export async function buscarCinco(c, textos) {
  if (!Array.isArray(textos) || !textos.length || textos.length > 5) throw new Invalido("Escribe de uno a cinco Riot ID.");
  const ids = textos.map((t, i) => validarRiotId(t, `Riot ID ${i + 1}`));
  const { region } = servidores(c.env);
  await reservar(c.z, ids.length);
  const jugadores = [];
  const faltan = [];
  for (const { nombre, etiqueta } of ids) {
    const cta = await pedir(c, region, `/riot/account/v1/accounts/by-riot-id/${enc(nombre)}/${enc(etiqueta)}`);
    if (cta) jugadores.push({ puuid: cta.puuid, riotId: textoRiotId(cta), puesto: "", capitan: false });
    else faltan.push(`${nombre}#${etiqueta}`);
  }
  if (!jugadores.length) throw new Invalido(`No encuentro ninguna de esas cuentas: ${faltan.join(", ")}.`);
  const firma = jugadores.map((j) => j.puuid).sort().join("|");
  const huella = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(firma)))]
    .slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
  const datos = { id: `a-mano-${huella}`, nombre: "", abreviatura: "", nivel: null, aMano: true, jugadores };
  await c.z.guardarCache([[`${c.fp}:equipo:${datos.id}`, datos]]);
  return { equipo: datos, guardado: Date.now(), faltan };
}

/** Lo de una partida que importa para el scouting de UN jugador. */
function lineaDe(partida, puuid) {
  const info = partida && partida.info;
  if (!info || !Array.isArray(info.participants)) return null;
  const p = info.participants.find((x) => x && x.puuid === puuid);
  if (!p) return null;
  return {
    campeon: p.championId,
    puesto: PUESTOS.includes(p.teamPosition) ? p.teamPosition : "",
    gano: !!p.win,
    k: p.kills | 0,
    d: p.deaths | 0,
    a: p.assists | 0,
    cola: info.queueId,
    creada: info.gameCreation,
    // Las rendiciones de los primeros minutos (remake) no cuentan para nada.
    remake: !!p.gameEndedInEarlySurrender || (info.gameDuration || 0) < 300,
  };
}

/** El número de partida, para ordenar de la más nueva a la más vieja. */
export function numeroDe(id) {
  const m = /_(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

/**
 * Un jugador del rival, por pasos: la primera llamada trae su rango, su
 * maestría y qué partidas mirar; cada una de las siguientes baja unas pocas.
 * `quedan` dice cuántas faltan: la página llama otra vez hasta que es 0.
 */
export async function scoutearJugador(c, puuidTexto) {
  const puuid = validarPuuid(puuidTexto);
  const { plataforma, region } = servidores(c.env);
  const clave = `${c.fp}:jugador:${puuid}`;
  let perfil = (await c.z.cache(clave, 6 * 3600 * 1000))?.datos;
  if (!perfil) {
    await reservar(c.z, 4);
    const [rangos, maestria, solo, clash] = await Promise.all([
      pedir(c, plataforma, `/lol/league/v4/entries/by-puuid/${enc(puuid)}`),
      pedir(c, plataforma, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${enc(puuid)}/top`, { count: 8 }),
      pedir(c, region, `/lol/match/v5/matches/by-puuid/${enc(puuid)}/ids`, { queue: COLA_SOLO, count: 15 }),
      pedir(c, region, `/lol/match/v5/matches/by-puuid/${enc(puuid)}/ids`, { queue: COLA_CLASH, count: 10 }),
    ]);
    const ids = [...new Set([...(solo || []), ...(clash || [])])]
      .filter((id) => typeof id === "string" && /^[A-Z0-9]+_\d+$/.test(id))
      .sort((a, b) => numeroDe(b) - numeroDe(a))
      .slice(0, PARTIDAS_POR_JUGADOR);
    perfil = {
      rangos: (rangos || [])
        .filter((r) => r && (r.queueType === "RANKED_SOLO_5x5" || r.queueType === "RANKED_FLEX_SR"))
        .map((r) => ({ cola: r.queueType, tier: r.tier, division: r.rank, lp: r.leaguePoints, victorias: r.wins, derrotas: r.losses })),
      maestria: (maestria || []).map((m) => ({ campeon: m.championId, puntos: m.championPoints, nivel: m.championLevel, ultima: m.lastPlayTime })),
      ids,
    };
    await c.z.guardarCache([[clave, perfil]]);
  }

  const claveDe = (id) => `${c.fp}:partida:${id}:${puuid}`;
  const hechas = await c.z.caches(perfil.ids.map(claveDe));
  const faltan = perfil.ids.filter((id) => !hechas[claveDe(id)]);
  const ahora = faltan.slice(0, PARTIDAS_POR_LLAMADA);
  if (ahora.length) {
    await reservar(c.z, ahora.length);
    const bajadas = await Promise.all(ahora.map((id) => pedir(c, region, `/lol/match/v5/matches/${enc(id)}`)));
    const nuevas = ahora.map((id, i) => [claveDe(id), lineaDe(bajadas[i], puuid) || { vacia: true }]);
    for (const [k, v] of nuevas) hechas[k] = v;
    await c.z.guardarCache(nuevas);
  }
  return {
    rangos: perfil.rangos,
    maestria: perfil.maestria,
    partidas: perfil.ids.map((id) => hechas[claveDe(id)]).filter((p) => p && !p.vacia),
    quedan: faltan.length - ahora.length,
  };
}

// ---------------------------------------------------------------- repaso

/** Las 00:00 de ese día en Madrid, en milisegundos. */
function inicioDelDia(fecha) {
  const mediodia = new Date(`${fecha}T12:00:00Z`);
  const hora = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" }).format(mediodia));
  return Date.parse(`${fecha}T00:00:00Z`) - (hora - 12) * 3600_000;
}

/**
 * Las partidas de Clash de un día, con el Riot ID del perfil de quien lo
 * pide: los diez campeones con su puesto, de qué lado y quién ganó. Para
 * rellenar el repaso sin escribirlo a mano. Sin nombres de nadie.
 */
export async function clashDelDia(c, riotIdTexto, fechaTexto) {
  if (!riotIdTexto) throw new Invalido("Pon tu Riot ID en tu perfil (arriba, en «Tu perfil») y vuelve a probar.");
  const dia = validarFecha(fechaTexto, "Día");
  const { nombre, etiqueta } = validarRiotId(riotIdTexto, "Tu Riot ID");
  const { region } = servidores(c.env);
  const desde = inicioDelDia(dia);
  await reservar(c.z, 2);
  const cuenta = await pedir(c, region, `/riot/account/v1/accounts/by-riot-id/${enc(nombre)}/${enc(etiqueta)}`);
  if (!cuenta) throw new Invalido(`Tu Riot ID (${nombre}#${etiqueta}) no existe: corrígelo en tu perfil.`);
  const ids = ((await pedir(c, region, `/lol/match/v5/matches/by-puuid/${enc(cuenta.puuid)}/ids`, {
    queue: COLA_CLASH, startTime: Math.floor(desde / 1000), endTime: Math.floor((desde + 24 * 3600_000) / 1000), count: 10,
  })) || []).filter((id) => typeof id === "string").slice(0, 4);
  if (!ids.length) return { partidas: [] };
  await reservar(c.z, ids.length);
  const bajadas = await Promise.all(ids.map((id) => pedir(c, region, `/lol/match/v5/matches/${enc(id)}`)));
  const partidas = [];
  bajadas.forEach((m) => {
    const info = m && m.info;
    const yo = info && Array.isArray(info.participants) && info.participants.find((x) => x && x.puuid === cuenta.puuid);
    if (!yo) return;
    const fila = (x) => ({ campeon: x.championId, puesto: PUESTOS.includes(x.teamPosition) ? x.teamPosition : "" });
    const porPuesto = (a, b) => (ORDEN[a.puesto] ?? 9) - (ORDEN[b.puesto] ?? 9);
    // Sin el número de la partida: con él, cualquiera con una clave de Riot
    // sacaría los diez nombres.
    partidas.push({
      creada: info.gameCreation,
      lado: yo.teamId === 100 ? "azul" : "rojo",
      gano: !!yo.win,
      duracion: info.gameDuration | 0,
      nuestros: info.participants.filter((x) => x.teamId === yo.teamId).map(fila).sort(porPuesto),
      suyos: info.participants.filter((x) => x.teamId !== yo.teamId).map(fila).sort(porPuesto),
    });
  });
  partidas.sort((a, b) => a.creada - b.creada);
  return { partidas };
}

export { COLA_SOLO, COLA_FLEX, COLA_CLASH };
