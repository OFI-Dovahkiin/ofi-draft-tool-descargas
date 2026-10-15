/**
 * El almacén de la zona del equipo: un Durable Object con su propia base
 * SQLite dentro (en el plan gratuito de Cloudflare, y sin crear nada a mano:
 * lo crea el propio despliegue con la migración de `wrangler.jsonc`).
 *
 * Hay UNO para todo el equipo (`zona(env)`), así que lo que se guarda es
 * siempre coherente: dos personas votando a la vez no se pisan.
 *
 * Aquí no llega nadie que no haya pasado por la puerta del Worker (Access y su
 * pase comprobado): el correo que recibe cada método ya es el de quien entra.
 */
import { DurableObject } from "cloudflare:workers";
import { claveNick, Invalido, TIPOS, estado as validarEstado, perfil as validarPerfil, tipoDe } from "./tipos.js";

// El scouting de un rival se borra solo a los siete días, como en la app
// (`roster.rs`, DIAS_DEL_SCOUTING, decisión 3a del 2026-10-05): son datos de
// gente que no ha pedido estar aquí y sirven para preparar un Clash.
export const SCOUTING_MS = 7 * 24 * 3600 * 1000;
// Las partidas del propio equipo (para «lo que lleváis de verdad»): 30 días.
export const PROPIAS_MS = 30 * 24 * 3600 * 1000;
const DIA_MS = 24 * 3600 * 1000;
// Lo que puede escribir cada uno en un día (todas las cosas juntas). De sobra
// para el equipo; para que un error en un script no llene el almacén.
const MAX_POR_DIA = 300;
const DATOS_MAX = 40_000;

