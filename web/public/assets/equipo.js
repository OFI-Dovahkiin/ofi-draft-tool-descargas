/* OFI Draft Tool — la zona del equipo (/equipo/).
 *
 * Las páginas de /equipo/ son solo el esqueleto; esto las rellena con lo que
 * devuelve /equipo/api/ (que solo contesta a quien ha entrado por Cloudflare
 * Access). Sin librerías, y sin meter nunca texto de nadie como HTML: todo lo
 * que escribe el equipo va con textContent.
 *
 * Los nombres e iconos de campeones, objetos, runas y hechizos salen de Data
 * Dragon (Riot), en castellano, como en la app.
 */
(() => {
  "use strict";

  // ==================================================================== piezas

  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

  /** Un elemento. En `a`: `texto` (textContent), `clase`, `onX` (eventos) y atributos. */
  function h(etiqueta, a = {}, ...hijos) {
    const el = document.createElement(etiqueta);
    for (const [k, v] of Object.entries(a || {})) {
      if (v == null || v === false) continue;
      if (k === "texto") el.textContent = v;
      else if (k === "clase") el.className = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
    for (const hijo of hijos.flat(Infinity)) {
      if (hijo == null || hijo === false) continue;
      el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
    }
    return el;
  }

  let contador = 0;
  const nuevoId = (base) => `${base}-${++contador}`;

  const PUESTOS = [["TOP", "Top"], ["JUNGLE", "Jungla"], ["MIDDLE", "Mid"], ["BOTTOM", "ADC"], ["UTILITY", "Support"]];
  const NOMBRE_PUESTO = Object.fromEntries(PUESTOS);
  NOMBRE_PUESTO.SUPLENTE = "Suplente";
  const ORDEN_PUESTO = Object.fromEntries(PUESTOS.map(([p], i) => [p, i]));

  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const numero = (n) => Number(n || 0).toLocaleString("es-ES");
  /** «1 build», «3 builds». */
  const plural = (n, uno, varios) => `${numero(n)} ${n === 1 ? uno : varios}`;

  function mismoDia(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  /** «hace 5 min», «hoy a las 18:30», «ayer a las 22:10», «el 12 de octubre». */
  function cuando(ms) {
    const d = new Date(ms);
    const ahora = new Date();
    const s = (ahora - d) / 1000;
    if (s < 60) return "ahora mismo";
    if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
    if (mismoDia(d, ahora)) return `hoy a las ${hhmm(d)}`;
    const ayer = new Date(ahora);
    ayer.setDate(ahora.getDate() - 1);
    if (mismoDia(d, ayer)) return `ayer a las ${hhmm(d)}`;
    return `el ${d.getDate()} de ${MESES[d.getMonth()]}${d.getFullYear() !== ahora.getFullYear() ? ` de ${d.getFullYear()}` : ""}`;
  }

  /** "2026-10-18" → «sábado 18 de octubre». */
  function diaTexto(iso) {
    const [a, m, d] = String(iso).split("-").map(Number);
    if (!a || !m || !d) return String(iso);
    const f = new Date(a, m - 1, d);
    return `${DIAS[f.getDay()]} ${d} de ${MESES[m - 1]}${a !== new Date().getFullYear() ? ` de ${a}` : ""}`;
  }

  function hoyIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  const minutos = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");

  /** Para buscar sin tildes, mayúsculas ni signos: «Kai'Sa» → «kaisa». */
  function normal(t) {
    return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  // ==================================================================== avisos

  function avisar(mensaje, { recargar = false } = {}) {
    const caja = $("[data-aviso]");
    if (!caja) return;
    caja.replaceChildren(h("span", { texto: mensaje }));
    if (recargar) caja.append(h("button", { clase: "boton pequeno", type: "button", onclick: () => location.reload() }, "Recargar"));
    caja.hidden = false;
  }

  function quitarAviso() {
    const caja = $("[data-aviso]");
    if (caja) caja.hidden = true;
  }

  function mostrarError(e) {
    avisar(e && e.message ? e.message : "Algo ha fallado. Prueba otra vez.", { recargar: !!(e && (e.red || e.sinPase)) });
  }

  // ==================================================================== la API

  class ErrorZona extends Error {
    constructor(mensaje, extra = {}) {
      super(mensaje);
      Object.assign(this, extra);
    }
  }

  let avisoCopia = false;

  /** GET si no hay `datos`; POST con JSON si los hay. Lanza ErrorZona con el mensaje del servidor. */
  async function api(ruta, datos) {
    // Sin seguir redirecciones: si la sesión de Access ha caducado, Access
    // contesta con una redirección a su página de entrada.
    const op = { credentials: "same-origin", redirect: "manual", headers: { accept: "application/json" } };
    if (datos !== undefined) {
      op.method = "POST";
      op.headers["content-type"] = "application/json";
      op.body = JSON.stringify(datos);
    }
    let r;
    try {
      r = await fetch(`/equipo/api/${ruta}`, op);
    } catch {
      throw new ErrorZona(
        navigator.onLine === false
          ? "Sin conexión. Cuando vuelva, prueba otra vez."
          : "No se ha podido conectar. Si llevas tiempo sin entrar, recarga la página para volver a entrar.",
        { red: true },
      );
    }
    if (r.type === "opaqueredirect") {
      throw new ErrorZona("Tu sesión ha caducado: recarga la página para volver a entrar.", { estado: 401, sinPase: true });
    }
    let cuerpo = null;
    try {
      cuerpo = await r.json();
    } catch {
      /* no es JSON: por ejemplo, la página de entrada de Access */
    }
    if (!cuerpo) throw new ErrorZona("Tu sesión ha caducado o algo ha fallado: recarga la página.", { estado: r.status, sinPase: true });
    if (!r.ok || cuerpo.ok === false) {
      throw new ErrorZona(cuerpo.mensaje || "Algo ha fallado. Prueba otra vez.", { estado: r.status, ...cuerpo });
    }
    // Lo ha dado el service worker sin conexión: es lo último que se vio.
    const copia = r.headers.get("x-ofi-copia");
    if (copia && !avisoCopia) {
      avisoCopia = true;
      const t = Number(copia);
      avisar(`Sin conexión: esto es lo último que viste${t > 1e12 ? ` (${cuando(t)})` : ""}.`);
    }
    return cuerpo;
  }

  let promesaYo = null;
  let yoActual = null;
  const yo = () => (promesaYo ||= api("yo").then((r) => (yoActual = r)));

  // ==================================================================== Data Dragon

  const DD = "https://ddragon.leagueoflegends.com";

  // Los fragmentos de runas (las tres filas de abajo) no vienen en Data Dragon.
  // Los ids y los nombres son los de la app (crates/data/src/lib.rs).
  const FRAGMENTOS = [
    { titulo: "Ofensivo", opciones: [[5008, "Fuerza adaptable"], [5005, "Velocidad de ataque"], [5007, "Aceleración de habilidad"]] },
    { titulo: "Flexible", opciones: [[5008, "Fuerza adaptable"], [5010, "Velocidad de movimiento"], [5001, "Vida por nivel"]] },
    { titulo: "Defensivo", opciones: [[5011, "Vida"], [5013, "Tenacidad y reducción de ralentización"], [5001, "Vida por nivel"]] },
  ];
  const NOMBRE_FRAGMENTO = Object.fromEntries(FRAGMENTOS.flatMap((f) => f.opciones));

  // Los hechizos de invocador, como se dicen: Data Dragon en castellano trae los
  // nombres del cliente («Destello», «Prender», «Extenuación»…) y en partida nadie
  // los llama así. Por su número de Riot; los demás, con el de Data Dragon.
  // Los mismos que la app (`app/src/etiquetas.ts`).
  const HECHIZOS_COMO_SE_DICEN = { 1: "Cleanse", 3: "Exhaust", 4: "Flash", 6: "Ghost", 7: "Heal", 11: "Smite", 12: "TP", 14: "Ignite", 21: "Barrier" };

  let promesaCatalogo = null;

  /** Campeones, objetos, runas y hechizos de la última versión de Data Dragon, en castellano. */
  function catalogo() {
    if (!promesaCatalogo) {
      promesaCatalogo = cargarCatalogo().catch((e) => {
        promesaCatalogo = null;
        throw e;
      });
    }
    return promesaCatalogo;
  }

  /** El catálogo si se puede; si no (sin conexión), null y la página sigue con números. */
  async function catalogoONada() {
    try {
      return await catalogo();
    } catch {
      return null;
    }
  }

  async function cargarCatalogo() {
    const pedir = async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Data Dragon ${r.status}`);
      return r.json();
    };
    const versiones = await pedir(`${DD}/api/versions.json`);
    const v = versiones[0];
    const base = `${DD}/cdn/${v}/data/es_ES`;
    const [ch, it, ru, su] = await Promise.all(["champion", "item", "runesReforged", "summoner"].map((n) => pedir(`${base}/${n}.json`)));

    const cat = { version: v, campeones: new Map(), listaCampeones: [], objetos: new Map(), listaObjetos: [], arboles: [], runas: new Map(), hechizos: new Map(), listaHechizos: [] };
    for (const c of Object.values(ch.data)) {
      const x = { key: Number(c.key), id: c.id, nombre: c.name, img: `${DD}/cdn/${v}/img/champion/${c.image.full}`, norma: normal(c.name), normaId: normal(c.id) };
      cat.campeones.set(x.key, x);
      cat.listaCampeones.push(x);
    }
    cat.listaCampeones.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    const vistos = new Set();
    for (const [id, o] of Object.entries(it.data)) {
      const x = { id: Number(id), nombre: o.name, img: `${DD}/cdn/${v}/img/item/${o.image.full}`, botas: (o.tags || []).includes("Boots"), norma: normal(o.name) };
      cat.objetos.set(x.id, x);
      // Los de la Grieta que se pueden comprar: fuera los de otros modos, los de
      // un campeón (Ornn, Kalista…) y los que no salen en la tienda.
      const enLaGrieta = o.maps && o.maps["11"] && o.gold && o.gold.purchasable && o.inStore !== false && !o.requiredChampion && !o.requiredAlly && !o.hideFromAll;
      if (enLaGrieta && !vistos.has(x.norma)) {
        vistos.add(x.norma);
        cat.listaObjetos.push(x);
      }
    }
    cat.listaObjetos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    for (const a of ru) {
      const arbol = {
        id: a.id,
        nombre: a.name,
        icono: `${DD}/cdn/img/${a.icon}`,
        filas: a.slots.map((s) => s.runes.map((r) => ({ id: r.id, nombre: r.name, icono: `${DD}/cdn/img/${r.icon}`, arbol: a.id }))),
      };
      cat.arboles.push(arbol);
      cat.runas.set(a.id, { id: a.id, nombre: a.name, icono: arbol.icono, arbol: a.id, fila: -1 });
      arbol.filas.forEach((fila, i) => fila.forEach((r) => cat.runas.set(r.id, { ...r, fila: i })));
    }

    for (const s of Object.values(su.data)) {
      if (!(s.modes || []).includes("CLASSIC")) continue;
      const x = { key: Number(s.key), nombre: HECHIZOS_COMO_SE_DICEN[Number(s.key)] || s.name, img: `${DD}/cdn/${v}/img/spell/${s.image.full}` };
      cat.hechizos.set(x.key, x);
      cat.listaHechizos.push(x);
    }
    cat.listaHechizos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    // Las listas para escribir y elegir (datalist), una vez para toda la página.
    const lista = (id, valores) => {
      if (document.getElementById(id)) return;
      document.body.append(h("datalist", { id }, valores.map((n) => h("option", { value: n }))));
    };
    lista("dl-campeones", cat.listaCampeones.map((c) => c.nombre));
    lista("dl-objetos", cat.listaObjetos.filter((o) => !o.botas).map((o) => o.nombre));
    lista("dl-botas", cat.listaObjetos.filter((o) => o.botas).map((o) => o.nombre));
    return cat;
  }

  function buscarCampeon(cat, texto) {
    const n = normal(texto);
    if (!cat || !n) return null;
    const exacto = cat.listaCampeones.find((c) => c.norma === n || c.normaId === n);
    if (exacto) return exacto;
    const empiezan = cat.listaCampeones.filter((c) => c.norma.startsWith(n) || c.normaId.startsWith(n));
    return empiezan.length === 1 ? empiezan[0] : null;
  }

  function buscarObjeto(cat, texto, botas) {
    const n = normal(texto);
    if (!cat || !n) return null;
    const lista = cat.listaObjetos.filter((o) => (botas == null ? true : o.botas === botas));
    const exacto = lista.find((o) => o.norma === n);
    if (exacto) return exacto;
    const empiezan = lista.filter((o) => o.norma.startsWith(n));
    return empiezan.length === 1 ? empiezan[0] : null;
  }

  function icono(src, alt, clase = "") {
    return h("img", { clase: `icono ${clase}`.trim(), src, alt: alt || "", width: 32, height: 32, loading: "lazy", decoding: "async" });
  }

  function nombreCampeon(cat, key) {
    const c = cat && cat.campeones.get(key);
    return c ? c.nombre : `Campeón ${key}`;
  }

  /** Icono y nombre de un campeón. Con `solo`, solo el icono (y el nombre en el alt y el title). */
  function vistaCampeon(cat, key, { tam = "", solo = false } = {}) {
    const c = cat && cat.campeones.get(key);
    const nombre = nombreCampeon(cat, key);
    if (!c) return h("span", { clase: "con-icono", texto: nombre });
    if (solo) return h("span", { clase: "con-icono", title: nombre }, icono(c.img, nombre, tam));
    return h("span", { clase: "con-icono" }, icono(c.img, "", tam), h("span", { texto: nombre }));
  }

  function vistaObjeto(cat, id) {
    const o = cat && cat.objetos.get(id);
    if (!o) return h("li", { texto: `Item ${id}` });
    return h("li", {}, icono(o.img, "", "mini"), h("span", { texto: o.nombre }));
  }

  function vistaHechizo(cat, key) {
    const s = cat && cat.hechizos.get(key);
    if (!s) return h("li", { texto: `Hechizo ${key}` });
    return h("li", {}, icono(s.img, "", "mini"), h("span", { texto: s.nombre }));
  }

  // ==================================================================== campos de formulario

  function campo(etiqueta, control, { ayuda = "", id = control.id } = {}) {
    return h("div", { clase: "campo" },
      h("label", { for: id, texto: etiqueta }),
      ayuda ? h("p", { clase: "ayuda", texto: ayuda }) : null,
      control);
  }

  function entradaTexto({ valor = "", max = 200, placeholder = "", lista = null } = {}) {
    return h("input", { type: "text", id: nuevoId("t"), value: valor, maxlength: max, placeholder, list: lista, autocomplete: "off" });
  }

  function areaTexto({ valor = "", max = 3000, corto = false } = {}) {
    const t = h("textarea", { id: nuevoId("a"), maxlength: max, clase: corto ? "corto" : null });
    t.value = valor;
    return t;
  }

  function selector(opciones, valor = "", { vacio = null } = {}) {
    const s = h("select", { id: nuevoId("s") },
      vacio != null ? h("option", { value: "", texto: vacio }) : null,
      opciones.map(([v, t]) => h("option", { value: v, texto: t })));
    s.value = valor;
    return s;
  }

  /** Un campeón, escrito (con sugerencias). `.valor` es su número de Riot o null. */
  function campoCampeon(cat, etiqueta, valor = null, { ayuda = "" } = {}) {
    const entrada = h("input", { type: "text", id: nuevoId("c"), list: "dl-campeones", autocomplete: "off", autocapitalize: "off", spellcheck: "false", maxlength: 40 });
    const eco = h("p", { clase: "eco", "aria-live": "polite" });
    let actual = valor && cat ? cat.campeones.get(valor) || null : null;
    if (actual) entrada.value = actual.nombre;
    const pintar = (final) => {
      eco.classList.remove("mal");
      if (actual) eco.replaceChildren(icono(actual.img, "", "mini"), actual.nombre);
      else if (entrada.value.trim() && final) {
        eco.textContent = "No encuentro ese campeón: elige uno de la lista.";
        eco.classList.add("mal");
      } else eco.textContent = "";
    };
    entrada.addEventListener("input", () => {
      actual = buscarCampeon(cat, entrada.value);
      if (actual && normal(entrada.value) !== actual.norma) actual = normal(entrada.value).length >= 3 ? actual : null;
      pintar(false);
    });
    entrada.addEventListener("change", () => {
      actual = buscarCampeon(cat, entrada.value);
      if (actual) entrada.value = actual.nombre;
      pintar(true);
    });
    pintar(false);
    const caja = campo(etiqueta, entrada, { ayuda });
    caja.append(eco);
    return {
      caja,
      entrada,
      get valor() {
        return actual ? actual.key : null;
      },
      /** true si está bien (vacío vale si no es obligatorio). */
      comprobar(obligatorio) {
        if (!actual && (obligatorio || entrada.value.trim())) {
          pintar(true);
          if (!entrada.value.trim()) {
            eco.textContent = "Falta el campeón.";
            eco.classList.add("mal");
          }
          return false;
        }
        return true;
      },
    };
  }

  /**
   * Una lista de cosas que se añaden escribiendo (campeones u objetos), con
   * su icono, que se pueden quitar. `.valor` es la lista de números.
   */
  function campoLista(cat, etiqueta, { tipo = "campeon", max = 6, valores = [], ayuda = "", botas = null } = {}) {
    const listaDl = tipo === "campeon" ? "dl-campeones" : botas ? "dl-botas" : "dl-objetos";
    const entrada = h("input", { type: "text", id: nuevoId("l"), list: listaDl, autocomplete: "off", autocapitalize: "off", spellcheck: "false", maxlength: 60 });
    const boton = h("button", { type: "button", clase: "boton pequeno", texto: "Añadir" });
    const eco = h("p", { clase: "eco", "aria-live": "polite" });
    const chips = h("ul", { clase: "chips" });
    let elegidos = [...valores];

    const datos = (n) => (tipo === "campeon"
      ? cat && cat.campeones.get(n) && { nombre: cat.campeones.get(n).nombre, img: cat.campeones.get(n).img }
      : cat && cat.objetos.get(n) && { nombre: cat.objetos.get(n).nombre, img: cat.objetos.get(n).img }) || { nombre: `${tipo === "campeon" ? "Campeón" : "Item"} ${n}`, img: null };

    const pintar = () => {
      chips.replaceChildren(...elegidos.map((n, i) => {
        const d = datos(n);
        return h("li", {}, d.img ? icono(d.img, "", "mini") : null, h("span", { texto: d.nombre }),
          h("button", { type: "button", "aria-label": `Quitar ${d.nombre}`, title: "Quitar", texto: "×", onclick: () => { elegidos.splice(i, 1); pintar(); } }));
      }));
      entrada.disabled = elegidos.length >= max;
      boton.disabled = elegidos.length >= max;
    };
    const anadir = () => {
      const texto = entrada.value.trim();
      if (!texto) return;
      // Varios de golpe, separados por comas.
      const partes = texto.split(/[,;]+/).map((t) => t.trim()).filter(Boolean);
      const malos = [];
      for (const p of partes) {
        const hit = tipo === "campeon" ? buscarCampeon(cat, p) : buscarObjeto(cat, p, botas);
        const n = hit ? (tipo === "campeon" ? hit.key : hit.id) : null;
        if (n == null) malos.push(p);
        else if (elegidos.length < max && (tipo !== "campeon" || !elegidos.includes(n))) elegidos.push(n);
      }
      entrada.value = "";
      eco.classList.toggle("mal", malos.length > 0);
      eco.textContent = malos.length ? `No encuentro: ${malos.join(", ")}. Elige de la lista.` : "";
      pintar();
    };
    boton.addEventListener("click", anadir);
    entrada.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        anadir();
      }
    });
    entrada.addEventListener("change", () => {
      // Elegido de la lista de sugerencias: se añade solo.
      const hit = tipo === "campeon" ? buscarCampeon(cat, entrada.value) : buscarObjeto(cat, entrada.value, botas);
      if (hit && normal(entrada.value) === hit.norma) anadir();
    });
    pintar();
    const caja = h("div", { clase: "campo" },
      h("label", { for: entrada.id, texto: etiqueta }),
      ayuda ? h("p", { clase: "ayuda", texto: ayuda }) : null,
      chips,
      h("div", { clase: "agregar" }, entrada, boton),
      eco);
    return {
      caja,
      get valor() {
        return [...elegidos];
      },
    };
  }

  /** La página de runas: rama principal (clave y tres filas), secundaria (dos runas) y fragmentos. */
  function campoRunas(cat, valor = null) {
    const caja = h("div", { clase: "runas-elegir" });
    const est = {
      principal: valor ? valor.principal : null,
      claves: valor ? [...valor.claves] : [null, null, null, null],
      secundaria: valor ? valor.secundaria : null,
      secundarias: valor ? valor.secundarias.map((id) => ({ id, fila: cat.runas.get(id) ? cat.runas.get(id).fila : -1 })) : [],
      fragmentos: valor ? [...valor.fragmentos] : [null, null, null],
    };
    const nombre = nuevoId("runas");

    const opcion = (tipoInput, grupo, valorOpcion, etiqueta, img, marcado, alCambiar) => {
      const input = h("input", { type: tipoInput, name: grupo, value: valorOpcion });
      input.checked = !!marcado;
      input.addEventListener("change", alCambiar);
      return h("label", { clase: "opcion-runa" }, input, h("span", { clase: img ? null : "sin-icono" }, img ? icono(img, "", "runa") : null, etiqueta));
    };

    const pintar = () => {
      const partes = [];
      // 1. Rama principal
      partes.push(h("fieldset", {}, h("legend", { texto: "Rama principal" }),
        h("div", { clase: "fila-runas" }, cat.arboles.map((a) => opcion("radio", `${nombre}-p`, a.id, a.nombre, a.icono, est.principal === a.id, () => {
          est.principal = a.id;
          est.claves = [null, null, null, null];
          if (est.secundaria === a.id) {
            est.secundaria = null;
            est.secundarias = [];
          }
          pintar();
        })))));
      const principal = cat.arboles.find((a) => a.id === est.principal);
      if (principal) {
        principal.filas.forEach((fila, i) => {
          partes.push(h("fieldset", {}, h("legend", { texto: i === 0 ? "Clave" : `Fila ${i}` }),
            h("div", { clase: "fila-runas" }, fila.map((r) => opcion("radio", `${nombre}-f${i}`, r.id, r.nombre, r.icono, est.claves[i] === r.id, () => {
              est.claves[i] = r.id;
            })))));
        });
        // 2. Rama secundaria: otra, y dos runas de filas distintas (sin la clave).
        partes.push(h("fieldset", {}, h("legend", { texto: "Rama secundaria" }),
          h("div", { clase: "fila-runas" }, cat.arboles.filter((a) => a.id !== est.principal).map((a) => opcion("radio", `${nombre}-s`, a.id, a.nombre, a.icono, est.secundaria === a.id, () => {
            est.secundaria = a.id;
            est.secundarias = [];
            pintar();
          })))));
        const secundaria = cat.arboles.find((a) => a.id === est.secundaria);
        if (secundaria) {
          partes.push(h("fieldset", {}, h("legend", { texto: "Dos runas de la secundaria (de filas distintas)" }),
            secundaria.filas.slice(1).map((fila, j) => h("div", { clase: "fila-runas" }, fila.map((r) => opcion("checkbox", `${nombre}-s${j}`, r.id, r.nombre, r.icono, est.secundarias.some((x) => x.id === r.id), (ev) => {
              const fi = j + 1;
              if (ev.target.checked) {
                // Una por fila: la de la misma fila se cambia; si ya hay dos, sale la más vieja.
                est.secundarias = est.secundarias.filter((x) => x.fila !== fi);
                est.secundarias.push({ id: r.id, fila: fi });
                if (est.secundarias.length > 2) est.secundarias.shift();
              } else {
                est.secundarias = est.secundarias.filter((x) => x.id !== r.id);
              }
              pintar();
            }))))));
        }
      }
      // 3. Fragmentos
      partes.push(h("fieldset", {}, h("legend", { texto: "Fragmentos" }),
        FRAGMENTOS.map((f, i) => h("div", {}, h("p", { clase: "ayuda", texto: f.titulo }),
          h("div", { clase: "fila-runas" }, f.opciones.map(([id, nom]) => opcion("radio", `${nombre}-fr${i}`, id, nom, null, est.fragmentos[i] === id, () => {
            est.fragmentos[i] = id;
          })))))));
      const activo = document.activeElement;
      const foco = activo && caja.contains(activo) && activo.name ? [activo.name, activo.value] : null;
      caja.replaceChildren(...partes);
      if (foco) {
        const igual = [...caja.querySelectorAll("input")].find((i) => i.name === foco[0] && i.value === foco[1]);
        if (igual) igual.focus();
      }
    };
    pintar();

    return {
      caja,
      /** null si no se ha tocado; si está a medias, un mensaje. */
      leer() {
        const nada = !est.principal && !est.secundaria && est.fragmentos.every((x) => x == null);
        if (nada) return { valor: null };
        if (!est.principal || est.claves.some((x) => x == null)) return { error: "Runas: elige la clave y una runa de cada fila de la rama principal." };
        if (!est.secundaria || est.secundarias.length !== 2) return { error: "Runas: elige dos runas de la rama secundaria." };
        if (est.fragmentos.some((x) => x == null)) return { error: "Runas: elige los tres fragmentos." };
        return {
          valor: {
            principal: est.principal,
            claves: [...est.claves],
            secundaria: est.secundaria,
            secundarias: est.secundarias.sort((a, b) => a.fila - b.fila).map((x) => x.id),
            fragmentos: [...est.fragmentos],
          },
        };
      },
    };
  }

  /** Botones de un formulario y su mensaje. */
  function pieFormulario(textoEnviar, alCancelar) {
    const enviar = h("button", { type: "submit", clase: "boton principal", texto: textoEnviar });
    const cancelar = alCancelar ? h("button", { type: "button", clase: "boton", texto: "Cancelar", onclick: alCancelar }) : null;
    const mensaje = h("p", { clase: "mensaje", role: "status", hidden: true });
    return {
      nodos: [mensaje, h("div", { clase: "botones" }, enviar, cancelar)],
      enviar,
      mal(texto) {
        mensaje.textContent = texto;
        mensaje.className = "mensaje mal";
        mensaje.hidden = false;
        mensaje.scrollIntoView({ block: "nearest" });
      },
      limpiar() {
        mensaje.hidden = true;
      },
    };
  }

  /** Envía con el botón bloqueado; los errores del servidor salen en el formulario. */
  async function enviando(pie, fn) {
    pie.limpiar();
    pie.enviar.disabled = true;
    try {
      return await fn();
    } catch (e) {
      pie.mal(e.message || "No se ha podido guardar.");
      return null;
    } finally {
      pie.enviar.disabled = false;
    }
  }

  // ==================================================================== las cosas: tarjetas

  const ESTADOS = {
    idea: { nueva: ["Nueva", ""], mirando: ["La miramos", "ambar"], hecha: ["Hecha", "verde"], descartada: ["Descartada", "gris"] },
    draft: { pendiente: ["Pendiente", ""], corregido: ["Corregido", "verde"], "no-es-fallo": ["No es fallo", "gris"] },
    build: { propuesta: ["Propuesta", ""], aceptada: ["Aceptada", "verde"], retirada: ["Retirada", "gris"] },
    apunte: { nuevo: ["Nuevo", ""], "en-la-app": ["En la app", "verde"], retirado: ["Retirado", "gris"] },
  };
  const CERRADOS = new Set(["hecha", "descartada", "corregido", "no-es-fallo", "retirada", "retirado"]);
  // El «no» de un capitán, por tipo (el mismo `rechazo` de src/tipos.js).
  const RECHAZO = { idea: "descartada", draft: "no-es-fallo", build: "retirada", apunte: "retirado" };
  const VOTO = { idea: "Yo también", draft: "A mí también", build: "Me sirve", apunte: "Útil" };
  const NOMBRE_TIPO = { idea: "Idea", draft: "Draft mal leído", build: "Build", apunte: "Apunte", plan: "Plan", repaso: "Repaso" };

  /**
   * Al cambiar algo ya revisado (una build aceptada, una idea hecha…) quien no
   * es capitán, vuelve al primer estado y un capitán lo tiene que revisar otra
   * vez; lo rechazado se queda rechazado. El formulario lo avisa antes.
   */
  function avisoRevision(c) {
    const estados = c && ESTADOS[c.tipo];
    if (!estados || (yoActual && yoActual.admin)) return null;
    const [primero] = Object.keys(estados);
    if (c.estado === primero) return null;
    const ahora = `Ahora está «${estados[c.estado][0]}».`;
    if (c.estado === RECHAZO[c.tipo]) {
      return h("div", { clase: "aviso ambar" }, h("p", { texto: `${ahora} Si lo cambias, se queda así: un capitán verá que lo has cambiado y, si quiere, lo vuelve a abrir.` }));
    }
    return h("div", { clase: "aviso ambar" }, h("p", { texto: `${ahora} Si lo cambias, vuelve a «${estados[primero][0]}» y un capitán lo tendrá que revisar otra vez.` }));
  }

  function etiquetaEstado(c) {
    const e = ESTADOS[c.tipo] && ESTADOS[c.tipo][c.estado];
    return e ? h("span", { clase: `etiqueta ${e[1]}`.trim(), texto: e[0] }) : null;
  }

  /**
   * La tarjeta de una cosa, con su pie: autor y fecha, voto, comentarios,
   * editar y borrar (lo suyo, o todo si es capitán) y, para un capitán, el
   * estado y la respuesta.
   */
  function tarjeta(c, ctx) {
    const art = h("article", { clase: `cosa${CERRADOS.has(c.estado) ? " cerrada" : ""}`, "data-id": c.id });
    const reemplazar = (nueva) => {
      ctx.actualizar(nueva);
      art.replaceWith(tarjeta(nueva, ctx));
    };

    const cuerpo = ctx.cuerpo(c);
    const etiquetas = h("div", { clase: "etiquetas-cosa" }, ctx.conTipo ? h("span", { clase: "etiqueta tipo", texto: NOMBRE_TIPO[c.tipo] }) : null, etiquetaEstado(c));
    const voto = c.votos !== undefined
      ? h("button", {
        type: "button",
        clase: "voto",
        "aria-pressed": c.yoVoto ? "true" : "false",
        title: c.yoVoto ? "Quitar tu voto" : "Votar",
        onclick: async (e) => {
          const boton = e.currentTarget;
          boton.disabled = true;
          try {
            reemplazar((await api(`cosas/${c.id}/voto`, { si: !c.yoVoto })).cosa);
          } catch (err) {
            mostrarError(err);
            boton.disabled = false;
          }
        },
      }, h("span", { clase: "n", texto: c.votos }), h("span", { texto: VOTO[c.tipo] || "Votar" }))
      : null;

    art.append(h("div", { clase: "cosa-cabeza" }, h("div", { clase: "titulo" }, etiquetas, cuerpo.titulo), voto));
    for (const n of cuerpo.resto || []) if (n) art.append(n);
    if (c.respuesta) art.append(h("div", { clase: "respuesta" }, h("strong", { texto: "Respuesta" }), c.respuesta));

    const editado = (c.editado || c.creado) - c.creado > 60_000 ? " · cambiado" : "";
    art.append(h("p", { clase: "meta" }, h("span", { texto: `${c.autor} · ${cuando(c.creado)}${editado}` }),
      ctx.yo.admin && c.autorEmail ? h("span", { texto: c.autorEmail }) : null));

    const acciones = h("div", { clase: "acciones-cosa" });
    let panel = null;
    if (c.comentarios !== undefined) {
      const boton = h("button", { type: "button", clase: "enlace", "aria-expanded": "false", texto: c.comentarios ? `Comentarios (${c.comentarios})` : "Comentar" });
      boton.addEventListener("click", async () => {
        if (panel) {
          panel.remove();
          panel = null;
          boton.setAttribute("aria-expanded", "false");
          return;
        }
        boton.setAttribute("aria-expanded", "true");
        panel = await panelComentarios(c, ctx, (n) => {
          boton.textContent = n ? `Comentarios (${n})` : "Comentar";
        });
        art.append(panel);
      });
      acciones.append(boton);
    }
    const puede = c.mia || ctx.yo.admin;
    if (puede && ctx.editar && (c.tipo !== "plan" || ctx.yo.admin)) {
      acciones.append(h("button", { type: "button", clase: "enlace", texto: "Cambiar", onclick: () => ctx.editar(c, art) }));
    }
    if (puede && (c.tipo !== "plan" || ctx.yo.admin)) acciones.append(botonBorrar(c, ctx, art));
    if (ctx.yo.admin && ESTADOS[c.tipo]) acciones.append(cambioEstado(c, reemplazar));
    if (acciones.childNodes.length) art.append(acciones);
    return art;
  }

  function botonBorrar(c, ctx, art) {
    const caja = h("span", { clase: "con-icono" });
    const pedir = h("button", { type: "button", clase: "enlace peligro", texto: "Borrar" });
    pedir.addEventListener("click", () => {
      const si = h("button", { type: "button", clase: "enlace peligro", texto: "Sí, borrar" });
      const no = h("button", { type: "button", clase: "enlace", texto: "No" });
      si.addEventListener("click", async () => {
        si.disabled = true;
        try {
          await api(`cosas/${c.id}/borrar`, {});
          ctx.quitar(c.id);
          art.remove();
        } catch (e) {
          mostrarError(e);
          si.disabled = false;
        }
      });
      no.addEventListener("click", () => caja.replaceChildren(pedir));
      caja.replaceChildren(h("span", { texto: "¿Seguro?" }), si, no);
      si.focus();
    });
    caja.append(pedir);
    return caja;
  }

  /** Para un capitán: el estado y una respuesta corta. */
  function cambioEstado(c, reemplazar) {
    const caja = h("span", { clase: "con-icono" });
    const abrir = h("button", { type: "button", clase: "enlace", texto: "Estado y respuesta" });
    abrir.addEventListener("click", () => {
      const sel = selector(Object.entries(ESTADOS[c.tipo]).map(([v, [t]]) => [v, t]), c.estado);
      sel.setAttribute("aria-label", "Estado");
      const resp = areaTexto({ valor: c.respuesta || "", max: 1000, corto: true });
      resp.setAttribute("aria-label", "Respuesta");
      resp.setAttribute("placeholder", "Respuesta (si quieres)");
      const pie = pieFormulario("Guardar", () => caja.replaceChildren(abrir));
      const f = h("form", { clase: "formulario-zona" }, campo("Estado", sel), campo("Respuesta", resp, { ayuda: "La ve todo el equipo debajo." }), pie.nodos);
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        const r = await enviando(pie, () => api(`cosas/${c.id}/estado`, { estado: sel.value, respuesta: resp.value }));
        if (r) reemplazar(r.cosa);
      });
      caja.replaceChildren(f);
      sel.focus();
    });
    caja.append(abrir);
    return caja;
  }

  async function panelComentarios(c, ctx, alContar) {
    const panel = h("div", { clase: "comentarios" });
    const lista = h("div", { clase: "comentarios-lista" }, h("p", { clase: "texto-suave", texto: "Cargando…" }));
    const texto = areaTexto({ max: 1500, corto: true });
    texto.setAttribute("aria-label", "Tu comentario");
    texto.setAttribute("placeholder", "Escribe un comentario");
    const pie = pieFormulario("Comentar");
    const form = h("form", {}, texto, pie.nodos);
    panel.append(lista, form);
    let comentarios = [];
    const pintar = () => {
      lista.replaceChildren(...(comentarios.length ? comentarios.map((k) => h("div", { clase: "comentario" },
        h("p", { texto: k.datos.texto }),
        h("p", { clase: "meta" }, h("span", { texto: `${k.autor} · ${cuando(k.creado)}` }),
          (k.mia || ctx.yo.admin) ? h("button", {
            type: "button",
            clase: "enlace peligro",
            texto: "Borrar",
            onclick: async (e) => {
              const boton = e.currentTarget;
              boton.disabled = true;
              try {
                await api(`cosas/${k.id}/borrar`, {});
                comentarios = comentarios.filter((x) => x.id !== k.id);
                alContar(comentarios.length);
                pintar();
              } catch (err) {
                mostrarError(err);
                boton.disabled = false;
              }
            },
          }) : null))) : [h("p", { clase: "texto-suave", texto: "Aún no hay comentarios." })]));
    };
    try {
      comentarios = (await api(`cosas/${c.id}/comentarios`)).comentarios;
      pintar();
    } catch (e) {
      lista.replaceChildren(h("p", { clase: "mensaje mal", texto: e.message }));
    }
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!texto.value.trim()) return;
      const r = await enviando(pie, () => api("cosas", { tipo: "comentario", padre: c.id, datos: { texto: texto.value } }));
      if (r) {
        comentarios.push(r.cosa);
        texto.value = "";
        alContar(comentarios.length);
        pintar();
      }
    });
    return panel;
  }

  // ==================================================================== una página de lista

  /**
   * Las páginas de ideas, builds y apuntes: cargan sus cosas, las filtran y
   * las pintan, y abren el formulario de nueva o de cambiar.
   *
   * `cfg`: { tipos, cuerpo(c, cat), formulario(cat, c|null, alGuardar, alCancelar), filtros(est, repintar), pasa(c, est), orden(a, b, est) }
   */
  async function paginaLista(cfg) {
    const lista = $("[data-lista]");
    const hueco = $("[data-formulario]");
    const filtros = $("[data-filtros]");
    const [quien, cat] = await Promise.all([yo(), catalogoONada()]);
    if (quien.admin) $$("[data-solo-admin]").forEach((x) => { x.hidden = false; });
    const est = { cosas: [], filtro: {}, cat };

    const ctx = {
      yo: quien,
      conTipo: cfg.tipos.length > 1,
      cuerpo: (c) => cfg.cuerpo(c, cat),
      actualizar: (nueva) => {
        est.cosas = est.cosas.map((x) => (x.id === nueva.id ? nueva : x));
      },
      quitar: (id) => {
        est.cosas = est.cosas.filter((x) => x.id !== id);
        contar();
      },
      editar: (c) => abrirFormulario(c),
    };

    const cuenta = h("span", { clase: "cuenta", "aria-live": "polite" });
    const contar = () => {
      const n = est.cosas.filter((c) => cfg.pasa(c, est)).length;
      cuenta.textContent = `${n} de ${est.cosas.length}`;
    };
    const repintar = () => {
      const vistas = est.cosas.filter((c) => cfg.pasa(c, est)).sort((a, b) => cfg.orden(a, b, est));
      lista.replaceChildren(vistas.length
        ? h("div", { clase: "cosas" }, vistas.map((c) => tarjeta(c, ctx)))
        : h("p", { clase: "texto-suave", texto: est.cosas.length ? "Nada con estos filtros." : cfg.vacio }));
      contar();
    };

    function abrirFormulario(c = null, inicial = null) {
      if (!cat && cfg.necesitaCatalogo) {
        avisar("No se han podido cargar los campeones de Riot (Data Dragon). Revisa la conexión y recarga.", { recargar: true });
        return;
      }
      hueco.hidden = false;
      const cerrar = () => {
        hueco.hidden = true;
        hueco.replaceChildren();
      };
      const form = cfg.formulario(cat, c, (guardada) => {
        cerrar();
        if (c) est.cosas = est.cosas.map((x) => (x.id === guardada.id ? guardada : x));
        else est.cosas.unshift(guardada);
        repintar();
        const nueva = lista.querySelector(`[data-id="${guardada.id}"]`);
        if (nueva) nueva.scrollIntoView({ block: "center" });
      }, cerrar, inicial);
      hueco.replaceChildren(form);
      form.scrollIntoView({ block: "start" });
      const primero = form.querySelector("input:not([type=radio]), textarea, select");
      if (primero) primero.focus({ preventScroll: true });
    }

    const nuevo = $("[data-nuevo]");
    if (nuevo) nuevo.addEventListener("click", () => abrirFormulario(null));

    if (filtros && cfg.filtros) {
      filtros.replaceChildren(...cfg.filtros(est, repintar), cuenta);
    }
    try {
      const respuestas = await Promise.all(cfg.tipos.map((t) => api(`cosas?tipo=${t}`)));
      est.cosas = respuestas.flatMap((r) => r.cosas);
      repintar();
    } catch (e) {
      lista.replaceChildren(h("p", { clase: "mensaje mal", texto: e.message }));
      if (e.red || e.sinPase) mostrarError(e);
    }
    return { abrirFormulario, cat };
  }

  /** Botones de varias opciones (pestañas). */
  function pestanas(opciones, actual, alCambiar, etiqueta) {
    const grupo = h("div", { clase: "pestanas", role: "group", "aria-label": etiqueta });
    const pintar = (valor) => {
      for (const b of grupo.children) b.setAttribute("aria-pressed", b.value === valor ? "true" : "false");
    };
    for (const [v, t] of opciones) {
      grupo.append(h("button", { type: "button", value: v, texto: t, onclick: () => { pintar(v); alCambiar(v); } }));
    }
    pintar(actual);
    return grupo;
  }

  const porVotos = (a, b) => (b.votos || 0) - (a.votos || 0) || b.creado - a.creado;
  const porFecha = (a, b) => b.creado - a.creado;

  // ==================================================================== ideas y drafts

  async function paginaIdeas() {
    await paginaLista({
      tipos: ["idea", "draft"],
      vacio: "Aún no hay ideas ni drafts. Cuenta el primero.",
      cuerpo: (c) => (c.tipo === "idea"
        ? {
          titulo: h("h3", { texto: c.datos.titulo }),
          resto: [c.datos.texto ? h("p", { clase: "texto", texto: c.datos.texto }) : null,
            h("p", { clase: "meta", texto: `Dónde: ${c.datos.donde}` })],
        }
        : {
          titulo: h("h3", { texto: c.datos.que.split("\n")[0].slice(0, 120) }),
          resto: [h("pre", { texto: c.datos.draft }),
            c.datos.que.includes("\n") || c.datos.que.length > 120 ? h("p", { clase: "texto", texto: c.datos.que }) : null,
            c.datos.version ? h("p", { clase: "meta", texto: `Versión de la app: ${c.datos.version}` }) : null],
        }),
      filtros: (est, repintar) => {
        est.filtro = { tipo: "todo", ver: "abiertas" };
        return [
          pestanas([["todo", "Todo"], ["idea", "Ideas"], ["draft", "Drafts"]], "todo", (v) => { est.filtro.tipo = v; repintar(); }, "Qué ver"),
          pestanas([["abiertas", "Abiertas"], ["todas", "Todas"]], "abiertas", (v) => { est.filtro.ver = v; repintar(); }, "Cuáles"),
        ];
      },
      pasa: (c, est) => (est.filtro.tipo === "todo" || c.tipo === est.filtro.tipo) && (est.filtro.ver === "todas" || !CERRADOS.has(c.estado)),
      orden: porVotos,
      formulario: formularioIdea,
    });
  }

  const DONDE = [
    "Tablero de champ select", "Armería (runas, items, hechizos)", "Análisis de draft", "Equipo", "Jugadores",
    "Tier list", "Fichas de campeón", "Historial", "En partida (overlay)", "Centro de mando o ajustes",
    "Instalar o actualizar", "La web", "Otra cosa",
  ];

  function formularioIdea(cat, c, alGuardar, alCancelar) {
    let tipo = c ? c.tipo : "idea";
    const d = c ? c.datos : {};
    const titulo = entradaTexto({ valor: d.titulo || "", max: 120 });
    const texto = areaTexto({ valor: d.texto || "", max: 3000 });
    const donde = selector(DONDE.map((x) => [x, x]), d.donde || "Otra cosa");
    const draft = areaTexto({ valor: d.draft || "", max: 4000 });
    draft.setAttribute("placeholder", "La «Hoja de Clash» de la app, o los diez campeones con sus puestos y los bans");
    const que = areaTexto({ valor: d.que || "", max: 3000, corto: true });
    const version = entradaTexto({ valor: d.version || "", max: 40, placeholder: "Por ejemplo 2.0.25" });
    const deIdea = [campo("Título", titulo, { ayuda: "En una frase: qué quieres que haga la app." }), campo("Cuéntala", texto, { ayuda: "Si quieres: para qué te serviría, en qué momento." }), campo("Dónde", donde)];
    const deDraft = [campo("El draft", draft, { ayuda: "Pégalo de la app («Hoja de Clash») o escribe los diez campeones." }), campo("Qué está mal", que, { ayuda: "Qué dice el motor y qué crees que debería decir." }), campo("Versión de la app", version)];
    const pie = pieFormulario(c ? "Guardar los cambios" : "Publicar", alCancelar);
    const elegir = h("fieldset", { clase: "opciones" }, h("legend", { texto: "¿Qué es?" }),
      [["idea", "Una idea para la app"], ["draft", "El motor lee mal un draft"]].map(([v, t]) => {
        const r = h("input", { type: "radio", name: nuevoId("tipo-idea"), value: v });
        r.checked = v === tipo;
        r.disabled = !!c;
        r.addEventListener("change", () => { tipo = v; ajustar(); });
        return h("label", {}, r, t);
      }));
    const cajaIdea = h("div", { clase: "formulario" }, deIdea);
    const cajaDraft = h("div", { clase: "formulario" }, deDraft);
    const ajustar = () => {
      cajaIdea.hidden = tipo !== "idea";
      cajaDraft.hidden = tipo !== "draft";
    };
    ajustar();
    const f = h("form", { clase: "formulario-zona", novalidate: true },
      h("h2", { texto: c ? "Cambiar" : "Contar una idea o un draft" }), avisoRevision(c), elegir, cajaIdea, cajaDraft, pie.nodos);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const datos = tipo === "idea"
        ? { titulo: titulo.value, texto: texto.value, donde: donde.value }
        : { draft: draft.value, que: que.value, version: version.value };
      const r = await enviando(pie, () => (c ? api(`cosas/${c.id}`, { datos }) : api("cosas", { tipo, datos })));
      if (r) alGuardar(r.cosa);
    });
    return f;
  }

  // ==================================================================== builds

  function cuerpoBuild(c, cat) {
    const d = c.datos;
    const resto = [];
    if (d.runas) {
      const r = d.runas;
      const clave = cat && cat.runas.get(r.claves[0]);
      const nombres = (ids) => ids.map((id) => (cat && cat.runas.get(id) ? cat.runas.get(id).nombre : `Runa ${id}`)).join(", ");
      resto.push(h("div", { clase: "bloque-cosa" }, h("h4", { texto: "Runas" }),
        h("p", { clase: "fila-icono" }, clave ? icono(clave.icono, "", "runa") : null,
          h("span", {}, h("strong", { texto: clave ? clave.nombre : `Runa ${r.claves[0]}` }), ` · ${nombres(r.claves.slice(1))}`)),
        h("p", { clase: "fila-icono" }, cat && cat.runas.get(r.secundaria) ? icono(cat.runas.get(r.secundaria).icono, "", "runa mini") : null,
          h("span", { texto: `${cat && cat.runas.get(r.secundaria) ? cat.runas.get(r.secundaria).nombre : "Secundaria"}: ${nombres(r.secundarias)}` })),
        h("p", { clase: "texto-suave", texto: `Fragmentos: ${r.fragmentos.map((x) => NOMBRE_FRAGMENTO[x] || x).join(" · ")}` })));
    }
    if (d.hechizos.length) resto.push(h("div", { clase: "bloque-cosa" }, h("h4", { texto: "Hechizos" }), h("ul", { clase: "iconos" }, d.hechizos.map((k) => vistaHechizo(cat, k)))));
    const filaObjetos = (titulo, ids, orden = false) => (ids && ids.length
      ? h("div", { clase: "bloque-cosa" }, h("h4", { texto: titulo }),
        h("ul", { clase: "iconos" }, ids.flatMap((id, i) => [i && orden ? h("li", { clase: "flecha-orden", "aria-hidden": "true", texto: "→" }) : null, vistaObjeto(cat, id)])))
      : null);
    resto.push(filaObjetos("Para empezar", d.inicio), filaObjetos("Núcleo, en orden", d.nucleo, true), filaObjetos("Botas", d.botas ? [d.botas] : []), filaObjetos("Según la partida", d.situacionales));
    if (d.habilidades) resto.push(h("div", { clase: "bloque-cosa" }, h("h4", { texto: "Habilidades" }), h("p", { texto: `Subir primero ${d.habilidades.split(">").join(", luego ")} (la R siempre que se pueda).` })));
    if (d.contra) resto.push(h("div", { clase: "bloque-cosa" }, h("h4", { texto: "Cuándo usarla" }), h("p", { clase: "texto", texto: d.contra })));
    if (d.nota) resto.push(h("div", { clase: "bloque-cosa" }, h("h4", { texto: "Nota" }), h("p", { clase: "texto", texto: d.nota })));
    return {
      titulo: h("h3", { clase: "con-icono" }, vistaCampeon(cat, d.campeon, { tam: "grande", solo: true }),
        h("span", {}, `${nombreCampeon(cat, d.campeon)} · ${NOMBRE_PUESTO[d.rol]}`, d.titulo ? h("span", { clase: "texto-suave", texto: ` — ${d.titulo}` }) : null)),
      resto,
    };
  }

  async function paginaBuilds() {
    const { abrirFormulario, cat } = await paginaLista({
      tipos: ["build"],
      necesitaCatalogo: true,
      vacio: "Aún no hay builds. Propón la primera.",
      cuerpo: cuerpoBuild,
      filtros: (est, repintar) => {
        est.filtro = { campeon: "", rol: "", ver: "vivas" };
        const buscar = h("input", { type: "search", id: nuevoId("b"), placeholder: "Campeón", list: "dl-campeones", autocomplete: "off" });
        buscar.addEventListener("input", () => { est.filtro.campeon = normal(buscar.value); repintar(); });
        const rol = selector(PUESTOS, "", { vacio: "Todos los puestos" });
        rol.addEventListener("change", () => { est.filtro.rol = rol.value; repintar(); });
        return [campo("Buscar", buscar), campo("Puesto", rol),
          pestanas([["vivas", "Sin retiradas"], ["aceptadas", "Aceptadas"], ["todas", "Todas"]], "vivas", (v) => { est.filtro.ver = v; repintar(); }, "Cuáles")];
      },
      pasa: (c, est) => {
        const f = est.filtro;
        if (f.rol && c.datos.rol !== f.rol) return false;
        if (f.ver === "aceptadas" && c.estado !== "aceptada") return false;
        if (f.ver === "vivas" && c.estado === "retirada") return false;
        return !f.campeon || normal(nombreCampeon(est.cat, c.datos.campeon)).includes(f.campeon);
      },
      orden: (a, b) => (a.estado === "aceptada" ? 0 : 1) - (b.estado === "aceptada" ? 0 : 1) || porVotos(a, b),
      formulario: formularioBuild,
    });
    await seccionDeVerdad(cat, (gr) => abrirFormulario(null, propuestaDesde(gr)));
  }

  // ==================================================================== builds: lo que lleváis de verdad

  /** Cuántas veces sale cada cosa: [[valor, veces], …], de más a menos. */
  function frecuencias(valores, clave = (x) => x) {
    const m = new Map();
    for (const v of valores) {
      const k = clave(v);
      const x = m.get(k) || { v, n: 0 };
      x.n += 1;
      m.set(k, x);
    }
    return [...m.values()].sort((a, b) => b.n - a.n).map((x) => [x.v, x.n]);
  }

  /**
   * Las partidas de un miembro, agrupadas por campeón y puesto, con lo más
   * repetido de cada cosa y su muestra («4 de 5»).
   */
  function agruparDeVerdad(cat, partidas) {
    const grupos = new Map();
    for (const p of partidas.filter((x) => !x.remake)) {
      const k = `${p.campeon}|${p.puesto}`;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(p);
    }
    return [...grupos.values()].map((ps) => {
      const n = ps.length;
      const esBota = (id) => !!(cat && cat.objetos.get(id) && cat.objetos.get(id).botas);
      const paginas = frecuencias(ps.filter((p) => p.runas && p.runas.claves.length === 4 && p.runas.secundarias.length === 2 && p.runas.fragmentos.length === 3).map((p) => p.runas), (r) => JSON.stringify(r));
      const hechizos = frecuencias(ps.filter((p) => p.hechizos.length === 2).map((p) => [...p.hechizos].sort((a, b) => a - b)), (h) => h.join("+"));
      const objetos = frecuencias(ps.flatMap((p) => [...new Set(p.objetos)]));
      const botas = objetos.filter(([id]) => esBota(id));
      const resto = objetos.filter(([id]) => !esBota(id) && !(cat && cat.objetos.get(id) && /^(Poción|Guardián|Elixir)/.test(cat.objetos.get(id).nombre)));
      return { campeon: ps[0].campeon, puesto: ps[0].puesto, n, g: ps.filter((p) => p.gano).length, pagina: paginas[0] || null, hechizos: hechizos[0] || null, botas: botas[0] || null, objetos: resto.slice(0, 6) };
    }).sort((a, b) => b.n - a.n);
  }

  function tarjetaDeVerdad(cat, nick, gr, alProponer) {
    const nombres = (ids) => ids.map((id) => (cat && cat.runas.get(id) ? cat.runas.get(id).nombre : `Runa ${id}`)).join(", ");
    const art = h("article", { clase: "cosa" },
      h("h3", { clase: "con-icono" }, vistaCampeon(cat, gr.campeon, { tam: "grande", solo: true }),
        h("span", {}, `${nombreCampeon(cat, gr.campeon)}${gr.puesto ? ` · ${NOMBRE_PUESTO[gr.puesto]}` : ""}`,
          h("span", { clase: "texto-suave", texto: ` — ${plural(gr.n, "partida", "partidas")}, ${plural(gr.g, "ganada", "ganadas")}` }))));
    if (gr.pagina) {
      const [r, veces] = gr.pagina;
      const clave = cat && cat.runas.get(r.claves[0]);
      art.append(h("div", { clase: "bloque-cosa" }, h("h4", { texto: `Runas (${veces} de ${gr.n})` }),
        h("p", { clase: "fila-icono" }, clave ? icono(clave.icono, "", "runa") : null,
          h("span", {}, h("strong", { texto: clave ? clave.nombre : `Runa ${r.claves[0]}` }), ` · ${nombres(r.claves.slice(1))} · ${cat && cat.runas.get(r.secundaria) ? cat.runas.get(r.secundaria).nombre : "Secundaria"}: ${nombres(r.secundarias)}`))));
    }
    if (gr.hechizos) art.append(h("div", { clase: "bloque-cosa" }, h("h4", { texto: `Hechizos (${gr.hechizos[1]} de ${gr.n})` }), h("ul", { clase: "iconos" }, gr.hechizos[0].map((k) => vistaHechizo(cat, k)))));
    const objetos = [...(gr.botas ? [gr.botas] : []), ...gr.objetos];
    if (objetos.length) {
      art.append(h("div", { clase: "bloque-cosa" }, h("h4", { texto: "Items (en cuántas partidas los acabó llevando)" }),
        h("ul", { clase: "iconos" }, objetos.map(([id, veces]) => {
          const li = vistaObjeto(cat, id);
          li.append(h("span", { clase: "texto-suave", texto: `${veces} de ${gr.n}` }));
          return li;
        }))));
    }
    art.append(h("p", { clase: "meta", texto: `De las partidas de ${nick}.` }),
      h("div", { clase: "acciones-cosa" }, h("button", { type: "button", clase: "enlace", texto: "Proponer como build del equipo", onclick: () => alProponer(gr) })));
    return art;
  }

  /**
   * «Lo que lleváis de verdad»: un botón por cada uno con Riot ID, y se traen
   * sus partidas al pulsarlo, de una en una (así no se gastan de golpe las
   * consultas a Riot que el scouting necesita). Si falla lo de uno (un Riot ID
   * mal puesto, un fallo de Riot con una partida), sale en su bloque y los
   * demás siguen funcionando.
   */
  async function seccionDeVerdad(cat, abrirPropuesta) {
    const grupo = $("[data-de-verdad]");
    const ayuda = $("[data-de-verdad-ayuda]");
    const progreso = $("[data-de-verdad-progreso]");
    const lista = $("[data-de-verdad-lista]");
    if (!grupo) return;
    const sinBotones = (texto) => {
      grupo.hidden = true;
      ayuda.hidden = true;
      lista.replaceChildren(h("p", { clase: "texto-suave", texto }));
    };
    const quien = await yo();
    if (!quien.riot) return sinBotones("Para esto hace falta la clave de Riot en Cloudflare (el secreto RIOT_KEY).");
    let miembros;
    try {
      miembros = (await api("miembros")).miembros.filter((m) => m.nick && m.riotId);
    } catch (e) {
      grupo.replaceChildren();
      return mostrarError(e);
    }
    if (!miembros.length) return sinBotones("Nadie ha puesto aún su Riot ID en su perfil (Tu perfil y el equipo, abajo del todo).");

    const titulo = (m) => `${m.nick}${m.puesto ? ` · ${NOMBRE_PUESTO[m.puesto]}` : ""}`;
    const decir = (t) => { progreso.hidden = !t; progreso.textContent = t || ""; };
    const bloques = new Map();
    const colocar = () => lista.replaceChildren(...miembros.filter((m) => bloques.has(m.nick)).map((m) => bloques.get(m.nick)));
    const botones = miembros.map((m) => h("button", { type: "button", clase: "boton", texto: titulo(m) }));

    async function traer(m) {
      for (const b of botones) b.disabled = true;
      quitarAviso();
      let contenido;
      try {
        let r;
        do {
          decir(`Mirando las partidas de ${m.nick}…`);
          r = await conEspera(() => api("riot/propias", { nick: m.nick }), (s) => decir(`Riot nos deja 100 consultas cada dos minutos: seguimos en ${s} s…`));
        } while (r.quedan);
        const grupos = r.sinRiotId ? [] : agruparDeVerdad(cat, r.partidas);
        contenido = grupos.length
          ? h("div", { clase: "cosas" }, grupos.map((g) => tarjetaDeVerdad(cat, m.nick, g, abrirPropuesta)))
          : h("p", { clase: "texto-suave", texto: r.sinRiotId ? "Ya no tiene Riot ID en su perfil." : "Sin partidas recientes de SoloQ, Flex o Clash." });
      } catch (e) {
        // Sin pase, sin clave o sin conexión: no es cosa de este, vale para todos.
        if (e.sinPase || e.sinClave || e.red) {
          decir("");
          for (const b of botones) b.disabled = false;
          return mostrarError(e);
        }
        contenido = h("p", { clase: "aviso ambar", texto: e.message || "Algo ha fallado. Prueba otra vez." });
      }
      bloques.set(m.nick, h("section", { clase: "bloque-cosa" }, h("h3", { texto: titulo(m) }), contenido));
      colocar();
      decir("");
      for (const b of botones) b.disabled = false;
    }

    botones.forEach((b, i) => b.addEventListener("click", () => traer(miembros[i])));
    grupo.replaceChildren(...botones);
  }

  /** De un grupo de «lo que lleváis», los datos para empezar una propuesta. */
  function propuestaDesde(gr) {
    return {
      campeon: gr.campeon,
      rol: gr.puesto || "",
      runas: gr.pagina ? gr.pagina[0] : null,
      hechizos: gr.hechizos ? gr.hechizos[0] : [],
      nucleo: gr.objetos.slice(0, 3).map(([id]) => id),
      botas: gr.botas ? gr.botas[0] : null,
      situacionales: gr.objetos.slice(3, 6).map(([id]) => id),
    };
  }


  function formularioBuild(cat, c, alGuardar, alCancelar, inicial = null) {
    const d = c ? c.datos : (inicial || {});
    const champ = campoCampeon(cat, "Campeón", d.campeon || null);
    const rol = selector(PUESTOS, d.rol || "", { vacio: "Elige" });
    const titulo = entradaTexto({ valor: d.titulo || "", max: 80, placeholder: "Por ejemplo: letalidad contra tanques blandos" });
    const runas = campoRunas(cat, d.runas || null);
    const hechizo = (i) => selector(cat.listaHechizos.map((s) => [String(s.key), s.nombre]), d.hechizos && d.hechizos[i] ? String(d.hechizos[i]) : "", { vacio: "—" });
    const h1 = hechizo(0);
    const h2 = hechizo(1);
    const inicio = campoLista(cat, "Para empezar", { tipo: "objeto", max: 6, valores: d.inicio || [], ayuda: "Lo que compras al salir (y la poción)." });
    const nucleo = campoLista(cat, "Núcleo, en orden", { tipo: "objeto", max: 6, valores: d.nucleo || [], ayuda: "Los items de siempre, en el orden en que se compran." });
    const botas = campoLista(cat, "Botas", { tipo: "objeto", max: 1, valores: d.botas ? [d.botas] : [], botas: true });
    const situ = campoLista(cat, "Según la partida", { tipo: "objeto", max: 8, valores: d.situacionales || [], ayuda: "Los que se cambian según contra quién juegues." });
    const orden = (d.habilidades || "").split(">");
    const hab = [0, 1, 2].map((i) => selector([["Q", "Q"], ["W", "W"], ["E", "E"]], orden[i] || "", { vacio: "—" }));
    const contra = entradaTexto({ valor: d.contra || "", max: 200, placeholder: "Por ejemplo: contra equipos con mucho AP" });
    const nota = areaTexto({ valor: d.nota || "", max: 1500, corto: true });
    const pie = pieFormulario(c ? "Guardar los cambios" : "Proponer la build", alCancelar);

    const f = h("form", { clase: "formulario-zona", novalidate: true },
      h("h2", { texto: c ? "Cambiar la build" : "Proponer una build" }),
      avisoRevision(c),
      !c && inicial ? h("div", { clase: "aviso azul" }, h("p", { texto: "Sale de vuestras partidas. Revisa el orden del núcleo (de una partida solo se sabe con qué acabó, no en qué orden lo compró) y pon el orden de habilidades." })) : null,
      h("div", { clase: "fila-campos" }, champ.caja, campo("Puesto", rol)),
      campo("Nombre de la build (si quieres)", titulo),
      h("div", { clase: "campo" }, h("span", { clase: "etiqueta-campo", texto: "Runas" }), h("p", { clase: "ayuda", texto: "Déjalas sin tocar si la build es solo de items." }), runas.caja),
      h("div", { clase: "fila-campos" }, campo("Hechizo 1", h1), campo("Hechizo 2", h2)),
      inicio.caja, nucleo.caja, botas.caja, situ.caja,
      h("fieldset", { clase: "opciones" }, h("legend", { texto: "Orden de habilidades (de primera a última en subir al máximo)" }),
        h("div", { clase: "fila-campos tres" }, hab.map((s, i) => campo(`${i + 1}.ª`, s)))),
      campo("Cuándo usarla o contra quién", contra),
      campo("Nota", nota, { ayuda: "Lo que haga falta saber: el plan de la build, un truco." }),
      pie.nodos);

    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!champ.comprobar(true)) return pie.mal("Elige el campeón.");
      if (!rol.value) return pie.mal("Elige el puesto.");
      const r = runas.leer();
      if (r.error) return pie.mal(r.error);
      const hechizos = [h1.value, h2.value].filter(Boolean).map(Number);
      const habs = hab.map((s) => s.value);
      if (habs.some(Boolean) && (habs.some((x) => !x) || new Set(habs).size !== 3)) return pie.mal("Orden de habilidades: elige las tres, sin repetir (o ninguna).");
      const datos = {
        campeon: champ.valor,
        rol: rol.value,
        titulo: titulo.value,
        runas: r.valor,
        hechizos,
        inicio: inicio.valor,
        nucleo: nucleo.valor,
        botas: botas.valor[0] || null,
        situacionales: situ.valor,
        habilidades: habs.every(Boolean) ? habs.join(">") : "",
        contra: contra.value,
        nota: nota.value,
      };
      const res = await enviando(pie, () => (c ? api(`cosas/${c.id}`, { datos }) : api("cosas", { tipo: "build", datos })));
      if (res) alGuardar(res.cosa);
    });
    return f;
  }

  // ==================================================================== apuntes de matchup

  async function paginaApuntes() {
    await paginaLista({
      tipos: ["apunte"],
      necesitaCatalogo: true,
      vacio: "Aún no hay apuntes. Escribe el primero.",
      cuerpo: (c, cat) => ({
        titulo: h("h3", { clase: "con-icono" }, "Con ", vistaCampeon(cat, c.datos.campeon), " contra ", vistaCampeon(cat, c.datos.rival),
          c.datos.rol ? h("span", { clase: "texto-suave", texto: ` · ${NOMBRE_PUESTO[c.datos.rol]}` }) : null),
        resto: [h("p", { clase: "texto", texto: c.datos.texto })],
      }),
      filtros: (est, repintar) => {
        est.filtro = { campeon: "", rol: "" };
        const buscar = h("input", { type: "search", id: nuevoId("b"), placeholder: "Con o contra", list: "dl-campeones", autocomplete: "off" });
        buscar.addEventListener("input", () => { est.filtro.campeon = normal(buscar.value); repintar(); });
        const rol = selector(PUESTOS, "", { vacio: "Todos los puestos" });
        rol.addEventListener("change", () => { est.filtro.rol = rol.value; repintar(); });
        return [campo("Buscar", buscar), campo("Puesto", rol)];
      },
      pasa: (c, est) => {
        const f = est.filtro;
        if (c.estado === "retirado" && !est.filtro.campeon) return false;
        if (f.rol && c.datos.rol !== f.rol) return false;
        return !f.campeon || [c.datos.campeon, c.datos.rival].some((k) => normal(nombreCampeon(est.cat, k)).includes(f.campeon));
      },
      orden: porVotos,
      formulario: (cat, c, alGuardar, alCancelar) => {
        const d = c ? c.datos : {};
        const con = campoCampeon(cat, "Con", d.campeon || null, { ayuda: "El campeón que juegas tú." });
        const contra = campoCampeon(cat, "Contra", d.rival || null);
        const rol = selector(PUESTOS, d.rol || "", { vacio: "Cualquiera" });
        const texto = areaTexto({ valor: d.texto || "", max: 1500 });
        texto.setAttribute("placeholder", "Por ejemplo: a nivel 2 tiene ventaja él; no pelees hasta tener la Q a nivel 3…");
        const pie = pieFormulario(c ? "Guardar los cambios" : "Publicar el apunte", alCancelar);
        const f = h("form", { clase: "formulario-zona", novalidate: true },
          h("h2", { texto: c ? "Cambiar el apunte" : "Escribir un apunte" }),
          avisoRevision(c),
          h("div", { clase: "fila-campos" }, con.caja, contra.caja),
          campo("Puesto", rol),
          campo("El apunte", texto, { ayuda: "Lo que harías en ese matchup: niveles, tradeos, items, cuándo pelear." }),
          pie.nodos);
        f.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (!con.comprobar(true) || !contra.comprobar(true)) return pie.mal("Elige los dos campeones.");
          const datos = { campeon: con.valor, rival: contra.valor, rol: rol.value, texto: texto.value };
          const r = await enviando(pie, () => (c ? api(`cosas/${c.id}`, { datos }) : api("cosas", { tipo: "apunte", datos })));
          if (r) alGuardar(r.cosa);
        });
        return f;
      },
    });
  }

  // ==================================================================== plan del Clash

  async function paginaPlan() {
    const actual = $("[data-actual]");
    const anteriores = $("[data-anteriores]");
    const bloqueAnteriores = $("[data-anteriores-bloque]");
    const hueco = $("[data-formulario]");
    const [quien, cat] = await Promise.all([yo(), catalogoONada()]);
    if (quien.admin) $$("[data-solo-admin]").forEach((x) => { x.hidden = false; });
    let planes = [];
    let miembros = [];
    try {
      miembros = (await api("miembros")).miembros;
    } catch { /* sin la lista, el nick se escribe a mano */ }

    const ctx = {
      yo: quien,
      conTipo: false,
      cuerpo: (c) => cuerpoPlan(c, cat),
      actualizar: (nueva) => { planes = planes.map((x) => (x.id === nueva.id ? nueva : x)); },
      quitar: (id) => { planes = planes.filter((x) => x.id !== id); pintar(); },
      editar: (c) => abrir(c),
    };
    const ordenar = () => planes.sort((a, b) => b.datos.fecha.localeCompare(a.datos.fecha) || b.creado - a.creado);
    function pintar() {
      ordenar();
      if (!planes.length) {
        actual.replaceChildren(h("p", { clase: "texto-suave", texto: quien.admin ? "Aún no hay ningún plan. Prepara el del próximo Clash." : "Aún no hay ningún plan: lo prepara el capitán." }));
      } else {
        const t = tarjeta(planes[0], ctx);
        t.classList.add("plan-actual");
        actual.replaceChildren(t);
      }
      bloqueAnteriores.hidden = planes.length < 2;
      anteriores.replaceChildren(h("div", { clase: "cosas" }, planes.slice(1).map((p) => tarjeta(p, ctx))));
    }
    function abrir(c = null) {
      if (!cat) {
        avisar("No se han podido cargar los campeones de Riot (Data Dragon). Revisa la conexión y recarga.", { recargar: true });
        return;
      }
      const cerrar = () => { hueco.hidden = true; hueco.replaceChildren(); };
      hueco.hidden = false;
      hueco.replaceChildren(formularioPlan(cat, c, miembros, (guardado) => {
        cerrar();
        planes = c ? planes.map((x) => (x.id === guardado.id ? guardado : x)) : [guardado, ...planes];
        pintar();
        actual.scrollIntoView({ block: "start" });
      }, cerrar));
      hueco.scrollIntoView({ block: "start" });
    }
    const nuevo = $("[data-nuevo]");
    if (nuevo) nuevo.addEventListener("click", () => abrir(null));
    try {
      planes = (await api("cosas?tipo=plan")).cosas;
      pintar();
    } catch (e) {
      actual.replaceChildren(h("p", { clase: "mensaje mal", texto: e.message }));
      if (e.red || e.sinPase) mostrarError(e);
    }
  }

  function cuerpoPlan(c, cat) {
    const d = c.datos;
    const resto = [];
    if (d.alineacion.length) {
      resto.push(h("div", { clase: "bloque-cosa" }, h("h4", { texto: "Quién juega qué" }),
        h("div", { clase: "alineacion" }, d.alineacion.map((a) => h("div", {},
          h("span", { clase: "rol", texto: NOMBRE_PUESTO[a.puesto] || a.puesto }),
          h("div", {}, h("span", { clase: "quien", texto: a.nick || "—" }),
            a.campeones.length ? h("ul", { clase: "iconos" }, a.campeones.map((k) => h("li", {}, vistaCampeon(cat, k, { tam: "mini" })))) : null))))));
    }
    if (d.bans.length) {
      resto.push(h("div", { clase: "bloque-cosa" }, h("h4", { texto: "Bans pensados" }),
        h("ul", { clase: "lista-simple" }, d.bans.map((b) => h("li", { clase: "con-icono" }, vistaCampeon(cat, b.campeon, { tam: "mini" }), b.porque ? h("span", { clase: "texto-suave", texto: `— ${b.porque}` }) : null)))));
    }
    if (d.plan) resto.push(h("div", { clase: "bloque-cosa" }, h("h4", { texto: "Plan de partida" }), h("p", { clase: "texto", texto: d.plan })));
    if (d.notas) resto.push(h("div", { clase: "bloque-cosa" }, h("h4", { texto: "Notas" }), h("p", { clase: "texto", texto: d.notas })));
    return { titulo: h("h3", { texto: `Clash del ${diaTexto(d.fecha)}${d.rival ? ` contra ${d.rival}` : ""}` }), resto };
  }

  function formularioPlan(cat, c, miembros, alGuardar, alCancelar) {
    const d = c ? c.datos : { alineacion: [], bans: [] };
    const fecha = h("input", { type: "date", id: nuevoId("f"), value: d.fecha || hoyIso() });
    const rival = entradaTexto({ valor: d.rival || "", max: 80, placeholder: "El nombre de su equipo, si lo sabéis" });
    const nicks = miembros.map((m) => m.nick).filter(Boolean);
    const dlNicks = nuevoId("dl-nicks");
    const filas = [...PUESTOS.map(([p]) => p), "SUPLENTE"].map((p) => {
      const previa = d.alineacion.find((a) => a.puesto === p) || {};
      const nick = entradaTexto({ valor: previa.nick || "", max: 30, lista: dlNicks, placeholder: "Quién" });
      const pool = campoLista(cat, `Campeones de ${NOMBRE_PUESTO[p]} para ese día`, { tipo: "campeon", max: 6, valores: previa.campeones || [] });
      return { puesto: p, nick, pool };
    });
    const bans = [];
    const listaBans = h("div", { clase: "formulario" });
    const anadirBan = (b = {}) => {
      const champ = campoCampeon(cat, `Ban ${bans.length + 1}`, b.campeon || null);
      const porque = entradaTexto({ valor: b.porque || "", max: 140, placeholder: "Por qué (si quieres)" });
      const fila = h("div", { clase: "fila-campos" }, champ.caja, campo("Por qué", porque));
      const item = { champ, porque, fila };
      bans.push(item);
      listaBans.append(fila);
    };
    (d.bans.length ? d.bans : [{}, {}, {}]).forEach(anadirBan);
    const masBans = h("button", { type: "button", clase: "boton pequeno", texto: "Otro ban", onclick: () => { if (bans.length < 10) anadirBan(); } });
    const plan = areaTexto({ valor: d.plan || "", max: 4000 });
    plan.setAttribute("placeholder", "Cómo queremos jugar: a qué lado, qué objetivos, quién inicia, qué evitar…");
    const notas = areaTexto({ valor: d.notas || "", max: 2000, corto: true });
    const pie = pieFormulario(c ? "Guardar los cambios" : "Publicar el plan", alCancelar);
    const f = h("form", { clase: "formulario-zona", novalidate: true },
      h("datalist", { id: dlNicks }, nicks.map((n) => h("option", { value: n }))),
      h("h2", { texto: c ? "Cambiar el plan" : "Plan nuevo" }),
      h("div", { clase: "fila-campos" }, campo("Día del Clash", fecha), campo("Rival", rival)),
      h("fieldset", { clase: "opciones" }, h("legend", { texto: "Quién juega qué" }),
        filas.map((x) => h("div", { clase: "partida-form" }, h("h3", { texto: NOMBRE_PUESTO[x.puesto] }), campo("Quién", x.nick), x.pool.caja))),
      h("fieldset", { clase: "opciones" }, h("legend", { texto: "Bans pensados" }), listaBans, h("p", {}, masBans)),
      campo("Plan de partida", plan),
      campo("Notas", notas),
      pie.nodos);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      for (const b of bans) if (!b.champ.comprobar(false)) return pie.mal("Hay un ban que no es un campeón: corrígelo o bórralo.");
      const datos = {
        fecha: fecha.value,
        rival: rival.value,
        alineacion: filas.filter((x) => x.nick.value.trim() || x.pool.valor.length).map((x) => ({ puesto: x.puesto, nick: x.nick.value, campeones: x.pool.valor })),
        bans: bans.filter((b) => b.champ.valor).map((b) => ({ campeon: b.champ.valor, porque: b.porque.value })),
        plan: plan.value,
        notas: notas.value,
      };
      const r = await enviando(pie, () => (c ? api(`cosas/${c.id}`, { datos }) : api("cosas", { tipo: "plan", datos })));
      if (r) alGuardar(r.cosa);
    });
    return f;
  }

  // ==================================================================== la hoja automática

  // Lo que pone la hoja (riot.js → hoja.js) en palabras. Es lo que dicen los
  // datos de Riot de la partida: qué pasó, nunca qué había que hacer.
  const MIN = (ms) => minutos(Math.floor((ms || 0) / 1000));
  const conSigno = (n) => (n > 0 ? `+${numero(n)}` : n < 0 ? `−${numero(-n)}` : "±0");
  const parcheTexto = (v) => {
    const [a, b] = String(v || "").split(".").map(Number);
    return a && b != null ? `${a >= 15 ? a + 10 : a}.${b}` : "";
  };
  const QUIEN = (nuestro) => (nuestro ? "nosotros" : "ellos");

  /** Una cifra de la línea, con color: verde si vamos por delante, rojo si por detrás. */
  function cifraLinea(n) {
    return h("span", { clase: `cifra-hoja ${n > 0 ? "gana" : n < 0 ? "pierde" : ""}`.trim(), texto: conSigno(n) });
  }

  /** La diferencia de oro minuto a minuto, dibujada: arriba vamos por delante. */
  function graficoOro(oro) {
    if (!Array.isArray(oro) || oro.length < 3) return null;
    const ancho = 320, alto = 90, m = 6;
    const tope = Math.max(1000, ...oro.map((x) => Math.abs(x)));
    const x = (i) => m + (i * (ancho - 2 * m)) / (oro.length - 1);
    const y = (v) => alto / 2 - (v / tope) * (alto / 2 - m);
    const puntos = oro.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${ancho} ${alto}`);
    svg.setAttribute("class", "oro-hoja");
    svg.setAttribute("role", "img");
    const ultimo = oro[oro.length - 1];
    const peor = Math.min(...oro), mejor = Math.max(...oro);
    svg.setAttribute("aria-label", `Diferencia de oro minuto a minuto: como mucho ${conSigno(mejor)}, como poco ${conSigno(peor)}, al final ${conSigno(ultimo)}.`);
    const linea0 = document.createElementNS(ns, "line");
    Object.entries({ x1: m, x2: ancho - m, y1: alto / 2, y2: alto / 2, class: "cero" }).forEach(([k, v]) => linea0.setAttribute(k, v));
    const traza = document.createElementNS(ns, "polyline");
    traza.setAttribute("points", puntos);
    traza.setAttribute("class", "traza");
    svg.append(linea0, traza);
    return h("figure", { clase: "figura-oro" }, svg,
      h("figcaption", { clase: "texto-suave", texto: `Diferencia de oro del equipo, minuto a minuto (arriba, por delante). Al final, ${conSigno(ultimo)}.` }));
  }

  function textoClip(cat, c) {
    const quien = nombreCampeon(cat, c.quien);
    const otro = c.otro ? nombreCampeon(cat, c.otro) : "";
    switch (c.tipo) {
      case "execute": return `${quien} muere de execute (torre, minions o un monstruo)`;
      case "dive": return `${quien} se come la torre al morir (${c.dato} % del daño)${otro ? `; la kill, de ${otro}` : ""}`;
      case "temprana": return `kill a ${quien} antes del 2:00${otro ? `, de ${otro}` : ""}`;
      case "shutdown": return `shutdown de ${numero(c.dato)} sobre ${quien}${otro ? `, de ${otro}` : ""}`;
      case "oneshot": return `${quien} muere de una habilidad${c.dato ? ` (la ${c.dato})` : ""} de ${otro}`;
      case "multikill": return `${{ 3: "triple", 4: "quadra", 5: "penta" }[c.dato] || "multikill"} de ${quien}`;
      case "ace": return `ace de ${quien}`;
      case "robo": return `${quien} roba ${c.dato === "larvas" ? "las" : "el"} ${c.dato} (probable: Riot no dice cuál)`;
      default: return c.tipo;
    }
  }

  const RAREZA = {
    un_digito: "sobrevive con menos de 10 de vida",
    aguanta_a_cinco: "se come el daño de los cinco y sobrevive",
    multikill_una_habilidad: "multikill con una sola habilidad",
    robo_sin_smite: "roba un objetivo sin Smite",
    en_inferioridad: "kills en inferioridad numérica",
    pings_desaparecido: "pings de «desaparecido»",
  };

  /** La hoja entera. `hoja` es lo que devuelve `riot/hoja`; `nivel`, el de
   *  los títulos de sus apartados (uno más que el de la partida). */
  function vistaHoja(cat, hoja, nivel = 5) {
    const campeon = (k) => vistaCampeon(cat, k, { tam: "mini" });
    const bloque = (titulo, ...cosas) => h("section", { clase: "bloque-hoja" }, h(`h${nivel}`, { clase: "titulo-hoja", texto: titulo }), ...cosas);
    const partes = [];

    partes.push(h("p", { clase: "texto-suave cabeza-hoja" },
      `Lado ${hoja.lado} · ${hoja.gano ? "ganada" : "perdida"} · ${minutos(hoja.duracion)}`,
      hoja.parche ? ` · parche ${parcheTexto(hoja.parche)}` : "",
      hoja.remake ? " · remake" : ""));

    if (hoja.linea.length) {
      // En el móvil la tabla se apila (cada fila, una ficha) y cada celda lleva
      // delante el nombre de su columna (`data-etiqueta`, como en las guías).
      const cifras = (a, min) => (a
        ? [["Oro", a.oro], ["XP", a.xp], ["CS", a.cs]].map(([t, n]) => h("td", { "data-etiqueta": `${t} a los ${min}` }, cifraLinea(n)))
        : [h("td", { colspan: 3, "data-etiqueta": `A los ${min}`, clase: "texto-suave", texto: "la partida no llegó" })]);
      const filas = hoja.linea.map((l) => h("tr", {},
        h("td", { texto: NOMBRE_PUESTO[l.puesto] || "" }),
        h("td", { "data-etiqueta": "Nosotros" }, campeon(l.nuestro)), h("td", { "data-etiqueta": "Enfrente" }, campeon(l.suyo)),
        ...cifras(l.a10, 10), ...cifras(l.a15, 15)));
      partes.push(bloque("La línea, contra el de enfrente",
        h("div", { clase: "tabla-envoltura apilable tabla-hoja" }, h("table", {},
          h("thead", {},
            h("tr", {}, ...["Puesto", "Nosotros", "Enfrente"].map((t) => h("th", { scope: "col", rowspan: 2, texto: t })),
              h("th", { scope: "colgroup", colspan: 3, texto: "A los 10" }), h("th", { scope: "colgroup", colspan: 3, texto: "A los 15" })),
            h("tr", {}, ...["Oro", "XP", "CS", "Oro", "XP", "CS"].map((t) => h("th", { scope: "col", texto: t })))),
          h("tbody", {}, filas)))));
    }

    const graf = graficoOro(hoja.oro);
    if (graf) partes.push(bloque("El oro", graf));

    if (hoja.inflexiones.length) {
      partes.push(bloque("Donde se movió la partida",
        h("ul", { clase: "lista" }, hoja.inflexiones.map((x) => h("li", {},
          h("strong", { texto: `Del ${x.desde} al ${x.hasta}: ${conSigno(x.oro)} de oro` }),
          ` · kills ${x.aFavor}–${x.enContra}`,
          x.objetivos.length ? ` · ${x.objetivos.map((o) => `${o.tipo} (${QUIEN(o.nuestro)})`).join(", ")}` : "")))));
    }

    const mu = hoja.muertes;
    if (mu.total) {
      const lista = h("ul", { clase: "lista lista-muertes" }, mu.lista.map((d) => h("li", {},
        h("strong", { texto: MIN(d.t) }), " ", campeon(d.campeon),
        d.zona ? ` en ${d.zona}` : "",
        d.asesino ? h("span", {}, " · la kill, de ", campeon(d.asesino)) : " · execute",
        d.aislada ? h("span", { clase: "etiqueta gris", texto: "aislada" }) : null,
        d.cara.length ? h("span", { clase: "etiqueta ambar", texto: `después cae: ${d.cara.join(", ")}` }) : null,
        d.shutdown ? ` · shutdown de ${numero(d.shutdown)}` : "",
        d.oro != null && d.oro >= 1300 ? ` · llevaba unos ${numero(Math.round(d.oro / 100) * 100)} de oro sin gastar` : "")));
      const detalles = h("details", { clase: "detalles-hoja" }, h("summary", { texto: mu.lista.length < mu.total ? `Las ${mu.lista.length} primeras, una a una` : `Las ${mu.lista.length} muertes, una a una` }), lista);
      partes.push(bloque("Nuestras muertes",
        h("p", {}, `${plural(mu.total, "muerte", "muertes")}: ${numero(mu.antesDel15)} antes del 15, ${numero(mu.aisladas)} aisladas (sin nadie más peleando cerca) y ${numero(mu.caras)} con un objetivo del rival justo después.`),
        detalles));
    }

    if (hoja.peleas.length) {
      partes.push(bloque("Las teamfights",
        h("ul", { clase: "lista" }, hoja.peleas.map((p) => h("li", {},
          h("strong", { texto: MIN(p.t) }), p.zona ? ` en ${p.zona}` : "",
          " · ", h("span", { clase: `cifra-hoja ${p.aFavor > p.enContra ? "gana" : p.aFavor < p.enContra ? "pierde" : ""}`.trim(), texto: `${p.aFavor}–${p.enContra}` }),
          p.despues.length ? ` · después: ${p.despues.map((o) => `${o.tipo} (${QUIEN(o.nuestro)})`).join(", ")}` : "")))));
    }

    if (hoja.objetivos.length) {
      const de = (nuestro) => hoja.objetivos.filter((o) => o.nuestro === nuestro && !/^torre|^inhibidor/.test(o.tipo));
      const torres = (nuestro) => hoja.objetivos.filter((o) => o.nuestro === nuestro && /^torre|^inhibidor/.test(o.tipo)).length;
      const linea = (nuestro) => h("p", {}, h("strong", { texto: nuestro ? "Nosotros: " : "Ellos: " }),
        de(nuestro).map((o) => `${o.tipo} (${MIN(o.t)})`).join(", ") || "ningún objetivo neutral",
        ` · ${plural(torres(nuestro), "torre o inhibidor", "torres e inhibidores")}`);
      partes.push(bloque("Los objetivos", linea(true), linea(false)));
    }

    if (hoja.clips.length) {
      const propios = hoja.clips.filter((c) => c.nuestro);
      partes.push(bloque("Candidatos a clip",
        h("p", { clase: "ayuda", texto: "Salen de los datos, así que casi todos son jugadas épicas: lo gracioso de verdad (el Flash contra la pared, la ulti al vacío) no deja rastro. Lo que merezca la biblioteca, apuntadlo en «Qué salió bien» o «Qué salió mal» con su minuto." }),
        h("ul", { clase: "lista" }, hoja.clips.map((c) => h("li", { clase: c.nuestro ? "" : "texto-suave" },
          h("strong", { texto: MIN(c.t) }), ` · ${textoClip(cat, c)}`, c.nuestro ? "" : " (ellos)"))),
        propios.length ? null : h("p", { clase: "texto-suave", texto: "Ninguno vuestro en esta partida." })));
    }

    if (hoja.rarezas.length) {
      partes.push(bloque("Rarezas de la partida",
        h("ul", { clase: "lista" }, hoja.rarezas.map((r) => h("li", { clase: r.nuestro ? "" : "texto-suave" },
          campeon(r.quien), ` ${RAREZA[r.tipo] || r.tipo}${r.veces > 1 ? ` (${numero(r.veces)})` : ""}`, r.nuestro ? "" : " (ellos)")))));
    }

    partes.push(h("p", { clase: "ayuda pie-hoja", texto: "Sale de los datos de Riot de la partida: una foto por minuto, así que las zonas son aproximadas. No sabe dónde estaban las wards, ni el estado de las waves, ni cuándo se usó cada Flash. Dice qué pasó; el porqué lo ponéis vosotros." }));
    return h("div", { clase: "hoja" }, partes);
  }

  /** El botón que trae la hoja de una partida y la pinta debajo (`nivel`: el
   *  de los títulos de la hoja). */
  function botonHoja(cat, ref, nivel) {
    if (!ref) return null;
    const caja = h("div", { clase: "hueco-hoja" });
    const eco = h("p", { clase: "eco", "aria-live": "polite" });
    const boton = h("button", { type: "button", clase: "boton pequeno", texto: "Ver la hoja automática" });
    boton.addEventListener("click", async () => {
      if (caja.firstChild) {
        caja.hidden = !caja.hidden;
        boton.textContent = caja.hidden ? "Ver la hoja automática" : "Ocultar la hoja";
        return;
      }
      boton.disabled = true;
      eco.classList.remove("mal");
      eco.textContent = "Pidiendo la partida a Riot…";
      try {
        const r = await conEspera(() => api("riot/hoja", { ref }), (s) => { eco.textContent = `Riot pide esperar: seguimos en ${s} s…`; });
        if (r.sinTimeline) {
          eco.textContent = "Riot no tiene el timeline de esta partida, así que no hay hoja.";
        } else {
          eco.textContent = "";
          caja.replaceChildren(vistaHoja(cat, r.hoja, nivel));
          boton.textContent = "Ocultar la hoja";
        }
      } catch (e) {
        eco.textContent = e.message;
        eco.classList.add("mal");
      } finally {
        boton.disabled = false;
      }
    });
    return h("div", { clase: "bloque-cosa" }, h("p", {}, boton), eco, caja);
  }

  // ==================================================================== repaso del Clash

  async function paginaRepaso() {
    const lista = $("[data-lista]");
    const hueco = $("[data-formulario]");
    const lecciones = $("[data-lecciones]");
    const bloqueLecciones = $("[data-lecciones-bloque]");
    const [quien, cat] = await Promise.all([yo(), catalogoONada()]);
    let repasos = [];
    const ctx = {
      yo: quien,
      conTipo: false,
      cuerpo: (c) => cuerpoRepaso(c, cat),
      actualizar: (nueva) => { repasos = repasos.map((x) => (x.id === nueva.id ? nueva : x)); },
      quitar: (id) => { repasos = repasos.filter((x) => x.id !== id); pintar(); },
      editar: (c) => abrir(c),
    };
    function pintar() {
      repasos.sort((a, b) => b.datos.fecha.localeCompare(a.datos.fecha) || b.creado - a.creado);
      lista.replaceChildren(repasos.length
        ? h("div", { clase: "cosas" }, repasos.map((r) => tarjeta(r, ctx)))
        : h("p", { clase: "texto-suave", texto: "Aún no hay repasos. Después del próximo Clash, haced el primero." }));
      const todas = repasos.flatMap((r) => r.datos.lecciones.map((l) => ({ l, fecha: r.datos.fecha })));
      bloqueLecciones.hidden = !todas.length;
      lecciones.replaceChildren(...todas.map((x) => h("li", {}, x.l, h("span", { clase: "texto-suave", texto: ` (${diaTexto(x.fecha)})` }))));
    }
    function abrir(c = null) {
      if (!cat) {
        avisar("No se han podido cargar los campeones de Riot (Data Dragon). Revisa la conexión y recarga.", { recargar: true });
        return;
      }
      const cerrar = () => { hueco.hidden = true; hueco.replaceChildren(); };
      hueco.hidden = false;
      hueco.replaceChildren(formularioRepaso(cat, c, quien, (guardado) => {
        cerrar();
        repasos = c ? repasos.map((x) => (x.id === guardado.id ? guardado : x)) : [guardado, ...repasos];
        pintar();
      }, cerrar));
      hueco.scrollIntoView({ block: "start" });
    }
    $("[data-nuevo]").addEventListener("click", () => abrir(null));
    try {
      repasos = (await api("cosas?tipo=repaso")).cosas;
      pintar();
    } catch (e) {
      lista.replaceChildren(h("p", { clase: "mensaje mal", texto: e.message }));
      if (e.red || e.sinPase) mostrarError(e);
    }
  }

  function cuerpoRepaso(c, cat) {
    const d = c.datos;
    const ganadas = d.partidas.filter((p) => p.gano === true).length;
    const jugadas = d.partidas.filter((p) => p.gano != null).length;
    const resto = d.partidas.map((p, i) => h("section", { clase: "partida-repaso" },
      h("h4", {}, `Partida ${i + 1}`, p.lado ? ` · lado ${p.lado}` : "",
        p.gano != null ? h("span", { clase: `resultado ${p.gano ? "gana" : "pierde"}`, texto: p.gano ? " · ganada" : " · perdida" }) : null,
        p.duracion ? ` · ${minutos(p.duracion)}` : ""),
      p.nuestros.length || p.suyos.length ? h("div", { clase: "drafts-partida" },
        h("div", { clase: `draft-lado ${p.lado === "rojo" ? "rojo" : "azul"}` }, h("h4", { texto: "Nosotros" }), h("ul", { clase: "iconos" }, p.nuestros.map((x) => h("li", {}, vistaCampeon(cat, x.campeon, { tam: "mini" }), x.puesto ? h("span", { clase: "texto-suave", texto: NOMBRE_PUESTO[x.puesto] }) : null)))),
        h("div", { clase: `draft-lado ${p.lado === "rojo" ? "azul" : "rojo"}` }, h("h4", { texto: "Ellos" }), h("ul", { clase: "iconos" }, p.suyos.map((x) => h("li", {}, vistaCampeon(cat, x.campeon, { tam: "mini" }), x.puesto ? h("span", { clase: "texto-suave", texto: NOMBRE_PUESTO[x.puesto] }) : null))))) : null,
      p.bien ? h("p", { clase: "texto" }, h("strong", { texto: "Bien: " }), p.bien) : null,
      p.mal ? h("p", { clase: "texto" }, h("strong", { texto: "Mal: " }), p.mal) : null,
      p.app ? h("p", { clase: "texto" }, h("strong", { texto: "La app: " }), p.app) : null,
      botonHoja(cat, p.ref, 5)));
    if (d.lecciones.length) resto.push(h("div", { clase: "bloque-cosa" }, h("h4", { texto: "Lecciones" }), h("ul", { clase: "lista" }, d.lecciones.map((l) => h("li", { texto: l })))));
    if (d.video && /^https:\/\//.test(d.video)) {
      let sitio = "";
      try { sitio = new URL(d.video).hostname.replace(/^www\./, ""); } catch { /* el servidor ya lo comprobó */ }
      resto.push(h("p", {}, h("a", { href: d.video, target: "_blank", rel: "noopener noreferrer", texto: `Ver el vídeo${sitio ? ` (${sitio})` : ""}` })));
    }
    if (d.nota) resto.push(h("p", { clase: "texto", texto: d.nota }));
    return {
      titulo: h("h3", { texto: `${d.cola === "flex" ? "Flex" : "Clash"} del ${diaTexto(d.fecha)}${d.rival ? ` contra ${d.rival}` : ""}${jugadas ? ` · ${ganadas} de ${jugadas} ganadas` : ""}` }),
      resto,
    };
  }

  function formularioRepaso(cat, c, quien, alGuardar, alCancelar) {
    const d = c ? c.datos : { partidas: [], lecciones: [] };
    const fecha = h("input", { type: "date", id: nuevoId("f"), value: d.fecha || hoyIso() });
    const cola = selector([["clash", "Clash"], ["flex", "Flex"]], d.cola || "clash");
    const rival = entradaTexto({ valor: d.rival || "", max: 80, placeholder: "El nombre de su equipo" });
    const cajaPartidas = h("div", { clase: "formulario" });
    const partidas = [];

    const nuevaPartida = (p = {}) => {
      const n = partidas.length + 1;
      const lado = selector([["azul", "Azul"], ["rojo", "Rojo"]], p.lado || "", { vacio: "—" });
      const res = selector([["si", "Ganada"], ["no", "Perdida"]], p.gano == null ? "" : p.gano ? "si" : "no", { vacio: "—" });
      const porPuesto = (lista) => Object.fromEntries((lista || []).map((x) => [x.puesto, x.campeon]));
      const nuestros = porPuesto(p.nuestros);
      const suyos = porPuesto(p.suyos);
      const sinPuesto = (lista) => (lista || []).filter((x) => !x.puesto).map((x) => x.campeon);
      const libresN = sinPuesto(p.nuestros);
      const libresS = sinPuesto(p.suyos);
      const camposN = PUESTOS.map(([pu, t], i) => ({ pu, campo: campoCampeon(cat, t, nuestros[pu] || libresN[i] || null) }));
      const camposS = PUESTOS.map(([pu, t], i) => ({ pu, campo: campoCampeon(cat, t, suyos[pu] || libresS[i] || null) }));
      const bien = areaTexto({ valor: p.bien || "", max: 1500, corto: true });
      const mal = areaTexto({ valor: p.mal || "", max: 1500, corto: true });
      const app = areaTexto({ valor: p.app || "", max: 1000, corto: true });
      const quitar = h("button", { type: "button", clase: "enlace peligro", texto: "Quitar esta partida" });
      const caja = h("div", { clase: "partida-form" },
        h("h3", { texto: `Partida ${n}` }),
        h("div", { clase: "fila-campos" }, campo("Lado", lado), campo("Resultado", res)),
        h("div", { clase: "fila-campos" },
          h("fieldset", { clase: "opciones" }, h("legend", { texto: "Nuestros campeones" }), camposN.map((x) => x.campo.caja)),
          h("fieldset", { clase: "opciones" }, h("legend", { texto: "Los suyos" }), camposS.map((x) => x.campo.caja))),
        campo("Qué salió bien", bien),
        campo("Qué salió mal", mal),
        campo("Qué dijo la app y si acertó", app, { ayuda: "La lectura del draft, el plan que propuso…" }),
        botonHoja(cat, p.ref, 4),
        h("p", {}, quitar));
      const item = { caja, lado, res, camposN, camposS, bien, mal, app, duracion: p.duracion ?? null, ref: p.ref || "" };
      quitar.addEventListener("click", () => {
        partidas.splice(partidas.indexOf(item), 1);
        caja.remove();
        partidas.forEach((x, i) => { x.caja.querySelector("h3").textContent = `Partida ${i + 1}`; });
      });
      partidas.push(item);
      cajaPartidas.append(caja);
    };
    (d.partidas.length ? d.partidas : [{}]).forEach(nuevaPartida);

    const mas = h("button", { type: "button", clase: "boton pequeno", texto: "Otra partida", onclick: () => { if (partidas.length < 6) nuevaPartida(); } });
    const traer = h("button", { type: "button", clase: "boton pequeno", texto: "Traer las partidas de ese día" });
    const ecoTraer = h("p", { clase: "eco", "aria-live": "polite" });
    traer.hidden = !quien.riot;
    traer.addEventListener("click", async () => {
      traer.disabled = true;
      ecoTraer.classList.remove("mal");
      ecoTraer.textContent = "Preguntando a Riot…";
      try {
        const r = await conEspera(() => api("riot/clash-del-dia", { fecha: fecha.value, cola: cola.value }), (s) => { ecoTraer.textContent = `Riot pide esperar: seguimos en ${s} s…`; });
        if (!r.partidas.length) {
          ecoTraer.textContent = `Ese día no hay partidas de ${cola.value === "flex" ? "Flex" : "Clash"} con tu cuenta (la de tu perfil).`;
        } else {
          partidas.splice(0).forEach((x) => x.caja.remove());
          r.partidas.forEach(nuevaPartida);
          ecoTraer.textContent = `${r.partidas.length === 1 ? "Traída 1 partida" : `Traídas ${r.partidas.length} partidas`}: cada una trae su hoja automática. Completa lo que salió bien y mal.`;
        }
      } catch (e) {
        ecoTraer.textContent = e.message;
        ecoTraer.classList.add("mal");
      } finally {
        traer.disabled = false;
      }
    });

    const lecciones = areaTexto({ valor: (d.lecciones || []).join("\n"), max: 2200 });
    const video = h("input", { type: "url", id: nuevoId("v"), value: d.video || "", maxlength: 300, placeholder: "https://…", autocomplete: "off" });
    const nota = areaTexto({ valor: d.nota || "", max: 2000, corto: true });
    const pie = pieFormulario(c ? "Guardar los cambios" : "Publicar el repaso", alCancelar);
    const f = h("form", { clase: "formulario-zona", novalidate: true },
      h("h2", { texto: c ? "Cambiar el repaso" : "Repaso de un Clash o de unas Flex" }),
      h("div", { clase: "fila-campos" }, campo("Día", fecha), campo("Cola", cola), campo("Rival", rival)),
      h("div", {}, h("p", {}, traer), ecoTraer, !quien.riot ? h("p", { clase: "ayuda", texto: "Para traer las partidas solas hace falta la clave de Riot en Cloudflare." }) : null),
      cajaPartidas,
      h("p", {}, mas),
      campo("Lecciones", lecciones, { ayuda: "Una por línea (hasta diez): lo que haríais distinto la próxima vez." }),
      campo("Enlace al vídeo (si lo hay)", video, { ayuda: "YouTube, Twitch o donde esté grabado." }),
      campo("Nota", nota),
      pie.nodos);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      for (const p of partidas) {
        for (const x of [...p.camposN, ...p.camposS]) if (!x.campo.comprobar(false)) return pie.mal("Hay un campeón que no se reconoce: corrígelo o déjalo vacío.");
      }
      const fila = (lista) => lista.filter((x) => x.campo.valor).map((x) => ({ campeon: x.campo.valor, puesto: x.pu }));
      const datos = {
        fecha: fecha.value,
        cola: cola.value,
        rival: rival.value,
        partidas: partidas.map((p) => ({
          ref: p.ref,
          lado: p.lado.value,
          gano: p.res.value === "" ? null : p.res.value === "si",
          duracion: p.duracion,
          nuestros: fila(p.camposN),
          suyos: fila(p.camposS),
          bien: p.bien.value,
          mal: p.mal.value,
          app: p.app.value,
        })),
        lecciones: lecciones.value.split("\n").map((x) => x.trim()).filter(Boolean),
        video: video.value.trim(),
        nota: nota.value,
      };
      if (datos.lecciones.length > 10) return pie.mal("Lecciones: como mucho diez.");
      const r = await enviando(pie, () => (c ? api(`cosas/${c.id}`, { datos }) : api("cosas", { tipo: "repaso", datos })));
      if (r) alGuardar(r.cosa);
    });
    return f;
  }

  /** Si Riot pide esperar (429 con `esperaMs`), espera contando y lo vuelve a intentar. */
  async function conEspera(fn, alContar) {
    for (let intento = 0; intento < 6; intento++) {
      try {
        return await fn();
      } catch (e) {
        if (!(e.estado === 429 && e.esperaMs)) throw e;
        let s = Math.ceil(Math.min(e.esperaMs, 130_000) / 1000);
        while (s > 0) {
          alContar(s);
          await new Promise((r) => setTimeout(r, 1000));
          s -= 1;
        }
      }
    }
    throw new ErrorZona("Riot sigue pidiendo esperar. Prueba dentro de un par de minutos.");
  }

  // ==================================================================== scouting

  const TIER = { IRON: "Hierro", BRONZE: "Bronce", SILVER: "Plata", GOLD: "Oro", PLATINUM: "Platino", EMERALD: "Esmeralda", DIAMOND: "Diamante", MASTER: "Maestro", GRANDMASTER: "Gran Maestro", CHALLENGER: "Aspirante" };
  const COLA = { RANKED_SOLO_5x5: "Solo/Dúo", RANKED_FLEX_SR: "Flexible" };
  const COLA_ID = { 420: "Solo/Dúo", 440: "Flexible", 700: "Clash" };

  async function paginaScouting() {
    const quien = await yo();
    const buscar = $("[data-buscar]");
    const cinco = $("[data-buscar-cinco]");
    const progreso = $("[data-progreso]");
    const resultado = $("[data-resultado]");
    const decir = (t) => { progreso.hidden = !t; progreso.textContent = t || ""; };

    if (!quien.riot) {
      decir("");
      buscar.replaceWith(h("div", { clase: "aviso ambar" }, h("p", { texto: "El scouting necesita la clave de la API de Riot en Cloudflare (el secreto RIOT_KEY). Pídeselo al equipo oficinista de desarrollo." })));
      cinco.remove();
      return;
    }
    const cat = await catalogoONada();

    $("[data-a-mano]").addEventListener("click", () => {
      cinco.hidden = !cinco.hidden;
      if (!cinco.hidden) $("input", cinco).focus();
    });

    const ocupado = (si) => $$("button", buscar).concat($$("button", cinco)).forEach((b) => { b.disabled = si; });

    async function scoutear(equipo) {
      resultado.hidden = false;
      const cabeza = h("div", { clase: "equipo-rival" },
        h("h2", { texto: equipo.aMano ? "El rival (escrito a mano)" : `${equipo.nombre}${equipo.abreviatura ? ` [${equipo.abreviatura}]` : ""}` }),
        equipo.nivel ? h("p", { clase: "texto-suave", texto: `Nivel ${equipo.nivel} de Clash` }) : null);
      const rejilla = h("div", { clase: "jugadores-rival" });
      const bans = h("div", { clase: "bloque-cosa" });
      resultado.replaceChildren(h("div", { clase: "envoltura" }, cabeza, rejilla, bans));
      const vistos = [];
      for (const [i, j] of equipo.jugadores.entries()) {
        const caja = h("article", { clase: "cosa jugador-rival" }, h("p", { clase: "texto-suave", texto: `Cargando a ${j.riotId || "este jugador"}…` }));
        rejilla.append(caja);
        let datos = null;
        for (;;) {
          decir(`Mirando a los ${equipo.jugadores.length}: ${i + 1} de ${equipo.jugadores.length} (${j.riotId || "sin Riot ID"})…`);
          datos = await conEspera(() => api("scouting/jugador", { puuid: j.puuid }), (s) => decir(`Riot nos deja 100 consultas cada dos minutos: seguimos en ${s} s…`));
          if (!datos.quedan) break;
        }
        vistos.push({ j, datos });
        caja.replaceWith(fichaRival(cat, j, datos));
      }
      decir("");
      pintarBans(cat, bans, vistos);
    }

    async function lanzar(fn) {
      quitarAviso();
      ocupado(true);
      try {
        const r = await fn();
        if (r.noEnClash) {
          decir("");
          cinco.hidden = false;
          avisar(`${r.riotId} no está apuntado a ningún Clash ahora mismo. Escribe los Riot ID del rival a mano.`);
          $("input", cinco).value = r.riotId;
          return;
        }
        if (r.faltan && r.faltan.length) avisar(`No encuentro: ${r.faltan.join(", ")}. Sigo con los demás.`);
        await scoutear(r.equipo);
        cargarRecientes();
      } catch (e) {
        decir("");
        mostrarError(e);
      } finally {
        ocupado(false);
      }
    }

    buscar.addEventListener("submit", (e) => {
      e.preventDefault();
      const riotId = $("#s-riot").value.trim();
      if (!riotId) return;
      decir(`Buscando a ${riotId}…`);
      lanzar(() => conEspera(() => api("scouting/equipo", { riotId }), (s) => decir(`Riot pide esperar: seguimos en ${s} s…`)));
    });
    cinco.addEventListener("submit", (e) => {
      e.preventDefault();
      const riotIds = $$("input", cinco).map((x) => x.value.trim()).filter(Boolean);
      if (!riotIds.length) return;
      decir("Buscando sus cuentas…");
      lanzar(() => conEspera(() => api("scouting/a-mano", { riotIds }), (s) => decir(`Riot pide esperar: seguimos en ${s} s…`)));
    });

    async function cargarRecientes() {
      try {
        const r = await api("scouting/recientes");
        const lista = $("[data-recientes]");
        $("[data-recientes-bloque]").hidden = !r.equipos.length;
        lista.replaceChildren(...r.equipos.map((e) => h("li", {},
          h("button", {
            type: "button",
            clase: "enlace",
            texto: e.nombre ? `${e.nombre}${e.abreviatura ? ` [${e.abreviatura}]` : ""}` : `Escrito a mano (${e.jugadores} jugadores)`,
            onclick: async () => {
              // Volver a mirar: sale de lo guardado, sin gastar consultas a Riot
              // mientras no caduque.
              quitarAviso();
              ocupado(true);
              try {
                await lanzarGuardado(e.id);
              } catch (err) {
                decir("");
                mostrarError(err);
              } finally {
                ocupado(false);
              }
            },
          }),
          h("span", { clase: "texto-suave", texto: ` · ${cuando(e.guardado)}` }))));
      } catch { /* sin la lista no pasa nada */ }
    }
    async function lanzarGuardado(id) {
      const r = await api("scouting/guardado", { id });
      await scoutear(r.equipo);
    }
    cargarRecientes();
  }

  function fichaRival(cat, j, datos) {
    const partidas = datos.partidas.filter((p) => !p.remake);
    const porCampeon = new Map();
    const porPuesto = new Map();
    for (const p of partidas) {
      const x = porCampeon.get(p.campeon) || { campeon: p.campeon, n: 0, g: 0 };
      x.n += 1;
      x.g += p.gano ? 1 : 0;
      porCampeon.set(p.campeon, x);
      if (p.puesto) porPuesto.set(p.puesto, (porPuesto.get(p.puesto) || 0) + 1);
    }
    const masJugados = [...porCampeon.values()].sort((a, b) => b.n - a.n || b.g - a.g);
    const puestos = [...porPuesto.entries()].sort((a, b) => b[1] - a[1]);
    const solo = datos.rangos.find((r) => r.cola === "RANKED_SOLO_5x5");
    const flex = datos.rangos.find((r) => r.cola === "RANKED_FLEX_SR");
    const rango = (r) => `${COLA[r.cola]}: ${TIER[r.tier] || r.tier}${["MASTER", "GRANDMASTER", "CHALLENGER"].includes(r.tier) ? "" : ` ${r.division}`} · ${numero(r.lp)} LP · ${r.victorias} victorias y ${r.derrotas} derrotas`;

    return h("article", { clase: "cosa jugador-rival" },
      h("div", { clase: "etiquetas-cosa" },
        h("span", { clase: "etiqueta", texto: j.puesto ? NOMBRE_PUESTO[j.puesto] : "Sin puesto" }),
        j.capitan ? h("span", { clase: "etiqueta tipo", texto: "Capitán" }) : null),
      h("h3", { texto: j.riotId || "Sin Riot ID" }),
      h("dl", {},
        h("dt", { texto: "Rango" }),
        solo || flex ? [solo, flex].filter(Boolean).map((r) => h("dd", { texto: rango(r) })) : h("dd", { texto: "Sin clasificar esta temporada" }),
        h("dt", { texto: partidas.length === 1 ? "Su última partida (Solo/Dúo o Clash)" : `Sus últimas ${partidas.length} partidas (Solo/Dúo y Clash)` }),
        partidas.length
          ? [h("dd", {}, h("ul", { clase: "lista-simple" }, masJugados.slice(0, 6).map((x) => h("li", { clase: "fila-icono" }, vistaCampeon(cat, x.campeon, { tam: "mini" }),
            h("span", { clase: "texto-suave", texto: `${plural(x.n, "partida", "partidas")}, ${plural(x.g, "ganada", "ganadas")}` }))))),
            puestos.length ? h("dd", { clase: "texto-suave", texto: `Por puesto: ${puestos.map(([p, n]) => `${NOMBRE_PUESTO[p]} ${n}`).join(", ")} (de ${partidas.length})` }) : null]
          : h("dd", { texto: "No hay partidas recientes." }),
        h("dt", { texto: "Con más maestría" }),
        datos.maestria.length
          ? h("dd", {}, h("ul", { clase: "lista-simple" }, datos.maestria.slice(0, 5).map((m) => h("li", { clase: "fila-icono" }, vistaCampeon(cat, m.campeon, { tam: "mini" }), h("span", { clase: "texto-suave", texto: `${numero(m.puntos)} puntos` })))))
          : h("dd", { texto: "Sin datos de maestría." })),
      partidas.length ? h("details", {}, h("summary", { texto: "Partida a partida" }),
        h("ul", { clase: "lista-simple" }, partidas.map((p) => h("li", { clase: "texto-suave" },
          `${cuando(p.creada)} · ${COLA_ID[p.cola] || "Otra cola"} · `, h("strong", { clase: "texto-normal", texto: nombreCampeon(cat, p.campeon) }),
          p.puesto ? ` (${NOMBRE_PUESTO[p.puesto]})` : "", ` · ${p.gano ? "ganó" : "perdió"} · ${p.k}/${p.d}/${p.a}`)))) : null);
  }

  /**
   * «Para pensar los bans»: en qué se apoya cada uno, con su muestra. No es
   * una recomendación: es lo que más juegan, y decide el equipo.
   */
  function pintarBans(cat, caja, vistos) {
    const quien = (j) => `${j.riotId || "Uno del rival"}${j.puesto ? ` (${NOMBRE_PUESTO[j.puesto]})` : ""}`;
    const filas = [];
    for (const { j, datos } of vistos) {
      const partidas = datos.partidas.filter((p) => !p.remake);
      const cuenta = new Map();
      for (const p of partidas) {
        const x = cuenta.get(p.campeon) || { n: 0, g: 0 };
        x.n += 1;
        x.g += p.gano ? 1 : 0;
        cuenta.set(p.campeon, x);
      }
      const top = [...cuenta.entries()].sort((a, b) => b[1].n - a[1].n)[0];
      const maestria = datos.maestria[0];
      if (top && top[1].n >= 2) {
        const m = datos.maestria.find((x) => x.campeon === top[0]);
        filas.push({ campeon: top[0], n: top[1].n, texto: `${quien(j)}: ${top[1].n} de sus últimas ${partidas.length} partidas, ${plural(top[1].g, "ganada", "ganadas")}${m ? `; ${numero(m.puntos)} puntos de maestría` : ""}.` });
      }
      if (maestria && (!top || maestria.campeon !== top[0])) {
        const enRecientes = cuenta.get(maestria.campeon);
        filas.push({ campeon: maestria.campeon, n: enRecientes ? enRecientes.n : 0, texto: `${quien(j)}: su campeón con más maestría (${numero(maestria.puntos)} puntos)${enRecientes ? `, ${enRecientes.n} de sus últimas ${partidas.length} partidas` : ", aunque no sale en sus últimas partidas"}.` });
      }
    }
    filas.sort((a, b) => b.n - a.n);
    caja.replaceChildren(
      h("h3", { texto: "Para pensar los bans" }),
      h("p", { clase: "texto-suave", texto: "En qué se apoya cada uno, con su muestra. No es una orden: lo decidís vosotros." }),
      filas.length
        ? h("ul", { clase: "lista-simple bans-posibles" }, filas.slice(0, 8).map((f) => {
          const c = cat && cat.campeones.get(f.campeon);
          return h("li", { clase: "fila-icono" }, c ? icono(c.img, "", "mini") : null,
            h("span", {}, h("strong", { texto: nombreCampeon(cat, f.campeon) }), ` — ${f.texto}`));
        }))
        : h("p", { texto: "No hay datos suficientes para decir nada." }));
  }

  // ==================================================================== perfil, miembros e inicio

  function formularioPerfil(quien, alGuardar) {
    const nick = entradaTexto({ valor: quien.nick || "", max: 24 });
    const riot = entradaTexto({ valor: quien.riotId || "", max: 40, placeholder: "Nombre#TAG" });
    riot.setAttribute("autocapitalize", "off");
    riot.setAttribute("spellcheck", "false");
    const puesto = selector(PUESTOS, quien.puesto || "", { vacio: "Sin puesto fijo" });
    const pie = pieFormulario("Guardar");
    const f = h("form", { clase: "formulario-zona", novalidate: true },
      h("div", { clase: "fila-campos tres" }, campo("Nick", nick), campo("Riot ID", riot), campo("Puesto", puesto)),
      h("p", { clase: "ayuda", texto: "El nick es como te ve el equipo. El Riot ID (Nombre#TAG) sirve para traer vuestras partidas de Clash o de Flex al repaso, con su hoja automática, y para ver las builds que lleváis de verdad." }),
      pie.nodos);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await enviando(pie, () => api("yo", { nick: nick.value, riotId: riot.value, puesto: puesto.value }));
      if (r) {
        promesaYo = null;
        alGuardar(r.perfil);
      }
    });
    return f;
  }

  async function paginaInicio() {
    const quien = await yo();
    const titulo = $("[data-titulo]");
    if (quien.nick) titulo.textContent = `Hola, ${quien.nick}`;
    const bloque = $("[data-bloque=perfil]");
    if (quien.nuevo) {
      bloque.hidden = false;
      $("[data-perfil]", bloque).replaceChildren(formularioPerfil(quien, (p) => {
        titulo.textContent = `Hola, ${p.nick}`;
        bloque.replaceChildren(h("div", { clase: "envoltura" }, h("p", { clase: "mensaje ok", texto: "Guardado. Ya puedes usar la zona." })));
      }));
    }
    const r = quien.resumen || {};
    const t = r.porTipo || {};
    const dato = (clave, texto) => { const el = $(`[data-dato="${clave}"]`); if (el && texto) el.textContent = texto; };
    const suma = (o, claves) => claves.reduce((s, k) => s + ((o || {})[k] || 0), 0);
    if (r.plan) dato("plan", `Último: ${diaTexto(r.plan.fecha)}${r.plan.rival ? ` contra ${r.plan.rival}` : ""}`);
    if (r.scouting) dato("scouting", `${plural(r.scouting, "equipo mirado", "equipos mirados")} estos siete días`);
    const repasos = suma(t.repaso, ["todas"]);
    if (repasos) dato("repaso", plural(repasos, "repaso", "repasos"));
    const builds = suma(t.build, ["propuesta", "aceptada"]);
    const aceptadas = (t.build || {}).aceptada || 0;
    if (builds) dato("build", `${plural(builds, "build", "builds")}, ${plural(aceptadas, "aceptada", "aceptadas")}`);
    const apuntes = suma(t.apunte, ["nuevo", "en-la-app"]);
    if (apuntes) dato("apunte", plural(apuntes, "apunte", "apuntes"));
    const abiertas = suma(t.idea, ["nueva", "mirando"]) + suma(t.draft, ["pendiente"]);
    if (abiertas) dato("idea", plural(abiertas, "abierta", "abiertas"));
    if (!quien.riot) dato("scouting", "Falta la clave de Riot en Cloudflare");
    prepararInstalar();
  }

  /**
   * Para un capitán: borrar a alguien con todo lo que ha escrito (cuando lo
   * pide, como dice la política de privacidad). Para que no vuelva a entrar,
   * además hay que quitar su correo de la lista de Access.
   */
  function botonBorrarMiembro(m, art) {
    const caja = h("span", { clase: "con-icono" });
    const pedir = h("button", { type: "button", clase: "enlace peligro", texto: "Borrar su perfil y todo lo que ha escrito" });
    pedir.addEventListener("click", () => {
      const si = h("button", { type: "button", clase: "enlace peligro", texto: "Sí, borrarlo todo" });
      const no = h("button", { type: "button", clase: "enlace", texto: "No" });
      si.addEventListener("click", async () => {
        si.disabled = true;
        try {
          const r = await api("miembros/borrar", { email: m.email });
          art.replaceChildren(h("p", { clase: "mensaje ok", texto: `Borrado, con ${plural(r.cosas, "cosa escrita", "cosas escritas")}. Si no debe volver a entrar, quita su correo de la lista de Access en Cloudflare.` }));
        } catch (e) {
          mostrarError(e);
          si.disabled = false;
        }
      });
      no.addEventListener("click", () => caja.replaceChildren(pedir));
      caja.replaceChildren(h("span", { texto: "¿Seguro? No se puede deshacer." }), si, no);
      si.focus();
    });
    caja.append(pedir);
    return caja;
  }

  async function paginaMiembros() {
    const quien = await yo();
    const caja = $("[data-perfil]");
    caja.replaceChildren(formularioPerfil(quien, () => {
      const previo = $(".mensaje.ok", caja);
      if (previo) previo.remove();
      caja.prepend(h("p", { clase: "mensaje ok", texto: "Guardado." }));
      cargar();
    }));
    async function cargar() {
      const lista = $("[data-miembros]");
      try {
        const r = await api("miembros");
        lista.replaceChildren(h("div", { clase: "cosas miembros-lista" }, r.miembros.map((m) => {
          const art = h("article", { clase: "cosa" },
            h("h3", { texto: m.nick || "Sin nick todavía" }),
            h("p", { clase: "meta" },
              m.puesto ? h("span", { texto: NOMBRE_PUESTO[m.puesto] }) : null,
              m.riotId ? h("span", { texto: m.riotId }) : null,
              h("span", { texto: `Entró ${cuando(m.visto)}` }),
              m.email ? h("span", { texto: m.email }) : null));
          if (quien.admin && m.email) art.append(h("div", { clase: "acciones-cosa" }, botonBorrarMiembro(m, art)));
          return art;
        })));
      } catch (e) {
        lista.replaceChildren(h("p", { clase: "mensaje mal", texto: e.message }));
      }
    }
    cargar();
  }

  // ==================================================================== instalar y salir

  let eventoInstalar = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    eventoInstalar = e;
    const boton = $("[data-instalar-boton]");
    if (boton) boton.hidden = false;
  });

  function prepararInstalar() {
    const instalada = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    const listo = $("[data-instalar-listo]");
    const pasos = $("[data-instalar]");
    if (instalada) {
      if (listo) listo.hidden = false;
      if (pasos) pasos.hidden = true;
      return;
    }
    const boton = $("[data-instalar-boton]");
    if (!boton) return;
    boton.hidden = !eventoInstalar;
    boton.addEventListener("click", async () => {
      if (!eventoInstalar) return;
      eventoInstalar.prompt();
      await eventoInstalar.userChoice.catch(() => null);
      eventoInstalar = null;
      boton.hidden = true;
    });
  }

  /** «Salir»: se borra la copia sin conexión de este dispositivo y se cierra la sesión de Access. */
  function prepararSalir() {
    for (const enlace of $$("[data-salir]")) {
      enlace.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
          if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
        } catch { /* sin caché, nada que borrar */ }
        location.href = enlace.getAttribute("href");
      });
    }
  }

  /**
   * El service worker (la copia para verla sin conexión), **solo en la zona
   * instalada**: en un navegador cualquiera, por ejemplo un PC prestado, no se
   * guarda nada.
   */
  function registrarServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    const instalada = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    if (!instalada) return;
    navigator.serviceWorker.register("/equipo/sw.js", { scope: "/equipo/" }).catch(() => { /* sin él, la zona va igual con conexión */ });
  }

  // ==================================================================== arranque

  const PAGINAS = {
    inicio: paginaInicio,
    scouting: paginaScouting,
    plan: paginaPlan,
    repaso: paginaRepaso,
    build: paginaBuilds,
    apunte: paginaApuntes,
    idea: paginaIdeas,
    miembros: paginaMiembros,
  };

  async function arrancar() {
    prepararSalir();
    registrarServiceWorker();
    const pagina = PAGINAS[document.body.dataset.zona];
    if (!pagina) return;
    try {
      await pagina();
    } catch (e) {
      mostrarError(e);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arrancar);
  else arrancar();
})();
