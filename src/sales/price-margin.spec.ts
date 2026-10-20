import { evaluarMargen } from './price-margin';

describe('evaluarMargen (¿deja ganancia?)', () => {
  it.each([
    [10, 9, 0, 'OK'],
    [9, 9, 0, 'SIN_GANANCIA'],
    [8.99, 9, 0, 'BAJO_COSTO'],
    // Con descuento de la línea: 10 − 10 % = 9 → igual al costo.
    [10, 9, 10, 'SIN_GANANCIA'],
    [10, 9, 20, 'BAJO_COSTO'],
    // Fracciones de centavo no son ganancia.
    [9.004, 9, 0, 'SIN_GANANCIA'],
  ])(
    'precio %s, costo %s, descuento %s%% → %s',
    (precio, costo, desc, esperado) => {
      expect(evaluarMargen(precio, costo, desc)).toBe(esperado);
    },
  );
});
