/**
 * «Lo que lleváis de verdad»: las builds de las partidas recientes de cada uno
 * del equipo (la otra mitad de las builds del equipo, con las propuestas).
 *
 * Solo de quien ha puesto su Riot ID en su perfil de la zona. De cada partida
 * se guarda lo que hace falta para la build: campeón, puesto, resultado, runas,
 * hechizos y objetos del final. Se guarda 30 días (`Zona.propias`), y lo de
 * otra clave de Riot no se reutiliza (los PUUID son por clave).
 */
import { numeroDe, pedir, reservar, servidores } from "./riot.js";
import { Invalido, PUESTOS, riotId as validarRiotId } from "./tipos.js";

const COLA_SOLO = 420;
const COLA_FLEX = 440;
const COLA_CLASH = 700;
export const PARTIDAS_PROPIAS = 12;
const POR_LLAMADA = 4;
const enc = encodeURIComponent;

/** De una partida, la build de UN jugador. */
function buildDe(partida, puuid) {
  const info = partida && partida.info;
  if (!info || !Array.isArray(info.participants)) return null;
  const p = info.participants.find((x) => x && x.puuid === puuid);
  if (!p) return null;
  const estilos = (p.perks && Array.isArray(p.perks.styles)) ? p.perks.styles : [];
  const principal = estilos.find((s) => s && s.description === "primaryStyle") || estilos[0];
  const secundaria = estilos.find((s) => s && s.description === "subStyle") || estilos[1];
  const sel = (s) => (s && Array.isArray(s.selections) ? s.selections.map((x) => x && x.perk).filter(Number.isInteger) : []);
  const frag = (p.perks && p.perks.statPerks) || {};
  return {
    campeon: p.championId,
    puesto: PUESTOS.includes(p.teamPosition) ? p.teamPosition : "",
    gano: !!p.win,
    cola: info.queueId,
    creada: info.gameCreation,
    remake: !!p.gameEndedInEarlySurrender || (info.gameDuration || 0) < 300,
    objetos: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].filter((x) => Number.isInteger(x) && x > 0),
    hechizos: [p.summoner1Id, p.summoner2Id].filter(Number.isInteger),
    runas: principal && secundaria ? {
      principal: principal.style,
      claves: sel(principal),
      secundaria: secundaria.style,
      secundarias: sel(secundaria),
      fragmentos: [frag.offense, frag.flex, frag.defense].filter(Number.isInteger),
    } : null,
  };
}

/**
 * Las partidas recientes de un miembro (por su nick), por pasos como el
 * scouting: cada llamada baja unas pocas; `quedan` dice cuántas faltan.
 */
export async function partidasDe(c, nick) {
  const miembro = await c.z.miembroPorNick(nick);
  if (!miembro) throw new Invalido("Ese nick no es de nadie del equipo.");
  if (!miembro.riotId) return { sinRiotId: true, partidas: [], quedan: 0 };
  const { nombre, etiqueta } = validarRiotId(miembro.riotId);
  const { region } = servidores(c.env);

  const claveCuenta = `${c.fp}:cuenta:${miembro.riotId.toLowerCase()}`;
  let puuid = (await c.z.propia(claveCuenta))?.puuid;
  if (!puuid) {
    await reservar(c.z, 1);
    const cuenta = await pedir(c, region, `/riot/account/v1/accounts/by-riot-id/${enc(nombre)}/${enc(etiqueta)}`);
    if (!cuenta) throw new Invalido(`El Riot ID de ${miembro.nick} (${miembro.riotId}) no existe: que lo corrija en su perfil.`);
    puuid = cuenta.puuid;
    await c.z.guardarPropias([[claveCuenta, { puuid }]]);
  }

  const claveIds = `${c.fp}:ids:${puuid}`;
  let ids = (await c.z.propia(claveIds, 6 * 3600 * 1000))?.ids;
  if (!ids) {
    await reservar(c.z, 3);
    const listas = await Promise.all([COLA_SOLO, COLA_FLEX, COLA_CLASH].map((cola) =>
      pedir(c, region, `/lol/match/v5/matches/by-puuid/${enc(puuid)}/ids`, { queue: cola, count: PARTIDAS_PROPIAS })));
    ids = [...new Set(listas.flatMap((l) => l || []))]
      .filter((id) => typeof id === "string" && /^[A-Z0-9]+_\d+$/.test(id))
      .sort((a, b) => numeroDe(b) - numeroDe(a))
      .slice(0, PARTIDAS_PROPIAS);
    await c.z.guardarPropias([[claveIds, { ids }]]);
  }

  const claveDe = (id) => `${c.fp}:partida:${id}:${puuid}`;
  const hechas = await c.z.propiasVarias(ids.map(claveDe));
  const faltan = ids.filter((id) => !hechas[claveDe(id)]);
  const ahora = faltan.slice(0, POR_LLAMADA);
  if (ahora.length) {
    await reservar(c.z, ahora.length);
    const bajadas = await Promise.all(ahora.map((id) => pedir(c, region, `/lol/match/v5/matches/${enc(id)}`)));
    const nuevas = ahora.map((id, i) => [claveDe(id), buildDe(bajadas[i], puuid) || { vacia: true }]);
    for (const [k, v] of nuevas) hechas[k] = v;
    await c.z.guardarPropias(nuevas);
  }
  return {
    nick: miembro.nick,
    partidas: ids.map((id) => hechas[claveDe(id)]).filter((p) => p && !p.vacia),
    quedan: faltan.length - ahora.length,
  };
}
