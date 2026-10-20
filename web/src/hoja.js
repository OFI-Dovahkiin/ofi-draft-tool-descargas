/**
 * **La hoja de repaso automática** de una partida, desde el punto de vista de
 * quien la pide: lo que dicen los datos de Riot (Match-V5 y su timeline)
 * sin que nadie tenga que ver el replay.
 *
 * Qué saca, y de dónde (todo medido el 19-10-2026 sobre 417 partidas reales
 * del parche 26.x; `claude/INVESTIGACION_REPLAYS_2026-10-19.md`):
 *
 * - **La línea a los 10 y a los 15**: oro, XP y CS de cada uno contra el rival
 *   de su mismo puesto (`teamPosition`), de las fotos de cada minuto.
 * - **Cada muerte del equipo**: minuto, zona del mapa, quién mató, si fue
 *   **aislada** (ninguna otra kill a menos de 2.500 unidades en ±15 s), si fue
 *   **cara** (el rival coge un objetivo en los 90 s siguientes), el shutdown
 *   entregado y el oro sin gastar en la foto anterior.
 * - **Las teamfights**: kills a menos de 15 s unas de otras, de tres en adelante.
 * - **Los puntos de inflexión**: los tres tramos de dos minutos en que más se
 *   movió la diferencia de oro del equipo, con lo que pasó en ellos.
 * - **Los objetivos**, de quién y cuándo.
 * - **Candidatos a clip**, con la ventana para grabarlos del replay
 *   (−15 s / +5 s). Casi todos son épicos, no graciosos: lo gracioso de verdad
 *   no deja rastro en los datos, así que el grupo elige.
 * - **Rarezas** de la partida entera (de `challenges` y los pings).
 *
 * **Lo que NO lleva, a propósito:** ni un nombre, ni un PUUID, ni el número de
 * la partida (con él, cualquiera con una clave de Riot sacaría los diez
 * nombres). Solo campeones (su número de Riot), puestos y de qué equipo son.
 * Tampoco ningún consejo «haz esto»: la hoja dice qué pasó y el porqué lo pone
 * el equipo en el repaso. Nada de MMR ni de notas.
 *
 * **Lo que no puede saber:** dónde estaban las wards (la API no da su
 * posición), dónde estaba cada uno entre una foto y la siguiente (una por
 * minuto), cuándo se usó el Flash o cada habilidad, ni el estado de las waves.
 *
 * Es una función pura (sin red ni almacén) para poder probarla entera:
 * `pruebas_zona/probar_hoja.mjs` la pasa por partidas reales.
 */

export const VERSION_HOJA = 1;

/** Las ventanas y umbrales, a la vista. Son juicios, no medidas: se cambian aquí. */
export const UMBRALES = Object.freeze({
  peleaHuecoMs: 15000, // kills a menos de esto, la misma pelea
  peleaMinKills: 3,
  aisladaRadio: 2500, // unidades del mapa (el mapa mide ~14.800)
  aisladaMs: 15000,
  caraMs: 90000, // objetivo del rival después de la muerte
  inflexionVentana: 2, // minutos
  inflexiones: 3,
  clipAntesMs: 15000,
  clipDespuesMs: 5000,
  diveTorre: 0.4, // parte del daño recibido que viene de una torre
  oneshot: 0.8, // parte del daño de UNA habilidad de UN campeón
  shutdownGordo: 700,
  killTempranaMs: 120000,
  oroSinGastar: 1300, // lo que cuesta una pieza de item grande, más o menos
  pingsDesaparecido: 25,
  muertesEnLista: 40,
});

const PUESTOS = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
const EPICOS = new Set(["DRAGON", "BARON_NASHOR", "RIFTHERALD", "HORDE", "ATAKHAN"]);

const ent = (x) => (Number.isFinite(x) ? Math.round(x) : 0);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const dano = (d) => (d.physicalDamage || 0) + (d.magicDamage || 0) + (d.trueDamage || 0);

