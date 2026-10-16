/**
 * Lectura TIPADA de lo que recibió un mock de jest.
 *
 * ─── POR QUÉ EXISTE ───
 * `jest.fn()` se tipa como `jest.Mock<any, any>`, así que todo lo que cuelga de
 * `.mock` es `any`. En cuanto una prueba afirma algo sobre los argumentos:
 *
 *     const data = tx.product.update.mock.calls[0][0].data;   // any
 *     expect(data.cost.toString()).toBe('150');               // any.any.any
 *
 * ESLint lo marca —con razón— como `no-unsafe-member-access`: dentro de ese
 * `any` no hay comprobación de nada. Si mañana el servicio pasa `costo` en vez
 * de `cost`, la prueba no falla al compilar, y `undefined.toString()` revienta
 * con un mensaje que no dice nada del problema real.
 *
 * ─── LA ALTERNATIVA QUE SE DESCARTÓ ───
 * Sembrar `// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access`
 * por cada aserción. Silencia el aviso sin arreglar nada y, peor, acostumbra a
 * la vista a ignorar esa regla también donde sí importa.
 *
 * ─── LO QUE HACE ESTE MÓDULO ───
 * Un único punto donde el `any` se convierte en `unknown` y de ahí al tipo que
 * la prueba declara. La aserción queda escrita y visible en un sitio, en lugar
 * de repartida por veinte archivos.
 */

/** Mock visto como lo que realmente sabemos de él: argumentos desconocidos. */
type MockOpaco = {
  mock: {
    calls: unknown[][];
    invocationCallOrder: number[];
  };
};

/**
 * Argumento `indiceArgumento` de la llamada `indiceLlamada`, con el tipo que la
 * prueba declara.
 *
 * @example
 *   const { data } = argDe<{ data: { cost: Decimal } }>(tx.product.update)
 *   expect(data.cost.toString()).toBe('150')
 */
export function argDe<T>(
  mock: unknown,
  indiceLlamada = 0,
  indiceArgumento = 0,
): T {
  const { calls } = (mock as MockOpaco).mock;
  // Índices negativos como en `Array.at`: -1 es la última llamada. Varias
  // pruebas afirman sobre el ÚLTIMO update de una transacción con varios.
  const llamada = calls.at(indiceLlamada);

  if (!llamada) {
    throw new Error(
      `El mock no recibió la llamada #${indiceLlamada} (recibió ${calls.length}).`,
    );
  }

  return llamada[indiceArgumento] as T;
}

/**
 * `data` de la llamada indicada. Atajo para el caso más repetido con Prisma,
 * donde casi toda aserción mira `{ where, data }`.
 */
export function dataDe<T>(mock: unknown, indiceLlamada = 0): T {
  return argDe<{ data: T }>(mock, indiceLlamada).data;
}

/**
 * Orden global de invocación, para afirmar que una llamada ocurrió ANTES que
 * otra.
 *
 * No es un detalle cosmético: varias garantías del sistema dependen del orden
 * —bloquear la fila antes de leerla, revertir el costo antes de mover el
 * stock— y sin esto no hay forma de comprobarlas.
 */
export function ordenDe(mock: unknown, indiceLlamada = 0): number {
  const { invocationCallOrder } = (mock as MockOpaco).mock;
  const orden = invocationCallOrder[indiceLlamada];

  if (orden === undefined) {
    throw new Error(`El mock no registró la invocación #${indiceLlamada}.`);
  }

  return orden;
}

/** Todos los argumentos en la posición indicada, en orden de llamada. */
export function argsDe<T>(mock: unknown, indiceArgumento = 0): T[] {
  const { calls } = (mock as MockOpaco).mock;
  return calls.map((llamada) => llamada[indiceArgumento] as T);
}
