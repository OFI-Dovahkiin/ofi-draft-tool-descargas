/**
 * Lo que se guarda en la zona del equipo y lo que vale en cada cosa.
 *
 * Todo lo que escribe alguien del equipo (una idea, una build, un apunte, el
 * plan del Clash, un repaso, un comentario) se guarda igual: una fila con su
 * tipo, su autor y sus datos. Aquí está, por tipo, qué datos se aceptan, qué
 * estados tiene y quién puede hacer qué. El Worker lo comprueba antes de
 * guardar nada; el almacén (`almacen.js`) solo guarda lo que ya pasó por aquí.
 *
 * Los campeones, objetos, runas y hechizos van por su número de Riot (el
 * mismo de Data Dragon y de la app), nunca por el nombre: los nombres cambian
 * con el idioma y con los reworks, los números no.
 */

export const PUESTOS = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
export const NOMBRE_PUESTO = { TOP: "Top", JUNGLE: "Jungla", MIDDLE: "Mid", BOTTOM: "ADC", UTILITY: "Support" };

// Las mismas opciones de «Dónde» que el formulario público (index.js).
export const DONDE = [
  "Tablero de champ select", "Armería (runas, items, hechizos)", "Análisis de draft", "Equipo", "Jugadores",
  "Tier list", "Fichas de campeón", "Historial", "En partida (overlay)", "Centro de mando o ajustes",
  "Instalar o actualizar", "La web", "Otra cosa",
  // La etiqueta de antes del 18-10 (decía «objetos»): se sigue aceptando,
  // que hay cosas guardadas con ella.
  "Armería (runas, objetos, hechizos)",
];

export class Invalido extends Error {}

function falla(mensaje) {
  throw new Invalido(mensaje);
}

/** Texto: sin caracteres de control (salvo saltos de línea), recortado a los lados y con su largo. */
// Caracteres que no se ven: de anchura cero y de control de dirección (el
// RLO, por ejemplo, da la vuelta al texto que va detrás). Con ellos, «Ana» y
// «Ana» + uno invisible serían dos nicks distintos que se ven iguales.
const INVISIBLES = /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

export function texto(v, nombre, min, max) {
  if (v == null) v = "";
  if (typeof v !== "string") falla(`${nombre}: no se ha entendido.`);
  const t = v.normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(INVISIBLES, "").trim();
  if (t.length < min) falla(min <= 1 ? `${nombre}: falta.` : `${nombre}: al menos ${min} caracteres.`);
  if (t.length > max) falla(`${nombre}: como mucho ${max} caracteres.`);
  return t;
}

/** Una sola línea: los saltos se vuelven espacios. */
function linea(v, nombre, min, max) {
  return texto(typeof v === "string" ? v.replace(/\s+/g, " ") : v, nombre, min, max);
}

function entero(v, nombre, min, max) {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) falla(`${nombre}: no se ha entendido.`);
  return v;
}

function enteroONulo(v, nombre, min, max) {
  return v == null ? null : entero(v, nombre, min, max);
}

function uno(v, nombre, opciones) {
  if (!opciones.includes(v)) falla(`${nombre}: no se ha entendido.`);
  return v;
}

function lista(v, nombre, max, cada) {
  if (v == null) return [];
  if (!Array.isArray(v)) falla(`${nombre}: no se ha entendido.`);
  if (v.length > max) falla(`${nombre}: como mucho ${max}.`);
  return v.map((x, i) => cada(x, i));
}

function objeto(v, nombre) {
  if (!v || typeof v !== "object" || Array.isArray(v)) falla(`${nombre}: no se ha entendido.`);
  return v;
}

/** AAAA-MM-DD y que exista ese día. */
export function fecha(v, nombre) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) falla(`${nombre}: elige el día.`);
  const d = new Date(`${v}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) falla(`${nombre}: ese día no existe.`);
  const anio = Number(v.slice(0, 4));
  if (anio < 2020 || anio > 2100) falla(`${nombre}: ese día no vale.`);
  return v;
}

/**
 * Un Riot ID: «Nombre#TAG». El nombre, de 3 a 16 caracteres; la etiqueta, de
 * 3 a 5 letras o números (lo que deja Riot). Devuelve `{ nombre, etiqueta }`.
 */
export function riotId(v, nombre = "Riot ID") {
  const t = linea(v, nombre, 0, 40);
  const m = /^([^#]{3,16})#([\p{L}\p{N}]{3,5})$/u.exec(t);
  if (!m) falla(`${nombre}: escríbelo como Nombre#TAG (con la almohadilla y la etiqueta).`);
  return { nombre: m[1].trim(), etiqueta: m[2] };
}

