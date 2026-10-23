import {
  armarFolio,
  claveProveedor,
  fechaFolio,
  siguienteConsecutivo,
} from './purchase-folio';

describe('folio sugerido de compra', () => {
  describe('claveProveedor', () => {
    it.each([
      ['Alvex', 'ALV'],
      ['Distribuidora Alvex S.A. de C.V.', 'ALV'],
      ['Laboratorios Pisa', 'PIS'],
      ['Grupo Farmacéutico Ñandú', 'NAN'],
      ['Médica Ángeles', 'MED'],
      ['Nadro', 'NAD'],
      ['Yu', 'YUX'],
      ['Distribuidora', 'DIS'],
      ['   ', 'PRV'],
      ['3M México', '3M'.padEnd(3, 'X')],
    ])('"%s" → %s', (nombre, clave) => {
      expect(claveProveedor(nombre)).toBe(clave);
    });
  });

  it('la fecha es el día de la farmacia, no el de UTC', () => {
    // 23-oct 03:00 UTC = 22-oct 21:00 en Ciudad de México.
    expect(fechaFolio(new Date('2026-10-23T03:00:00Z'))).toBe('20261022');
  });

  it('arma el folio con consecutivo de 3 dígitos', () => {
    expect(armarFolio('ALV', '20261023', 7)).toBe('FAC-007-ALV-20261023');
  });

  describe('siguienteConsecutivo', () => {
    it('empieza en 1', () => {
      expect(siguienteConsecutivo([], 'ALV', '20261023')).toBe(1);
    });

    it('toma el mayor del proveedor y día, e ignora los demás', () => {
      const usados = [
        'FAC-001-ALV-20261023',
        'fac-004-alv-20261023',
        'FAC-009-ALV-20261022',
        'FAC-020-NAD-20261023',
        'A-55821',
      ];
      expect(siguienteConsecutivo(usados, 'ALV', '20261023')).toBe(5);
    });
  });
});
