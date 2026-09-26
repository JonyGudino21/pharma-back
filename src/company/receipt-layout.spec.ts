import { normalizeReceiptLayout } from './receipt-layout';

describe('normalizeReceiptLayout', () => {
  it('devuelve el layout completo cuando el JSON viene vacío', () => {
    expect(normalizeReceiptLayout(null).blocks).toEqual([
      'header',
      'meta',
      'items',
      'totals',
      'payments',
      'footer',
    ]);
  });

  it('respeta el orden y descarta bloques desconocidos o repetidos', () => {
    const layout = normalizeReceiptLayout({
      blocks: ['footer', 'items', 'bogus', 'items', 'totals', 'header'],
    });
    expect(layout.blocks).toEqual(['footer', 'items', 'totals', 'header']);
  });

  describe('juego de caracteres de la térmica', () => {
    it('por defecto es ascii: no puede imprimir basura en ninguna impresora', () => {
      expect(normalizeReceiptLayout(null).charset).toBe('ascii');
      expect(
        normalizeReceiptLayout({ blocks: ['items', 'totals'] }).charset,
      ).toBe('ascii');
    });

    it('conserva cp850 cuando se elige', () => {
      expect(
        normalizeReceiptLayout({ blocks: ['items', 'totals'], charset: 'cp850' })
          .charset,
      ).toBe('cp850');
    });

    it('un valor desconocido cae en ascii en vez de romper la impresión', () => {
      expect(
        normalizeReceiptLayout({ blocks: ['items', 'totals'], charset: 'utf-16' })
          .charset,
      ).toBe('ascii');
    });

    it('conserva el charset aunque los bloques vengan mal formados', () => {
      expect(
        normalizeReceiptLayout({ blocks: 'no-es-lista', charset: 'cp850' }),
      ).toMatchObject({ charset: 'cp850' });
    });
  });

  it('rechaza un ticket sin líneas o sin total', () => {
    expect(() =>
      normalizeReceiptLayout({ blocks: ['header', 'footer'] }),
    ).toThrow(/items y totals/);
  });
});
