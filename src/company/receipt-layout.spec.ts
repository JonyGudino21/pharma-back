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

  it('rechaza un ticket sin líneas o sin total', () => {
    expect(() =>
      normalizeReceiptLayout({ blocks: ['header', 'footer'] }),
    ).toThrow(/items y totals/);
  });
});