const campeon = (v, n = "Campeón") => entero(v, n, 1, 99999);
const objetoId = (v, n = "Item") => entero(v, n, 1000, 999999);
const runaId = (v, n = "Runa") => entero(v, n, 8000, 9999);
const arbol = (v, n = "Rama") => entero(v, n, 8000, 8999);
// Los fragmentos (las tres filas de abajo de la página de runas). Hoy son
// 5001, 5005, 5007, 5008, 5010, 5011 y 5013; se acepta el bloque entero por si
// Riot añade alguno.
const fragmento = (v, n = "Fragmento") => entero(v, n, 5000, 5999);
const hechizo = (v, n = "Hechizo") => entero(v, n, 1, 99);

function runas(v) {
  if (v == null) return null;
  const r = objeto(v, "Runas");
  const principal = arbol(r.principal, "Rama principal");
  const secundaria = arbol(r.secundaria, "Rama secundaria");
  if (principal === secundaria) falla("Runas: la rama secundaria tiene que ser otra.");
  const claves = lista(r.claves, "Runas principales", 4, (x) => runaId(x));
  const secundarias = lista(r.secundarias, "Runas secundarias", 2, (x) => runaId(x));
  const fragmentos = lista(r.fragmentos, "Fragmentos", 3, (x) => fragmento(x));
  if (claves.length !== 4) falla("Runas: elige la clave y una runa de cada fila de la rama principal.");
  if (secundarias.length !== 2) falla("Runas: elige dos runas de la rama secundaria.");
  if (fragmentos.length !== 3) falla("Runas: elige los tres fragmentos.");
  if (new Set([...claves, ...secundarias]).size !== 6) falla("Runas: hay una runa repetida.");
  return { principal, claves, secundaria, secundarias, fragmentos };
}

/** La referencia de una partida (20 cifras hexadecimales, `riot.js` → `referenciaDe`). */
function referencia(v, nombre) {
  if (typeof v !== "string" || !/^[a-f0-9]{20}$/.test(v)) falla(`${nombre}: no se ha entendido.`);
  return v;
}

/** Un enlace https (el vídeo de un repaso). */
function enlace(v, nombre) {
  const t = linea(v, nombre, 0, 300);
  if (!t) return "";
  let u;
  try {
    u = new URL(t);
  } catch {
    falla(`${nombre}: no es un enlace.`);
  }
  if (u.protocol !== "https:" || !u.hostname.includes(".") || u.username || u.password) falla(`${nombre}: tiene que ser un enlace que empiece por https://`);
  return u.toString();
}

function habilidades(v) {
  const t = linea(v, "Orden de habilidades", 0, 12).toUpperCase().replace(/\s/g, "");
  if (!t) return "";
  if (!/^[QWE]>[QWE]>[QWE]$/.test(t) || new Set(t.split(">")).size !== 3) {
    falla("Orden de habilidades: las tres, de primera a última (por ejemplo Q>E>W).");
  }
  return t;
}

function campeonEnPuesto(v, i, nombre) {
  const c = objeto(v, nombre);
  return {
    campeon: campeon(c.campeon, `${nombre} ${i + 1}`),
    puesto: c.puesto ? uno(c.puesto, `${nombre} ${i + 1}: puesto`, PUESTOS) : "",
  };
}

/**
 * Por tipo:
 *  - `datos(d)`: comprueba y devuelve lo que se guarda (lo de fuera no entra).
 *  - `estados`: el primero es el de una cosa nueva. Solo un admin los cambia.
 *  - `crear`: "todos" o "admin".
 *  - `votos`, `comentarios`: si se puede votar o comentar.
 *  - `exportar`: qué estados salen en el fichero para la app (si sale).
 *  - `rechazo`: el «no» de un capitán. Si el autor cambia algo rechazado, se
 *    queda rechazado (con la respuesta): solo un capitán lo reabre.
 */
