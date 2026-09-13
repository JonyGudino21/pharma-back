import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  buildPaginationMeta,
  resolvePagination,
} from './pagination.util';

/**
 * La paginación dejó de ser opcional. Estas pruebas fijan el contrato que
 * sustituye al patrón `hasPagination`, donde omitir los parámetros devolvía la
 * tabla completa.
 */
describe('resolvePagination — la paginación ya no se puede evitar', () => {
  it('sin parámetros aplica la página por defecto, NO la tabla completa', () => {
    // El corazón del arreglo: antes esto devolvía `hasPagination = false` y el
    // servicio hacía un findMany sin `take`.
    const p = resolvePagination(undefined);
    expect(p.page).toBe(1);
    expect(p.limit).toBe(DEFAULT_PAGE_SIZE);
    expect(p.take).toBe(DEFAULT_PAGE_SIZE);
    expect(p.skip).toBe(0);
  });

  it('un objeto vacío tampoco abre la puerta', () => {
    expect(resolvePagination({}).take).toBe(DEFAULT_PAGE_SIZE);
  });

  it('respeta la página y el límite pedidos', () => {
    const p = resolvePagination({ page: 3, limit: 50 });
    expect(p).toEqual({ page: 3, limit: 50, skip: 100, take: 50 });
  });

  describe('techo duro', () => {
    it('recorta un límite excesivo al máximo', () => {
      // El DTO ya declara @Max(100), pero los servicios también se llaman entre
      // sí, donde no corre ningún validador. El techo tiene que estar aquí.
      expect(resolvePagination({ limit: 999_999 }).take).toBe(MAX_PAGE_SIZE);
    });

    it('el máximo es alcanzable, no se recorta de más', () => {
      expect(resolvePagination({ limit: MAX_PAGE_SIZE }).take).toBe(MAX_PAGE_SIZE);
    });
  });

  describe('entradas basura', () => {
    it.each([
      ['página 0', { page: 0 }],
      ['página negativa', { page: -5 }],
      ['página no numérica', { page: 'abc' as unknown as number }],
      ['NaN', { page: NaN }],
      ['Infinity', { page: Infinity }],
    ])('%s cae en la página 1', (_caso, params) => {
      expect(resolvePagination(params).page).toBe(1);
    });

    it.each([
      ['límite 0', { limit: 0 }],
      ['límite negativo', { limit: -10 }],
      ['límite no numérico', { limit: 'muchos' as unknown as number }],
      ['NaN', { limit: NaN }],
    ])('%s cae en el límite por defecto', (_caso, params) => {
      expect(resolvePagination(params).take).toBe(DEFAULT_PAGE_SIZE);
    });

    it('un skip nunca es NaN (rompería la consulta de Prisma)', () => {
      // Number(undefined) es NaN y Math.max(1, NaN) sigue siendo NaN: sin la
      // comprobación de isFinite, ese NaN llegaba a `skip`.
      for (const entrada of [{}, { page: NaN }, { limit: NaN }, undefined]) {
        expect(Number.isFinite(resolvePagination(entrada).skip)).toBe(true);
      }
    });

    it('trunca páginas y límites decimales', () => {
      const p = resolvePagination({ page: 2.9, limit: 10.7 });
      expect(p.page).toBe(2);
      expect(p.limit).toBe(10);
      expect(Number.isInteger(p.skip)).toBe(true);
    });
  });
});

describe('buildPaginationMeta', () => {
  it('calcula el total de páginas redondeando hacia arriba', () => {
    const meta = buildPaginationMeta(45, resolvePagination({ page: 1, limit: 20 }));
    expect(meta.totalPages).toBe(3);
  });

  it('con 0 resultados devuelve 1 página, no 0', () => {
    // `totalPages: 0` hacía que el componente pintara "página 1 de 0".
    const meta = buildPaginationMeta(0, resolvePagination({}));
    expect(meta.totalPages).toBe(1);
    expect(meta.total).toBe(0);
  });

  it('hasNext y hasPrev se calculan aquí, no en cada pantalla', () => {
    const primera = buildPaginationMeta(50, resolvePagination({ page: 1, limit: 20 }));
    expect(primera.hasPrev).toBe(false);
    expect(primera.hasNext).toBe(true);

    const ultima = buildPaginationMeta(50, resolvePagination({ page: 3, limit: 20 }));
    expect(ultima.hasPrev).toBe(true);
    expect(ultima.hasNext).toBe(false);
  });

  it('en una lista vacía no ofrece navegar a ningún lado', () => {
    const meta = buildPaginationMeta(0, resolvePagination({ page: 1 }));
    expect(meta.hasNext).toBe(false);
    expect(meta.hasPrev).toBe(false);
  });

  it('devuelve el límite REALMENTE aplicado, no el pedido', () => {
    // Si el cliente pide 5.000 y le servimos 100, la respuesta debe decir 100:
    // con el valor pedido, el front calcularía mal cuántas páginas quedan.
    const meta = buildPaginationMeta(1_000, resolvePagination({ limit: 5_000 }));
    expect(meta.limit).toBe(MAX_PAGE_SIZE);
    expect(meta.totalPages).toBe(10);
  });
});
