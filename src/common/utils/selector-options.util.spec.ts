import {
  MAX_SELECTOR_OPTIONS,
  SELECTOR_TAKE,
  buildSelectorOptions,
} from './selector-options.util';

const filas = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `Registro ${i + 1}`,
  }));

/**
 * Los selectores se alimentaban del endpoint paginado de las tablas, con
 * `limit: 10`. Faltaban opciones sin avisar: al proveedor número 11 no se le
 * podía comprar. Estas pruebas fijan que la lista de opciones sea completa
 * dentro del tope y que, cuando NO lo sea, lo diga.
 */
describe('buildSelectorOptions', () => {
  it('devuelve todas las opciones cuando caben en el tope', () => {
    const r = buildSelectorOptions(filas(30));

    expect(r.options).toHaveLength(30);
    expect(r.total).toBe(30);
    expect(r.truncated).toBe(false);
  });

  it('un catálogo pequeño no se recorta: el bug original era justo este', () => {
    // 11 proveedores con `limit: 10` dejaban a uno fuera y nadie se enteraba.
    const r = buildSelectorOptions(filas(11));

    expect(r.options).toHaveLength(11);
    expect(r.options.at(-1)?.name).toBe('Registro 11');
    expect(r.truncated).toBe(false);
  });

  it('justo en el tope NO se marca como recortado', () => {
    const r = buildSelectorOptions(filas(MAX_SELECTOR_OPTIONS));

    expect(r.options).toHaveLength(MAX_SELECTOR_OPTIONS);
    expect(r.truncated).toBe(false);
  });

  it('un registro por encima del tope SÍ se marca y se recorta', () => {
    // La consulta pide `MAX + 1` justamente para detectar esto sin un COUNT(*).
    const r = buildSelectorOptions(filas(SELECTOR_TAKE));

    expect(r.options).toHaveLength(MAX_SELECTOR_OPTIONS);
    expect(r.truncated).toBe(true);
  });

  it('`total` refleja lo devuelto, no lo leído', () => {
    // Si `total` contara la fila extra que se pide para detectar el corte, la
    // interfaz diría "501 opciones" mostrando 500.
    const r = buildSelectorOptions(filas(SELECTOR_TAKE));
    expect(r.total).toBe(r.options.length);
  });

  it('una lista vacía es un resultado válido, no un error', () => {
    const r = buildSelectorOptions([]);

    expect(r.options).toEqual([]);
    expect(r.truncated).toBe(false);
    expect(r.total).toBe(0);
  });

  it('el tope de consulta es exactamente el tope más uno', () => {
    // Pedir sólo MAX haría imposible distinguir "hay MAX" de "hay más de MAX".
    expect(SELECTOR_TAKE).toBe(MAX_SELECTOR_OPTIONS + 1);
  });

  it('conserva el orden recibido (el servicio ordena por nombre)', () => {
    const r = buildSelectorOptions([
      { id: 9, name: 'Alfa' },
      { id: 2, name: 'Beta' },
      { id: 7, name: 'Gamma' },
    ]);

    expect(r.options.map((o) => o.name)).toEqual(['Alfa', 'Beta', 'Gamma']);
  });
});