export const TIPOS = {
  idea: {
    nombre: "Idea",
    crear: "todos",
    votos: true,
    comentarios: true,
    estados: ["nueva", "mirando", "hecha", "descartada"],
    rechazo: "descartada",
    datos: (d) => ({
      titulo: linea(d.titulo, "Título", 4, 120),
      texto: texto(d.texto, "La idea", 0, 3000),
      donde: DONDE.includes(d.donde) ? d.donde : "Otra cosa",
    }),
  },
  draft: {
    nombre: "Draft mal leído",
    crear: "todos",
    votos: true,
    comentarios: true,
    estados: ["pendiente", "corregido", "no-es-fallo"],
    rechazo: "no-es-fallo",
    exportar: ["pendiente", "corregido", "no-es-fallo"],
    datos: (d) => ({
      draft: texto(d.draft, "El draft", 20, 4000),
      que: texto(d.que, "Qué está mal", 10, 3000),
      version: linea(d.version, "Versión", 0, 40),
    }),
  },
  build: {
    nombre: "Build",
    crear: "todos",
    votos: true,
    comentarios: true,
    estados: ["propuesta", "aceptada", "retirada"],
    rechazo: "retirada",
    exportar: ["aceptada"],
    datos: (d) => {
      const b = {
        campeon: campeon(d.campeon),
        rol: uno(d.rol, "Puesto", PUESTOS),
        titulo: linea(d.titulo, "Nombre de la build", 0, 80),
        runas: runas(d.runas),
        hechizos: lista(d.hechizos, "Hechizos", 2, (x) => hechizo(x)),
        inicio: lista(d.inicio, "Para empezar", 6, (x) => objetoId(x)),
        nucleo: lista(d.nucleo, "Núcleo", 6, (x) => objetoId(x)),
        botas: enteroONulo(d.botas, "Botas", 1000, 999999),
        situacionales: lista(d.situacionales, "Según la partida", 8, (x) => objetoId(x)),
        habilidades: habilidades(d.habilidades),
        contra: linea(d.contra, "Cuándo o contra quién", 0, 200),
        nota: texto(d.nota, "Nota", 0, 1500),
      };
      if (b.hechizos.length === 2 && b.hechizos[0] === b.hechizos[1]) falla("Hechizos: los dos iguales no puede ser.");
      if (!b.runas && !b.nucleo.length && !b.inicio.length) falla("La build: pon al menos las runas o los items.");
      return b;
    },
  },
  apunte: {
    nombre: "Apunte de matchup",
    crear: "todos",
    votos: true,
    comentarios: true,
    estados: ["nuevo", "en-la-app", "retirado"],
    rechazo: "retirado",
    exportar: ["nuevo", "en-la-app"],
    datos: (d) => {
      const a = {
        campeon: campeon(d.campeon, "Con quién"),
        rival: campeon(d.rival, "Contra quién"),
        rol: d.rol ? uno(d.rol, "Puesto", PUESTOS) : "",
        texto: texto(d.texto, "El apunte", 10, 1500),
      };
      if (a.campeon === a.rival) falla("El apunte: el mismo campeón a los dos lados no es un matchup.");
      return a;
    },
  },
  plan: {
    nombre: "Plan del Clash",
    crear: "admin",
    votos: false,
    comentarios: true,
    estados: [""],
    datos: (d) => ({
      fecha: fecha(d.fecha, "Día del Clash"),
      rival: linea(d.rival, "Rival", 0, 80),
      alineacion: lista(d.alineacion, "Alineación", 7, (x, i) => {
        const a = objeto(x, `Alineación ${i + 1}`);
        return {
          puesto: uno(a.puesto, `Alineación ${i + 1}: puesto`, [...PUESTOS, "SUPLENTE"]),
          nick: linea(a.nick, `Alineación ${i + 1}: quién`, 0, 30),
          campeones: lista(a.campeones, `Alineación ${i + 1}: campeones`, 6, (c) => campeon(c)),
        };
      }),
      bans: lista(d.bans, "Bans", 10, (x, i) => {
        const b = objeto(x, `Ban ${i + 1}`);
        return { campeon: campeon(b.campeon, `Ban ${i + 1}`), porque: linea(b.porque, `Ban ${i + 1}: por qué`, 0, 140) };
      }),
      plan: texto(d.plan, "Plan de partida", 0, 4000),
      notas: texto(d.notas, "Notas", 0, 2000),
    }),
  },
  repaso: {
    nombre: "Repaso del Clash",
    crear: "todos",
    votos: false,
    comentarios: true,
    estados: [""],
    datos: (d) => ({
      fecha: fecha(d.fecha, "Día del Clash"),
      // Clash o Flex (desde el 19-10: el equipo juega mucho más Flex que Clash).
      cola: d.cola == null || d.cola === "" ? "clash" : uno(d.cola, "Cola", ["clash", "flex"]),
      rival: linea(d.rival, "Rival", 0, 80),
      partidas: lista(d.partidas, "Partidas", 6, (x, i) => {
        const p = objeto(x, `Partida ${i + 1}`);
        const n = `Partida ${i + 1}`;
        return {
          // La referencia que da «Traer las partidas» (riot.js, `referenciaDe`):
          // con ella se pide la hoja automática. No es el número de la partida.
          ref: p.ref == null || p.ref === "" ? "" : referencia(p.ref, `${n}: partida`),
          lado: p.lado ? uno(p.lado, `${n}: lado`, ["azul", "rojo"]) : "",
          gano: p.gano == null ? null : uno(p.gano, `${n}: resultado`, [true, false]),
          duracion: enteroONulo(p.duracion, `${n}: duración`, 0, 10800),
          nuestros: lista(p.nuestros, `${n}: nuestros campeones`, 5, (c, j) => campeonEnPuesto(c, j, `${n}: nuestro campeón`)),
          suyos: lista(p.suyos, `${n}: sus campeones`, 5, (c, j) => campeonEnPuesto(c, j, `${n}: su campeón`)),
          bien: texto(p.bien, `${n}: qué salió bien`, 0, 1500),
          mal: texto(p.mal, `${n}: qué salió mal`, 0, 1500),
          app: texto(p.app, `${n}: qué dijo la app`, 0, 1000),
        };
      }),
      // Las filas que se dejan en blanco no cuentan.
      lecciones: lista(d.lecciones, "Lecciones", 10, (x, i) => linea(x, `Lección ${i + 1}`, 0, 200)).filter(Boolean),
      video: enlace(d.video, "Vídeo"),
      nota: texto(d.nota, "Nota", 0, 2000),
    }),
  },
  comentario: {
    nombre: "Comentario",
    crear: "todos",
    votos: false,
    comentarios: false,
    estados: [""],
    datos: (d) => ({ texto: texto(d.texto, "El comentario", 1, 1500) }),
  },
};