/**
 * La zona del mapa, gruesa a propósito: la posición de una kill es exacta,
 * pero «río» o «jungla» son franjas, no paredes. Coordenadas de la Grieta:
 * la base azul abajo a la izquierda (0,0) y la roja arriba a la derecha.
 */
export function zonaDe(p, equipo) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return "";
  const { x, y } = p;
  const nuestra = equipo === 100 ? "azul" : "roja";
  if (x < 4300 && y < 4300) return nuestra === "azul" ? "nuestra base" : "su base";
  if (x > 10500 && y > 10500) return nuestra === "roja" ? "nuestra base" : "su base";
  if (Math.abs(x - y) < 1800) return "mid";
  if (y > 12300 || x < 2300) return "top";
  if (x > 12500 || y < 2300) return "bot";
  if (Math.abs(x + y - 14800) < 1600) return "río";
  const ladoAzul = x + y < 14800;
  return (ladoAzul === (equipo === 100)) ? "nuestra jungla" : "su jungla";
}

/** De quién es un objetivo. En `BUILDING_KILL` y en las placas, `teamId` es el equipo que lo PIERDE (medido: 100 %). */
function ganador(e) {
  if (e.type === "BUILDING_KILL" || e.type === "TURRET_PLATE_DESTROYED") return e.teamId === 100 ? 200 : e.teamId === 200 ? 100 : 0;
  return e.killerTeamId || 0;
}

function tipoObjetivo(e) {
  if (e.type === "BUILDING_KILL") {
    if (e.buildingType === "INHIBITOR_BUILDING") return "inhibidor";
    const t = { OUTER_TURRET: "torre exterior", INNER_TURRET: "torre interior", BASE_TURRET: "torre de base", NEXUS_TURRET: "torre del nexo" }[e.towerType];
    return t || "torre";
  }
  if (e.monsterType === "DRAGON") {
    const sub = String(e.monsterSubType || "").replace(/_DRAGON$/, "");
    // Como se dice (`GLOSARIO_DE_LOL_EN_CASTELLANO.md`): dragón, Barón, Heraldo, larvas, Ancestral.
    return sub === "ELDER" ? "dragón Ancestral" : `dragón ${{ FIRE: "infernal", WATER: "de océano", EARTH: "de montaña", AIR: "de nube", HEXTECH: "hextech", CHEMTECH: "chemtech" }[sub] || ""}`.trim();
  }
  return { BARON_NASHOR: "Barón", RIFTHERALD: "Heraldo", HORDE: "larvas", ATAKHAN: "Atakhan" }[e.monsterType] || "";
}

/**
 * La hoja. `puuid` es el de quien la pide: decide cuál es «nuestro» equipo.
 * Devuelve `null` si la partida no es de la Grieta o no trae lo necesario.
 */
