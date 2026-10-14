/* OFI Draft Tool — lo poco que la web hace en el navegador:
   la última versión y de cuándo son los datos (de /api/version), y el
   formulario de «Avisar de un fallo». Sin librerías ni nada de terceros.
   Si algo de esto falla, las páginas se leen igual: solo falta el dato. */
(function () {
  "use strict";

  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  function fecha(iso) {
    if (!iso) return "";
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return "";
    return parseInt(m[3], 10) + " de " + MESES[parseInt(m[2], 10) - 1];
  }

  function miles(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  function poner(sel, texto) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) els[i].textContent = texto;
  }

  function version() {
    try {
      var guardada = sessionStorage.getItem("ofi-version");
      if (guardada) return Promise.resolve(JSON.parse(guardada));
    } catch (e) { /* sin almacenamiento: se pide */ }
    return fetch("/api/version", { headers: { accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (v) {
        try { sessionStorage.setItem("ofi-version", JSON.stringify(v)); } catch (e) { /* nada */ }
        return v;
      });
  }

  function pintarVersion(v) {
    if (!v || !v.version) return;
    var datos = v.datos && v.datos.fecha
      ? "datos del " + fecha(v.datos.fecha) + (v.datos.partidas ? " (" + miles(v.datos.partidas) + " partidas)" : "")
      : "";
    var tira = "Última versión: " + v.version + (v.publicada ? ", del " + fecha(v.publicada) : "") + (datos ? " · " + datos : "") + ".";
    poner("[data-version-tira]", tira);
    poner("[data-version-detalle]", "Versión " + v.version + (v.publicada ? ", del " + fecha(v.publicada) : "") + ". Pesa unos 5 MB.");
    var boton = document.querySelector("[data-boton-descarga]");
    if (boton) boton.textContent = "Descargar la " + v.version;
    poner('[data-campo="version"]', v.version + (v.publicada ? " (" + fecha(v.publicada) + ")" : ""));
    if (v.datos) {
      poner('[data-campo="datos-fecha"]', v.datos.fecha ? fecha(v.datos.fecha) : "—");
      poner('[data-campo="datos-partidas"]', v.datos.partidas ? miles(v.datos.partidas) : "—");
    }
    var cortas = document.querySelector("[data-novedades-cortas]");
    if (cortas) {
      cortas.innerHTML = "";
      var p = document.createElement("p");
      p.appendChild(document.createTextNode(tira + " "));
      var a = document.createElement("a");
      a.href = "/novedades/#v" + v.version;
      a.textContent = "Qué trae";
      p.appendChild(a);
      cortas.appendChild(p);
    }
    var campo = document.querySelector("[data-version-campo]");
    if (campo && !campo.value) campo.placeholder = "por ejemplo, " + v.version;
  }

  if (document.querySelector("[data-version-tira], [data-version-detalle], [data-campo], [data-novedades-cortas], [data-version-campo]")) {
    version().then(pintarVersion).catch(function () { /* se queda el texto de serie */ });
  }

  // ---------------------------------------------------------------- fallo
  var form = document.querySelector("form[data-fallo]");
  if (!form) return;
  var abierta = Date.now();
  var mensaje = form.querySelector("[data-mensaje]");
  var boton = form.querySelector('button[type="submit"]');
  // Lo que acepta el servidor por adjunto. Las imágenes se reducen antes de
  // mandarlas y de un registro largo va el final, así que esto casi nunca
  // llega a contar: está para lo que no se pueda reducir.
  var MAX = 2 * 1024 * 1024;
  // Una imagen más grande que esto ni se intenta abrir.
  var MAX_IMAGEN = 25 * 1024 * 1024;
  // De un registro, lo último: es donde está el fallo.
  var COLA_TEXTO = 512 * 1024;
  var LADO_MAX = 1600;

  function avisar(texto, bien) {
    mensaje.hidden = false;
    mensaje.className = "mensaje " + (bien ? "ok" : "mal");
    mensaje.textContent = texto;
  }

  function aBase64(blob) {
    return new Promise(function (ok, mal) {
      var r = new FileReader();
      r.onload = function () {
        var s = String(r.result || "");
        ok(s.slice(s.indexOf(",") + 1));
      };
      r.onerror = function () { mal(new Error("no se pudo leer")); };
      r.readAsDataURL(blob);
    });
  }

  function extension(nombre) {
    var i = nombre.lastIndexOf(".");
    return i < 0 ? "" : nombre.slice(i + 1).toLowerCase();
  }

  function sinExtension(nombre) {
    var i = nombre.lastIndexOf(".");
    return i < 0 ? nombre : nombre.slice(0, i);
  }

  /**
   * Una captura, más pequeña: como mucho 1600 px de lado y en JPG. Una
   * captura de pantalla en PNG pesa 2-3 MB y el servidor, en el plan gratuito,
   * tiene muy poco tiempo para procesarla; así llega en unos cientos de KB y
   * se sigue leyendo bien. Si algo falla, va la original.
   */
  function reducirImagen(fichero) {
    if (typeof createImageBitmap !== "function") return Promise.resolve(fichero);
    return createImageBitmap(fichero).then(function (bmp) {
      var escala = Math.min(1, LADO_MAX / Math.max(bmp.width, bmp.height));
      var lienzo = document.createElement("canvas");
      lienzo.width = Math.max(1, Math.round(bmp.width * escala));
      lienzo.height = Math.max(1, Math.round(bmp.height * escala));
      var c = lienzo.getContext("2d");
      c.fillStyle = "#fff";
      c.fillRect(0, 0, lienzo.width, lienzo.height);
      c.drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
      if (bmp.close) bmp.close();
      return new Promise(function (ok) {
        lienzo.toBlob(function (b) {
          ok(b && b.size < fichero.size ? new File([b], sinExtension(fichero.name) + ".jpg", { type: "image/jpeg" }) : fichero);
        }, "image/jpeg", 0.85);
      });
    }).catch(function () { return fichero; });
  }

  /** De un texto largo, el final, empezando en una letra entera. */
  function colaDeTexto(fichero) {
    if (fichero.size <= COLA_TEXTO) return Promise.resolve(fichero);
    return fichero.slice(fichero.size - COLA_TEXTO).arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf);
      var i = 0;
      while (i < 3 && i < b.length && (b[i] & 0xc0) === 0x80) i++;
      var aviso = "[… solo los últimos " + Math.round(COLA_TEXTO / 1024) + " KB de " + fichero.name + " …]\n";
      return new File([aviso, b.subarray(i)], fichero.name, { type: "text/plain" });
    });
  }

  function preparar(fichero) {
    var ext = extension(fichero.name);
    var listo = ext === "png" || ext === "jpg" || ext === "jpeg" ? reducirImagen(fichero) : colaDeTexto(fichero);
    return listo.then(function (f) {
      if (f.size > MAX) throw new Error("«" + fichero.name + "» sigue pasando de 2 MB.");
      return aBase64(f).then(function (b64) {
        return { nombre: f.name, tipo: f.type || "text/plain", base64: b64 };
      });
    });
  }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var que = form.que.value.trim();
    if (que.length < 10) {
      avisar("Cuenta un poco más qué ha pasado (al menos una frase).", false);
      form.que.focus();
      return;
    }
    var ficheros = Array.prototype.slice.call(form.adjuntos.files || []);
    if (ficheros.length > 2) { avisar("Como mucho dos adjuntos.", false); return; }
    for (var i = 0; i < ficheros.length; i++) {
      var ext = extension(ficheros[i].name);
      var imagen = ext === "png" || ext === "jpg" || ext === "jpeg";
      if (imagen && ficheros[i].size > MAX_IMAGEN) { avisar("«" + ficheros[i].name + "» es demasiado grande.", false); return; }
    }
    boton.disabled = true;
    avisar("Enviando…", true);
    Promise.all(ficheros.map(preparar)).then(function (adjuntos) {
      return fetch("/api/fallo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          que: que,
          donde: form.donde.value,
          esperaba: form.esperaba.value.trim(),
          quien: form.quien.value.trim(),
          version: form.version.value.trim(),
          web: form.web.value,
          ms: Date.now() - abierta,
          navegador: navigator.userAgent.slice(0, 200),
          adjuntos: adjuntos
        })
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; });
    }).then(function (x) {
      if (x.r.ok) {
        form.reset();
        avisar("Recibido. Le ha llegado a Álvaro. Gracias.", true);
      } else {
        avisar((x.j && x.j.mensaje) || "No se ha podido enviar. Escribe a contact@ofidraft.com.", false);
      }
    }).catch(function (e) {
      var texto = e && /«/.test(String(e.message)) ? e.message + " " : "";
      avisar(texto + "No se ha podido enviar. Escribe a contact@ofidraft.com.", false);
    }).then(function () { boton.disabled = false; });
  });
})();