/**
 * El tipo por su nombre, o null. Solo los de la lista: `TIPOS["constructor"]`
 * o `TIPOS["__proto__"]` existen en cualquier objeto y no son tipos.
 */
export function tipoDe(nombre) {
  return typeof nombre === "string" && Object.hasOwn(TIPOS, nombre) ? TIPOS[nombre] : null;
}

/** El perfil de cada uno en la zona. */
/**
 * La forma de comparar dos nicks: sin tildes, mayúsculas, espacios ni
 * signos. «Ána», «ana» y «A.na» son el mismo nick.
 */
export function claveNick(nick) {
  return String(nick).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Lo que puede llevar un nick: las letras del teclado (también con tilde,
 * diéresis, ñ o ç), las cifras 0-9, espacios, punto, guion y guion bajo.
 * Nada más: con letras de otro alfabeto o latinas raras se escribe un nick
 * que se ve igual que el de otro (la «а» cirílica, la «ı» sin punto, la «ɑ»,
 * el «०» devanagari…), y con marcas sueltas se pinta encima de las letras.
 */
const NICK_VALIDO = /^[A-Za-z0-9ÁÉÍÓÚÜÑÇÀÈÌÒÙÂÊÎÔÛÄËÏÖÃÕáéíóúüñçàèìòùâêîôûäëïöÿãõ ._-]+$/;

export function perfil(d) {
  objeto(d, "Perfil");
  const nick = linea(d.nick, "Nick", 2, 24);
  if (!NICK_VALIDO.test(nick)) falla("Nick: solo letras (también con tilde, ñ o ç), números, espacios, punto, guion y guion bajo.");
  if (claveNick(nick).length < 2) falla("Nick: al menos dos letras o números.");
  const riot = d.riotId ? riotId(d.riotId) : null;
  return {
    nick,
    riotId: riot ? `${riot.nombre}#${riot.etiqueta}` : "",
    puesto: d.puesto ? uno(d.puesto, "Puesto", PUESTOS) : "",
  };
}

/** Lo de un admin: el estado y, si quiere, una respuesta corta. */
export function estado(tipo, d) {
  const t = tipoDe(tipo);
  objeto(d, "Estado");
  return {
    estado: uno(d.estado, "Estado", t.estados),
    respuesta: texto(d.respuesta, "Respuesta", 0, 1000),
  };
}