export function hojaDeRepaso(match, timeline, puuid) {
  const info = match && match.info;
  const tl = timeline && timeline.info;
  if (!info || !Array.isArray(info.participants) || !tl || !Array.isArray(tl.frames) || !tl.frames.length) return null;
  if (info.mapId != null && info.mapId !== 11) return null;
  const yo = info.participants.find((p) => p && p.puuid === puuid);
  if (!yo) return null;
  const U = UMBRALES;
  const nuestro = yo.teamId;
  const rival = nuestro === 100 ? 200 : 100;

  // participantId del timeline → participante. Riot numera igual a los diez en
  // el detalle y en el timeline (1-5 azul, 6-10 rojo), así que se casa por
  // participantId. Solo si el detalle no lo trae se casa por PUUID (que es por
  // clave de Riot: con dos claves distintas no casaría).
  const porId = new Map();
  for (const p of info.participants) if (p && Number.isInteger(p.participantId)) porId.set(p.participantId, p);
  if (porId.size < info.participants.length && Array.isArray(tl.participants)) {
    for (const t of tl.participants) {
      const p = info.participants.find((x) => x.puuid === t.puuid);
      if (p && !porId.has(t.participantId)) porId.set(t.participantId, p);
    }
  }
  const equipoDe = (pid) => (porId.get(pid) ? porId.get(pid).teamId : 0);
  const campeonDe = (pid) => (porId.get(pid) ? porId.get(pid).championId | 0 : 0);
  const puestoDe = (pid) => {
    const p = porId.get(pid);
    return p && PUESTOS.includes(p.teamPosition) ? p.teamPosition : "";
  };
  const pids = [...porId.keys()];
  const nuestrosPid = pids.filter((pid) => equipoDe(pid) === nuestro);

  const frames = tl.frames;
  const foto = (ms) => frames[Math.min(Math.max(Math.round(ms / 60000), 0), frames.length - 1)];
  const fotoAntes = (ms) => frames[Math.min(Math.max(Math.floor(ms / 60000), 0), frames.length - 1)];

  // Un solo recorrido por los eventos.
  const kills = [];
  const objetivos = [];
  const especiales = [];
  for (const f of frames) {
    for (const e of f.events || []) {
      if (e.type === "CHAMPION_KILL") kills.push(e);
      else if (e.type === "BUILDING_KILL" || (e.type === "ELITE_MONSTER_KILL" && EPICOS.has(e.monsterType))) objetivos.push(e);
      else if (e.type === "CHAMPION_SPECIAL_KILL") especiales.push(e);
    }
  }

  // 1. La línea a los 10 y a los 15.
  const linea = [];
  for (const puesto of PUESTOS) {
    const a = pids.find((pid) => equipoDe(pid) === nuestro && puestoDe(pid) === puesto);
    const b = pids.find((pid) => equipoDe(pid) === rival && puestoDe(pid) === puesto);
    if (!a || !b) continue;
    const fila = { puesto, nuestro: campeonDe(a), suyo: campeonDe(b) };
    for (const min of [10, 15]) {
      const fa = frames[min] && frames[min].participantFrames && frames[min].participantFrames[String(a)];
      const fb = frames[min] && frames[min].participantFrames && frames[min].participantFrames[String(b)];
      fila[`a${min}`] = fa && fb ? {
        oro: ent(fa.totalGold - fb.totalGold),
        xp: ent(fa.xp - fb.xp),
        cs: ent((fa.minionsKilled + fa.jungleMinionsKilled) - (fb.minionsKilled + fb.jungleMinionsKilled)),
      } : null;
    }
    linea.push(fila);
  }

  // 2. Los objetivos.
  const listaObjetivos = objetivos
    .map((e) => ({ t: ent(e.timestamp), tipo: tipoObjetivo(e), nuestro: ganador(e) === nuestro, deNadie: ganador(e) === 0 }))
    .filter((o) => o.tipo && !o.deNadie)
    .map(({ deNadie, ...o }) => o);
  const objetivosRivalesTras = (ms) => listaObjetivos.filter((o) => !o.nuestro && o.t >= ms && o.t - ms <= U.caraMs);

  // 3. Las muertes del equipo.
  const muertes = [];
  for (const k of kills) {
    if (equipoDe(k.victimId) !== nuestro) continue;
    const cerca = kills.some((o) => o !== k && Math.abs(o.timestamp - k.timestamp) <= U.aisladaMs
      && o.position && k.position && dist(o.position, k.position) <= U.aisladaRadio);
    const pf = fotoAntes(k.timestamp).participantFrames || {};
    const suyo = pf[String(k.victimId)];
    muertes.push({
      t: ent(k.timestamp),
      campeon: campeonDe(k.victimId),
      puesto: puestoDe(k.victimId),
      zona: zonaDe(k.position, nuestro),
      asesino: k.killerId ? campeonDe(k.killerId) : 0,
      aislada: !cerca,
      cara: objetivosRivalesTras(k.timestamp).map((o) => o.tipo),
      shutdown: ent(k.shutdownBounty),
      oro: suyo ? ent(suyo.currentGold) : null,
    });
  }

  // 4. Las teamfights.
  const peleas = [];
  let actual = [];
  const cerrar = () => {
    if (actual.length >= U.peleaMinKills) {
      const fin = actual[actual.length - 1].timestamp;
      const cx = actual.reduce((s, k) => s + (k.position ? k.position.x : 0), 0) / actual.length;
      const cy = actual.reduce((s, k) => s + (k.position ? k.position.y : 0), 0) / actual.length;
      peleas.push({
        t: ent(actual[0].timestamp),
        aFavor: actual.filter((k) => equipoDe(k.victimId) === rival).length,
        enContra: actual.filter((k) => equipoDe(k.victimId) === nuestro).length,
        zona: zonaDe({ x: cx, y: cy }, nuestro),
        despues: listaObjetivos.filter((o) => o.t >= fin && o.t - fin <= U.caraMs).map((o) => ({ tipo: o.tipo, nuestro: o.nuestro })),
      });
    }
    actual = [];
  };
  for (const k of kills) {
    if (actual.length && k.timestamp - actual[actual.length - 1].timestamp > U.peleaHuecoMs) cerrar();
    actual.push(k);
  }
  cerrar();

  // 5. La diferencia de oro minuto a minuto y los puntos de inflexión.
  const oro = frames.map((f) => {
    const pf = f.participantFrames || {};
    let d = 0;
    for (const pid of pids) {
      const x = pf[String(pid)];
      if (x) d += (equipoDe(pid) === nuestro ? 1 : -1) * (x.totalGold || 0);
    }
    return ent(d);
  });
  const V = U.inflexionVentana;
  const saltos = [];
  for (let i = V; i < oro.length; i++) saltos.push({ i, delta: oro[i] - oro[i - V] });
  saltos.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const inflexiones = [];
  for (const s of saltos) {
    if (inflexiones.length >= U.inflexiones) break;
    if (!s.delta || inflexiones.some((x) => Math.abs(x.hasta - s.i) < V + 1)) continue;
    const desde = (s.i - V) * 60000;
    const hasta = s.i * 60000;
    const enTramo = (t) => t >= desde && t <= hasta;
    const ks = kills.filter((k) => enTramo(k.timestamp));
    inflexiones.push({
      desde: s.i - V,
      hasta: s.i,
      oro: s.delta,
      aFavor: ks.filter((k) => equipoDe(k.victimId) === rival).length,
      enContra: ks.filter((k) => equipoDe(k.victimId) === nuestro).length,
      objetivos: listaObjetivos.filter((o) => enTramo(o.t)).map((o) => ({ tipo: o.tipo, nuestro: o.nuestro })),
    });
  }
  inflexiones.sort((a, b) => a.desde - b.desde);

  // 6. Candidatos a clip.
  const clips = [];
  const clip = (tipo, ms, quien, otro = 0, dato = null, esNuestro = equipoDe(quien) === nuestro) => {
    clips.push({ tipo, t: ent(ms), desde: Math.max(0, ent(ms - U.clipAntesMs)), hasta: ent(ms + U.clipDespuesMs), quien: campeonDe(quien), otro, nuestro: esNuestro, dato });
  };
  for (const k of kills) {
    const recibido = Array.isArray(k.victimDamageReceived) ? k.victimDamageReceived : [];
    const total = recibido.reduce((s, d) => s + dano(d), 0);
    const torre = recibido.filter((d) => d.type === "TOWER").reduce((s, d) => s + dano(d), 0);
    if (!k.killerId) clip("execute", k.timestamp, k.victimId);
    else if (total && torre / total >= U.diveTorre) clip("dive", k.timestamp, k.victimId, campeonDe(k.killerId), Math.round((100 * torre) / total));
    if (k.timestamp < U.killTempranaMs) clip("temprana", k.timestamp, k.victimId, k.killerId ? campeonDe(k.killerId) : 0);
    if ((k.shutdownBounty || 0) >= U.shutdownGordo) clip("shutdown", k.timestamp, k.victimId, k.killerId ? campeonDe(k.killerId) : 0, ent(k.shutdownBounty));
    const porHab = new Map();
    for (const d of recibido) {
      if (d.type !== "OTHER" || !d.spellName || /basicattack/i.test(d.spellName)) continue;
      const c = `${d.participantId}|${d.spellName}|${d.spellSlot}`;
      porHab.set(c, (porHab.get(c) || 0) + dano(d));
    }
    let mejor = null;
    for (const [c, v] of porHab) if (!mejor || v > mejor[1]) mejor = [c, v];
    if (total && mejor && mejor[1] / total >= U.oneshot) {
      const [pid, , slot] = mejor[0].split("|");
      const tecla = { 0: "Q", 1: "W", 2: "E", 3: "R" }[slot] || "";
      clip("oneshot", k.timestamp, k.victimId, campeonDe(Number(pid)), tecla);
    }
  }
  for (const e of especiales) {
    if (e.killType === "KILL_MULTI" && (e.multiKillLength || 0) >= 3) clip("multikill", e.timestamp, e.killerId, 0, Math.min(e.multiKillLength, 5));
    if (e.killType === "KILL_ACE") clip("ace", e.timestamp, e.killerId);
  }
  // Robos: `challenges.epicMonsterSteals` dice CUÁNTOS, no cuáles. De los
  // objetivos que mató ese jugador, los N con más rivales que aliados cerca en
  // la foto más cercana (puede tener hasta 30 s de retraso: es una pista).
  for (const pid of pids) {
    const p = porId.get(pid);
    const n = (p.challenges && p.challenges.epicMonsterSteals) | 0;
    if (!n) continue;
    const suyos = objetivos.filter((e) => e.type === "ELITE_MONSTER_KILL" && e.killerId === pid && e.position);
    const presion = (e) => {
      const pf = foto(e.timestamp).participantFrames || {};
      let s = 0;
      for (const q of pids) {
        const x = pf[String(q)];
        if (x && x.position && dist(x.position, e.position) <= 3500) s += equipoDe(q) === p.teamId ? -1 : 1;
      }
      return s;
    };
    suyos.map((e) => ({ e, s: presion(e) })).sort((a, b) => b.s - a.s).slice(0, n)
      .forEach(({ e }) => clip("robo", e.timestamp, pid, 0, tipoObjetivo(e)));
  }
  clips.sort((a, b) => a.t - b.t);

  // 7. Rarezas de la partida entera.
  const rarezas = [];
  for (const pid of pids) {
    const p = porId.get(pid);
    const c = p.challenges || {};
    const mas = (tipo, veces) => { if (veces) rarezas.push({ tipo, quien: p.championId | 0, nuestro: p.teamId === nuestro, veces: ent(veces) }); };
    mas("un_digito", c.survivedSingleDigitHpCount);
    mas("aguanta_a_cinco", c.killedChampTookFullTeamDamageSurvived);
    mas("multikill_una_habilidad", c.multiKillOneSpell);
    mas("robo_sin_smite", c.epicMonsterStolenWithoutSmite);
    if ((c.outnumberedKills | 0) >= 2) mas("en_inferioridad", c.outnumberedKills);
    if ((p.enemyMissingPings | 0) >= U.pingsDesaparecido) mas("pings_desaparecido", p.enemyMissingPings);
  }

  const version = String(info.gameVersion || "").split(".").slice(0, 2).join(".");
  return {
    v: VERSION_HOJA,
    parche: version,
    duracion: ent(info.gameDuration),
    gano: !!yo.win,
    lado: nuestro === 100 ? "azul" : "rojo",
    remake: !!yo.gameEndedInEarlySurrender || (info.gameDuration || 0) < 300,
    nuestros: nuestrosPid.length,
    linea,
    muertes: {
      total: muertes.length,
      aisladas: muertes.filter((m) => m.aislada).length,
      caras: muertes.filter((m) => m.cara.length).length,
      antesDel15: muertes.filter((m) => m.t < 15 * 60000).length,
      lista: muertes.slice(0, U.muertesEnLista),
    },
    peleas,
    inflexiones,
    oro,
    objetivos: listaObjetivos,
    clips,
    rarezas,
  };
}
