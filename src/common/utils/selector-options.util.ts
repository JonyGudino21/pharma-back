/**
 * DATOS PARA SELECTORES (combos, checkboxes, filtros).
 *
 * ─── EL PROBLEMA QUE RESUELVE ───
 * Los selectores del front se alimentaban del MISMO endpoint paginado que las
 * tablas de administración, con `limit: 10`. El resultado, silencioso y grave:
 *
 *   - El combo de proveedores al crear una orden de compra sólo ofrecía los
 *     10 primeros. Con 30 proveedores dados de alta, comprarle al número 11
 *     era sencillamente imposible desde la aplicación.
 *   - El selector de categorías de un producto mostraba 10 de las que hubiera.
 *
 * No fallaba, no avisaba: simplemente faltaban opciones. Y como la lista se veía
 * llena, nadie sospechaba.
 *
 * ─── POR QUÉ UN ENDPOINT APARTE Y NO SUBIR EL `limit` ───
 * Subir el límite en cada pantalla arregla el síntoma y deja la causa: la
 * intención ("dame las opciones") sigue siendo implícita, así que el siguiente
 * selector que alguien escriba repetirá el error. Además, pintar un `<select>`
 * no necesita descripciones, fechas ni datos de crédito: enviarlos multiplica el
 * peso de la respuesta por quince para mostrar un nombre.
 *
 * Un endpoint propio hace el contrato explícito, acota el payload a `{id, name}`
 * y —esto es lo importante— **avisa cuando se queda corto** con `truncated`, en
 * lugar de mentir por omisión.
 */

/**
 * Tope de opciones. Generoso frente a los catálogos reales de una farmacia
 * (decenas de categorías, cientos de proveedores) pero acotado: sin tope
 * volveríamos al problema que la paginación obligatoria vino a cerrar.
 */
export const MAX_SELECTOR_OPTIONS = 500;

export interface SelectorOption {
  id: number;
  name: string;
}

export interface SelectorOptionsResult {
  options: SelectorOption[];
  /**
   * `true` cuando hay más registros de los que caben en el tope.
   *
   * Es la pieza que evita repetir el bug original: la interfaz puede degradar a
   * un campo de búsqueda en lugar de presentar una lista incompleta como si
   * fuera completa. Un selector que miente es peor que uno que pide teclear.
   */
  truncated: boolean;
  total: number;
}

/**
 * Da forma al resultado aplicando el tope y marcando si se quedó corto.
 *
 * Se pide SIEMPRE un registro de más (`MAX_SELECTOR_OPTIONS + 1`) para saber si
 * hay más sin pagar un `COUNT(*)` adicional sobre la tabla.
 *
 * @param filas registros leídos con `take: MAX_SELECTOR_OPTIONS + 1`
 */
export function buildSelectorOptions(
  filas: SelectorOption[],
): SelectorOptionsResult {
  const truncated = filas.length > MAX_SELECTOR_OPTIONS;
  const options = truncated ? filas.slice(0, MAX_SELECTOR_OPTIONS) : filas;

  return {
    options,
    truncated,
    total: options.length,
  };
}

/** `take` a usar en la consulta: el tope más uno, para detectar el corte. */
export const SELECTOR_TAKE = MAX_SELECTOR_OPTIONS + 1;