const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS miembros (
     email TEXT PRIMARY KEY,
     nick TEXT NOT NULL DEFAULT '',
     riot_id TEXT NOT NULL DEFAULT '',
     puesto TEXT NOT NULL DEFAULT '',
     creado INTEGER NOT NULL,
     visto INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS cosas (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tipo TEXT NOT NULL,
     autor TEXT NOT NULL,
     padre INTEGER,
     datos TEXT NOT NULL,
     estado TEXT NOT NULL DEFAULT '',
     respuesta TEXT NOT NULL DEFAULT '',
     creado INTEGER NOT NULL,
     actualizado INTEGER NOT NULL,
     editado INTEGER
   )`,
  "CREATE INDEX IF NOT EXISTS cosas_por_tipo ON cosas(tipo, creado)",
  "CREATE INDEX IF NOT EXISTS cosas_por_padre ON cosas(padre)",
  "CREATE INDEX IF NOT EXISTS cosas_por_autor ON cosas(autor, creado)",
  `CREATE TABLE IF NOT EXISTS votos (
     cosa INTEGER NOT NULL,
     email TEXT NOT NULL,
     PRIMARY KEY (cosa, email)
   )`,
  `CREATE TABLE IF NOT EXISTS scouting (
     clave TEXT PRIMARY KEY,
     datos TEXT NOT NULL,
     guardado INTEGER NOT NULL
   )`,
  "CREATE INDEX IF NOT EXISTS scouting_por_fecha ON scouting(guardado)",
  `CREATE TABLE IF NOT EXISTS propias (
     clave TEXT PRIMARY KEY,
     datos TEXT NOT NULL,
     guardado INTEGER NOT NULL
   )`,
  "CREATE INDEX IF NOT EXISTS propias_por_fecha ON propias(guardado)",
  // El presupuesto de peticiones a Riot (ver `riotPermiso`): aquí y no solo en
  // memoria, porque Cloudflare apaga el objeto cuando no se usa y en cada
  // despliegue, y con él se perdería la cuenta.
  `CREATE TABLE IF NOT EXISTS riot (
     clave TEXT PRIMARY KEY,
     valor TEXT NOT NULL
   )`,
];

const ORDEN_PUESTO = { TOP: 1, JUNGLE: 2, MIDDLE: 3, BOTTOM: 4, UTILITY: 5 };

class Prohibido extends Error {}
class NoEsta extends Error {}

export class Zona extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    for (const sentencia of ESQUEMA) this.sql.exec(sentencia);
    // Los almacenes creados antes de la columna `editado` (solo en pruebas).
    if (!this.filas("PRAGMA table_info(cosas)").some((c) => c.name === "editado")) {
      this.sql.exec("ALTER TABLE cosas ADD COLUMN editado INTEGER");
    }
    // Las peticiones a Riot de los dos últimos minutos y hasta cuándo pidió
    // Riot que esperásemos (ver `riotPermiso`).
    const leer = (clave, defecto) => {
      const f = this.fila("SELECT valor FROM riot WHERE clave = ?", clave);
      return f ? JSON.parse(f.valor) : defecto;
    };
    this.usosRiot = leer("usos", []);
    this.riotParadoHasta = leer("parado", 0);
  }

  guardarRiot(clave, valor) {
    this.sql.exec("INSERT INTO riot (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor", clave, JSON.stringify(valor));
  }

  // ------------------------------------------------------------ utilidades

  /** Ejecuta `fn` y convierte los errores esperables en una respuesta. */
  responder(fn) {
    try {
      return { ok: true, ...fn() };
    } catch (e) {
      if (e instanceof Invalido) return { ok: false, estado: 400, error: e.message };
      if (e instanceof Prohibido) return { ok: false, estado: 403, error: e.message };
      if (e instanceof NoEsta) return { ok: false, estado: 404, error: e.message };
      throw e;
    }
  }

  filas(consulta, ...valores) {
    return this.sql.exec(consulta, ...valores).toArray();
  }

  fila(consulta, ...valores) {
    return this.filas(consulta, ...valores)[0] || null;
  }

  asegurarMiembro(email) {
    const ahora = Date.now();
    this.sql.exec(
      "INSERT INTO miembros (email, creado, visto) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING",
      email, ahora, ahora,
    );
  }

  miembroPublico(m, admin) {
    return {
      nick: m.nick,
      riotId: m.riot_id,
      puesto: m.puesto,
      visto: m.visto,
      ...(admin ? { email: m.email } : {}),
    };
  }

  // ------------------------------------------------------------ miembros

  /** Quien entra: se apunta la primera vez y se anota cuándo vino (como mucho cada diez minutos). */
  entrar(email) {
    const ahora = Date.now();
    this.asegurarMiembro(email);
    this.sql.exec("UPDATE miembros SET visto = ? WHERE email = ? AND visto < ?", ahora, email, ahora - 600_000);
    const m = this.fila("SELECT * FROM miembros WHERE email = ?", email);
    return { email: m.email, nick: m.nick, riotId: m.riot_id, puesto: m.puesto, creado: m.creado };
  }

  guardarPerfil(email, d) {
    return this.responder(() => {
      const p = validarPerfil(d);
      this.asegurarMiembro(email);
      const clave = claveNick(p.nick);
      const otro = this.filas("SELECT email, nick FROM miembros WHERE email <> ? AND nick <> ''", email).find((m) => claveNick(m.nick) === clave);
      if (otro) throw new Invalido(`Nick: se parece demasiado al de otro del equipo («${otro.nick}»).`);
      const antes = this.riotIdDe(email);
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("UPDATE miembros SET nick = ?, riot_id = ?, puesto = ? WHERE email = ?", p.nick, p.riotId, p.puesto, email);
        // Con otro Riot ID (o sin él), lo bajado de las partidas del de antes sobra.
        if (antes && antes.toLowerCase() !== p.riotId.toLowerCase()) this.olvidarPartidas(antes);
      });
      return { perfil: p };
    });
  }

  /**
   * Borra lo bajado de las partidas de un Riot ID para «lo que lleváis de
   * verdad» (la cuenta con su PUUID, la lista de partidas y la build de cada
   * una), salvo que otro del equipo tenga puesto ese mismo Riot ID.
   * Las claves son `huella:cuenta:<riot id>`, `huella:ids:<puuid>` y
   * `huella:partida:<id>:<puuid>` (propias.js), con la huella de cada clave de Riot.
   */
  olvidarPartidas(riotId) {
    const rid = String(riotId || "").toLowerCase();
    if (!rid) return;
    if (this.filas("SELECT riot_id FROM miembros WHERE riot_id <> ''").some((m) => m.riot_id.toLowerCase() === rid)) return;
    const sufijo = `:cuenta:${rid}`;
    // (Se compara aquí y no en SQL: un Riot ID puede llevar letras que SQLite y
    // JavaScript no cuentan igual. Las cuentas son pocas: una por Riot ID.)
    const cuentas = this.filas("SELECT clave, datos FROM propias WHERE instr(clave, ':cuenta:') > 0").filter((f) => f.clave.endsWith(sufijo));
    for (const f of cuentas) {
      const huella = f.clave.slice(0, -sufijo.length);
      let puuid = null;
      try {
        puuid = JSON.parse(f.datos).puuid;
      } catch {
        /* sin PUUID: solo se borra la cuenta */
      }
      if (typeof puuid === "string" && puuid) {
        this.sql.exec("DELETE FROM propias WHERE clave = ?", `${huella}:ids:${puuid}`);
        const inicio = `${huella}:partida:`;
        const fin = `:${puuid}`;
        this.sql.exec("DELETE FROM propias WHERE substr(clave, 1, ?) = ? AND substr(clave, -?) = ?", inicio.length, inicio, fin.length, fin);
      }
      this.sql.exec("DELETE FROM propias WHERE clave = ?", f.clave);
    }
  }

  miembros(admin) {
    const filas = this.filas("SELECT * FROM miembros");
    filas.sort((a, b) => (ORDEN_PUESTO[a.puesto] || 9) - (ORDEN_PUESTO[b.puesto] || 9) || a.nick.localeCompare(b.nick, "es"));
    return { miembros: filas.map((m) => this.miembroPublico(m, admin)) };
  }

  /**
   * Un capitán borra a alguien: su perfil, sus votos, todo lo que escribió
   * (con lo que cuelga de ello) y lo bajado de sus partidas. Es lo que se hace
   * cuando alguien pide que se borre lo suyo (política de privacidad).
   */
  borrarMiembro(admin, objetivo) {
    return this.responder(() => {
      if (!admin) throw new Prohibido("Esto solo lo puede hacer un capitán.");
      if (typeof objetivo !== "string" || !this.fila("SELECT email FROM miembros WHERE email = ?", objetivo)) {
        throw new NoEsta("Ese miembro ya no está.");
      }
      let cosas = 0;
      const riotId = this.riotIdDe(objetivo);
      this.ctx.storage.transactionSync(() => {
        for (const { id } of this.filas("SELECT id FROM cosas WHERE autor = ?", objetivo)) {
          this.sql.exec("DELETE FROM votos WHERE cosa IN (SELECT id FROM cosas WHERE padre = ?)", id);
          this.sql.exec("DELETE FROM cosas WHERE padre = ?", id);
          this.sql.exec("DELETE FROM votos WHERE cosa = ?", id);
          this.sql.exec("DELETE FROM cosas WHERE id = ?", id);
          cosas += 1;
        }
        this.sql.exec("DELETE FROM votos WHERE email = ?", objetivo);
        this.sql.exec("DELETE FROM miembros WHERE email = ?", objetivo);
        // Y lo bajado de sus partidas («lo que lleváis de verdad»).
        this.olvidarPartidas(riotId);
      });
      return { borrado: true, cosas };
    });
  }

  riotIdDe(email) {
    const m = this.fila("SELECT riot_id FROM miembros WHERE email = ?", email);
    return m ? m.riot_id : "";
  }

  // ------------------------------------------------------------ las cosas

  formatear(c, email, admin) {
    const t = TIPOS[c.tipo];
    return {
      id: c.id,
      tipo: c.tipo,
      padre: c.padre,
      autor: c.nick || "Alguien del equipo",
      ...(admin ? { autorEmail: c.autor } : {}),
      mia: c.autor === email,
      datos: JSON.parse(c.datos),
      estado: c.estado,
      respuesta: c.respuesta,
      votos: t.votos ? c.votos : undefined,
      yoVoto: t.votos ? !!c.yo_voto : undefined,
      comentarios: t.comentarios ? c.comentarios : undefined,
      creado: c.creado,
      actualizado: c.actualizado,
      editado: c.editado || c.creado,
    };
  }

  consultaCosas(donde) {
    return `SELECT c.*, m.nick AS nick,
              (SELECT COUNT(*) FROM votos v WHERE v.cosa = c.id) AS votos,
              EXISTS (SELECT 1 FROM votos v WHERE v.cosa = c.id AND v.email = ?) AS yo_voto,
              (SELECT COUNT(*) FROM cosas k WHERE k.padre = c.id) AS comentarios
            FROM cosas c LEFT JOIN miembros m ON m.email = c.autor
            WHERE ${donde}`;
  }

  listar(tipo, email, admin) {
    return this.responder(() => {
      if (!tipoDe(tipo) || tipo === "comentario") throw new Invalido("Tipo: no se ha entendido.");
      const filas = this.filas(`${this.consultaCosas("c.tipo = ? AND c.padre IS NULL")} ORDER BY c.creado DESC LIMIT 1000`, email, tipo);
      return { cosas: filas.map((c) => this.formatear(c, email, admin)) };
    });
  }

  una(id, email, admin) {
    const c = this.fila(this.consultaCosas("c.id = ?"), email, id);
    if (!c) throw new NoEsta("Ya no existe: puede que alguien lo haya borrado.");
    return this.formatear(c, email, admin);
  }

  comentarios(id, email, admin) {
    return this.responder(() => {
      const padre = this.fila("SELECT id FROM cosas WHERE id = ?", id);
      if (!padre) throw new NoEsta("Ya no existe: puede que alguien lo haya borrado.");
      const filas = this.filas(`${this.consultaCosas("c.padre = ?")} ORDER BY c.creado ASC`, email, id);
      return { comentarios: filas.map((c) => this.formatear(c, email, admin)) };
    });
  }

  crear(tipo, email, admin, datos, padre) {
    return this.responder(() => {
      const t = tipoDe(tipo);
      if (!t) throw new Invalido("Tipo: no se ha entendido.");
      if (t.crear === "admin" && !admin) throw new Prohibido("Esto solo lo puede hacer un capitán.");
      if (!datos || typeof datos !== "object" || Array.isArray(datos)) throw new Invalido("No se ha entendido el envío.");
      const limpio = t.datos(datos);
      const texto = JSON.stringify(limpio);
      if (texto.length > DATOS_MAX) throw new Invalido("Es demasiado largo.");

      let idPadre = null;
      if (tipo === "comentario") {
        const p = this.fila("SELECT id, tipo FROM cosas WHERE id = ?", padre);
        if (!p) throw new NoEsta("Ya no existe: puede que alguien lo haya borrado.");
        if (!TIPOS[p.tipo].comentarios) throw new Invalido("Aquí no se puede comentar.");
        idPadre = p.id;
      } else if (padre != null) {
        throw new Invalido("No se ha entendido el envío.");
      }

      this.asegurarMiembro(email);
      const hoy = this.fila("SELECT COUNT(*) AS n FROM cosas WHERE autor = ? AND creado > ?", email, Date.now() - DIA_MS);
      if (hoy.n >= MAX_POR_DIA) throw new Invalido("Llevas muchas cosas hoy: sigue mañana.");

      const ahora = Date.now();
      const nueva = this.fila(
        "INSERT INTO cosas (tipo, autor, padre, datos, estado, creado, actualizado, editado) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
        tipo, email, idPadre, texto, t.estados[0], ahora, ahora, ahora,
      );
      return { cosa: this.una(nueva.id, email, admin) };
    });
  }

  /** Lo suyo lo cambia quien lo escribió; lo de todos, un capitán. El plan, solo un capitán. */
  puedeTocar(c, email, admin) {
    if (admin) return true;
    if (TIPOS[c.tipo].crear === "admin") return false;
    return c.autor === email;
  }

  editar(id, email, admin, datos) {
    return this.responder(() => {
      const c = this.fila("SELECT * FROM cosas WHERE id = ?", id);
      if (!c) throw new NoEsta("Ya no existe: puede que alguien lo haya borrado.");
      if (!this.puedeTocar(c, email, admin)) throw new Prohibido("Solo lo puede cambiar quien lo escribió o un capitán.");
      if (!datos || typeof datos !== "object" || Array.isArray(datos)) throw new Invalido("No se ha entendido el envío.");
      const t = TIPOS[c.tipo];
      const texto = JSON.stringify(t.datos(datos));
      if (texto.length > DATOS_MAX) throw new Invalido("Es demasiado largo.");
      // Guardado sin cambiar nada: se queda como estaba (ni estado ni «cambiado»).
      if (texto === c.datos) return { cosa: this.una(id, email, admin), reabierta: false };
      // Lo que un capitán dio por bueno o tiene entre manos (una build
      // aceptada, un apunte en la app, una idea hecha…) y cambia quien no es
      // capitán vuelve al primer estado, sin la respuesta: si no, lo cambiado
      // saldría en el fichero para la app sin que nadie lo haya revisado. Lo
      // que un capitán rechazó se queda rechazado y con su respuesta (se ve
      // «cambiado»): solo un capitán lo reabre.
      let estado = c.estado;
      let respuesta = c.respuesta;
      if (!admin && t.estados.length > 1 && c.estado !== t.estados[0] && c.estado !== t.rechazo) {
        estado = t.estados[0];
        respuesta = "";
      }
      const ahora = Date.now();
      this.sql.exec("UPDATE cosas SET datos = ?, estado = ?, respuesta = ?, actualizado = ?, editado = ? WHERE id = ?", texto, estado, respuesta, ahora, ahora, id);
      return { cosa: this.una(id, email, admin), reabierta: estado !== c.estado };
    });
  }

  votar(id, email, admin, si) {
    return this.responder(() => {
      const c = this.fila("SELECT tipo FROM cosas WHERE id = ?", id);
      if (!c) throw new NoEsta("Ya no existe: puede que alguien lo haya borrado.");
      if (!TIPOS[c.tipo].votos) throw new Invalido("Esto no se vota.");
      this.asegurarMiembro(email);
      if (si) this.sql.exec("INSERT INTO votos (cosa, email) VALUES (?, ?) ON CONFLICT DO NOTHING", id, email);
      else this.sql.exec("DELETE FROM votos WHERE cosa = ? AND email = ?", id, email);
      return { cosa: this.una(id, email, admin) };
    });
  }

  cambiarEstado(id, email, admin, d) {
    return this.responder(() => {
      if (!admin) throw new Prohibido("Esto solo lo puede hacer un capitán.");
      const c = this.fila("SELECT tipo FROM cosas WHERE id = ?", id);
      if (!c) throw new NoEsta("Ya no existe: puede que alguien lo haya borrado.");
      if (TIPOS[c.tipo].estados.length < 2) throw new Invalido("Esto no tiene estados.");
      const e = validarEstado(c.tipo, d);
      this.sql.exec("UPDATE cosas SET estado = ?, respuesta = ?, actualizado = ? WHERE id = ?", e.estado, e.respuesta, Date.now(), id);
      return { cosa: this.una(id, email, admin) };
    });
  }

  borrar(id, email, admin) {
    return this.responder(() => {
      const c = this.fila("SELECT * FROM cosas WHERE id = ?", id);
      if (!c) throw new NoEsta("Ya no existe: puede que alguien lo haya borrado.");
      if (!this.puedeTocar(c, email, admin)) throw new Prohibido("Solo lo puede borrar quien lo escribió o un capitán.");
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("DELETE FROM votos WHERE cosa IN (SELECT id FROM cosas WHERE padre = ?)", id);
        this.sql.exec("DELETE FROM cosas WHERE padre = ?", id);
        this.sql.exec("DELETE FROM votos WHERE cosa = ?", id);
        this.sql.exec("DELETE FROM cosas WHERE id = ?", id);
      });
      return { borrada: id };
    });
  }

  /** Lo que sale en el fichero para la app: solo los estados que dice `TIPOS[tipo].exportar`. */
  exportar(tipo) {
    return this.responder(() => {
      const t = tipoDe(tipo);
      if (!t || !t.exportar) throw new Invalido("Esto no se exporta.");
      const filas = this.filas(
        `SELECT c.*, (SELECT COUNT(*) FROM votos v WHERE v.cosa = c.id) AS votos
         FROM cosas c WHERE c.tipo = ? AND c.padre IS NULL ORDER BY c.creado ASC`,
        tipo,
      ).filter((c) => t.exportar.includes(c.estado));
      return {
        filas: filas.map((c) => ({
          id: c.id,
          ...JSON.parse(c.datos),
          estado: c.estado,
          respuesta: c.respuesta || undefined,
          votos: c.votos,
          creado: new Date(c.creado).toISOString(),
        })),
      };
    });
  }

  /** Cuántas hay de cada tipo, para la portada de la zona. */
  resumen(fp) {
    const porTipo = {};
    for (const f of this.filas("SELECT tipo, estado, COUNT(*) AS n FROM cosas WHERE padre IS NULL GROUP BY tipo, estado")) {
      porTipo[f.tipo] = porTipo[f.tipo] || {};
      porTipo[f.tipo][f.estado || "todas"] = f.n;
    }
    const plan = this.fila(
      "SELECT id, datos, actualizado FROM cosas WHERE tipo = 'plan' ORDER BY json_extract(datos, '$.fecha') DESC, id DESC LIMIT 1",
    );
    const miembros = this.fila("SELECT COUNT(*) AS n FROM miembros WHERE nick <> ''").n;
    return {
      porTipo,
      miembros,
      plan: plan ? { id: plan.id, fecha: JSON.parse(plan.datos).fecha, rival: JSON.parse(plan.datos).rival, actualizado: plan.actualizado } : null,
      scouting: fp ? this.fila("SELECT COUNT(*) AS n FROM scouting WHERE clave LIKE ? AND guardado > ?", `${fp}:equipo:%`, Date.now() - SCOUTING_MS).n : 0,
    };
  }

  // ------------------------------------------------------------ scouting

  /** Lo guardado del scouting, si no ha caducado (y si es más nuevo que `maxEdad`). */
  cache(clave, maxEdad = SCOUTING_MS) {
    const f = this.fila("SELECT datos, guardado FROM scouting WHERE clave = ?", clave);
    if (!f || f.guardado < Date.now() - Math.min(maxEdad, SCOUTING_MS)) return null;
    return { datos: JSON.parse(f.datos), guardado: f.guardado };
  }

  /** Varias claves de golpe (las partidas de un jugador). */
  caches(claves) {
    const fuera = {};
    const limite = Date.now() - SCOUTING_MS;
    for (const clave of claves) {
      const f = this.fila("SELECT datos, guardado FROM scouting WHERE clave = ?", clave);
      if (f && f.guardado >= limite) fuera[clave] = JSON.parse(f.datos);
    }
    return fuera;
  }

  async guardarCache(entradas) {
    const ahora = Date.now();
    for (const [clave, datos] of entradas) {
      this.sql.exec(
        "INSERT INTO scouting (clave, datos, guardado) VALUES (?, ?, ?) ON CONFLICT(clave) DO UPDATE SET datos = excluded.datos, guardado = excluded.guardado",
        clave, JSON.stringify(datos), ahora,
      );
    }
    this.purgarScouting();
    // Y el despertador: aunque nadie vuelva a entrar, lo de más de siete días
    // se borra igual, en cuanto caduca.
    await this.programarBorrado();
    return { guardadas: entradas.length };
  }

  purgarScouting() {
    this.sql.exec("DELETE FROM scouting WHERE guardado < ?", Date.now() - SCOUTING_MS);
  }

  async alarm() {
    this.purgarScouting();
    this.purgarPropias();
    await this.programarBorrado();
  }

  /** El despertador, para cuando caduque la fila más vieja (del rival a los 7 días, del equipo a los 30). */
  async programarBorrado() {
    const rival = this.fila("SELECT MIN(guardado) AS t FROM scouting").t;
    const propia = this.fila("SELECT MIN(guardado) AS t FROM propias").t;
    const cuando = Math.min(rival != null ? rival + SCOUTING_MS : Infinity, propia != null ? propia + PROPIAS_MS : Infinity);
    if (cuando === Infinity) return;
    const actual = await this.ctx.storage.getAlarm();
    if (actual == null || actual > cuando + 60_000) await this.ctx.storage.setAlarm(Math.max(cuando + 1000, Date.now() + 1000));
  }

  // ------------------------------------------------------------ las partidas del equipo

  /** El nick y el Riot ID de un miembro, por su nick (sin distinguir mayúsculas). */
  miembroPorNick(nick) {
    if (typeof nick !== "string" || !nick.trim()) return null;
    const clave = claveNick(nick);
    const m = this.filas("SELECT nick, riot_id FROM miembros WHERE nick <> ''").find((x) => claveNick(x.nick) === clave);
    return m ? { nick: m.nick, riotId: m.riot_id } : null;
  }

  propia(clave, maxEdad = PROPIAS_MS) {
    const f = this.fila("SELECT datos, guardado FROM propias WHERE clave = ?", clave);
    if (!f || f.guardado < Date.now() - Math.min(maxEdad, PROPIAS_MS)) return null;
    return JSON.parse(f.datos);
  }

  propiasVarias(claves) {
    const fuera = {};
    const limite = Date.now() - PROPIAS_MS;
    for (const clave of claves) {
      const f = this.fila("SELECT datos, guardado FROM propias WHERE clave = ?", clave);
      if (f && f.guardado >= limite) fuera[clave] = JSON.parse(f.datos);
    }
    return fuera;
  }

  async guardarPropias(entradas) {
    const ahora = Date.now();
    for (const [clave, datos] of entradas) {
      this.sql.exec(
        "INSERT INTO propias (clave, datos, guardado) VALUES (?, ?, ?) ON CONFLICT(clave) DO UPDATE SET datos = excluded.datos, guardado = excluded.guardado",
        clave, JSON.stringify(datos), ahora,
      );
    }
    this.purgarPropias();
    await this.programarBorrado();
    return { guardadas: entradas.length };
  }

  purgarPropias() {
    this.sql.exec("DELETE FROM propias WHERE guardado < ?", Date.now() - PROPIAS_MS);
  }

  /** Los equipos rivales mirados estos siete días (con esta clave de Riot), el último primero. */
  recientes(fp) {
    this.purgarScouting();
    const filas = this.filas("SELECT datos, guardado FROM scouting WHERE clave LIKE ? ORDER BY guardado DESC LIMIT 12", `${fp}:equipo:%`);
    return {
      equipos: filas.map((f) => {
        const e = JSON.parse(f.datos);
        return { id: e.id, nombre: e.nombre, abreviatura: e.abreviatura, guardado: f.guardado, jugadores: e.jugadores.length };
      }),
    };
  }

  /**
   * **El presupuesto de peticiones a Riot**, compartido por todo el equipo.
   *
   * Una clave personal deja 20 peticiones por segundo y 100 cada dos minutos
   * (developer.riotgames.com/docs/portal). Aquí se gasta como mucho 18 y 90,
   * para dejar margen. Si no caben `n`, dice cuánto esperar. Si Riot ya ha
   * contestado «espera» (429), nadie pregunta hasta que pase.
   */
  riotPermiso(n) {
    const ahora = Date.now();
    if (ahora < this.riotParadoHasta) return { ok: false, esperaMs: this.riotParadoHasta - ahora };
    this.usosRiot = this.usosRiot.filter((t) => t > ahora - 120_000);
    if (this.usosRiot.length + n > 90) {
      const libera = this.usosRiot[this.usosRiot.length + n - 90 - 1];
      return { ok: false, esperaMs: Math.max(1000, libera + 120_000 - ahora) };
    }
    const enUnSegundo = this.usosRiot.filter((t) => t > ahora - 1000).length;
    if (enUnSegundo + n > 18) return { ok: false, esperaMs: 1100 };
    for (let i = 0; i < n; i++) this.usosRiot.push(ahora);
    this.guardarRiot("usos", this.usosRiot);
    return { ok: true };
  }

  riotParar(ms) {
    this.riotParadoHasta = Math.max(this.riotParadoHasta, Date.now() + ms);
    this.guardarRiot("parado", this.riotParadoHasta);
    return { ok: true };
  }
}

/** El almacén del equipo (uno solo). */
export function zona(env) {
  return env.ZONA.get(env.ZONA.idFromName("equipo-ofi"));
}
