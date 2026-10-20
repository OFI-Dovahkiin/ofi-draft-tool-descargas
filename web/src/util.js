/**
 * Piezas pequeñas que usan a la vez el formulario público y la zona del
 * equipo.
 */

export function json(obj, estado = 200, cabeceras = {}) {
  return new Response(JSON.stringify(obj), {
    status: estado,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      ...cabeceras,
    },
  });
}

/** Fuera los caracteres de control (salvo saltos de línea y tabuladores), sin espacios a los lados y recortado. */
export function limpiar(v, max) {
  return String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

/** El cuerpo como texto, leído por trozos; `null` si pasa de `max` bytes. */
export async function leerConTope(request, max) {
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
 * ¿Viene de una página de esta misma web? Un navegador manda siempre `Origin`
 * en un POST. No para a quien lo falsifique a mano, pero sí a las páginas de
 * fuera (y en la zona, ese «a mano» tendría que haber pasado antes por Access).
 */
export function mismoSitio(request) {
  const origen = request.headers.get("origin");
  try {
    return !!origen && new URL(origen).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function resumen(texto) {
  const datos = new TextEncoder().encode(texto);
  const hash = await crypto.subtle.digest("SHA-256", datos);
  return [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}
