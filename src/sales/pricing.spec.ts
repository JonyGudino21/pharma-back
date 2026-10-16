import { TaxCategory } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  effectiveTaxRate,
  priceLine,
  refundForUnits,
  saleTotals,
} from './pricing';

const s = (d: Decimal) => d.toFixed(2);

describe('motor de precios', () => {
  describe('priceLine', () => {
    it('sin descuento ni IVA: bruto = neto', () => {
      const r = priceLine({ unitPrice: 38, quantity: 2 });
      expect([s(r.gross), s(r.discount), s(r.net), s(r.tax)]).toEqual([
        '76.00',
        '0.00',
        '76.00',
        '0.00',
      ]);
    });

    it('IVA 16 % INCLUIDO: $116 contiene $16', () => {
      const r = priceLine({ unitPrice: 116, quantity: 1, taxRate: 0.16 });
      expect(s(r.net)).toBe('116.00');
      expect(s(r.tax)).toBe('16.00');
    });

    it('IVA 8 % (frontera) incluido: $108 contiene $8', () => {
      expect(
        s(priceLine({ unitPrice: 108, quantity: 1, taxRate: 0.08 }).tax),
      ).toBe('8.00');
    });

    it('descuento 10 % sobre el bruto y el IVA se calcula sobre el NETO', () => {
      const r = priceLine({
        unitPrice: 116,
        quantity: 3,
        discountPercent: 10,
        taxRate: 0.16,
      });
      expect(s(r.gross)).toBe('348.00');
      expect(s(r.discount)).toBe('34.80');
      expect(s(r.net)).toBe('313.20');
      expect(s(r.tax)).toBe('43.20'); // 313.20 / 1.16 = 270.00
    });

    it('redondeo medio hacia arriba: 33.33 × 1 con 15 % = 5.00 (4.9995)', () => {
      expect(
        s(
          priceLine({ unitPrice: 33.33, quantity: 1, discountPercent: 15 })
            .discount,
        ),
      ).toBe('5.00');
    });

    it('100 % deja la línea en cero, sin negativos', () => {
      const r = priceLine({
        unitPrice: 89.9,
        quantity: 2,
        discountPercent: 100,
        taxRate: 0.16,
      });
      expect([s(r.net), s(r.tax)]).toEqual(['0.00', '0.00']);
    });

    it.each([[-1], [100.01]])(
      'rechaza porcentaje fuera de rango (%s)',
      (pct) => {
        expect(() =>
          priceLine({ unitPrice: 10, quantity: 1, discountPercent: pct }),
        ).toThrow(RangeError);
      },
    );

    it('rechaza cantidades no enteras', () => {
      expect(() => priceLine({ unitPrice: 10, quantity: 1.5 })).toThrow(
        RangeError,
      );
    });
  });

  describe('saleTotals', () => {
    it('suma por línea y agrupa el IVA por tasa, de mayor a menor', () => {
      const a = priceLine({ unitPrice: 116, quantity: 1, taxRate: 0.16 });
      const b = priceLine({ unitPrice: 50, quantity: 2, discountPercent: 10 });
      const t = saleTotals([
        { ...a, taxRate: 0.16 },
        { ...b, taxRate: 0 },
      ]);
      expect(s(t.subtotal)).toBe('216.00');
      expect(s(t.discountTotal)).toBe('10.00');
      expect(s(t.total)).toBe('206.00');
      expect(s(t.taxTotal)).toBe('16.00');
      expect(
        t.breakdown.map((r) => [
          r.rate.toFixed(2),
          s(r.total),
          s(r.tax),
          s(r.base),
        ]),
      ).toEqual([
        ['0.16', '116.00', '16.00', '100.00'],
        ['0.00', '90.00', '0.00', '90.00'],
      ]);
    });

    it('venta vacía: todo en cero', () => {
      const t = saleTotals([]);
      expect(s(t.total)).toBe('0.00');
      expect(t.breakdown).toEqual([]);
    });
  });

  describe('refundForUnits', () => {
    it('reembolsa el NETO con descuento, no el precio de lista', () => {
      // 2 × $100 con 50 %: neto $100 → devolver 1 unidad = $50, no $100
      expect(s(refundForUnits(100, 2, 0, 1))).toBe('50.00');
    });

    it('devoluciones parciales suman EXACTAMENTE el neto de la línea', () => {
      // 3 unidades, neto $100.00: 33.33 + 33.34 + 33.33 = 100.00
      const r1 = refundForUnits(100, 3, 0, 1);
      const r2 = refundForUnits(100, 3, 1, 1);
      const r3 = refundForUnits(100, 3, 2, 1);
      expect(s(r1.add(r2).add(r3))).toBe('100.00');
      expect(s(refundForUnits(100, 3, 0, 3))).toBe('100.00');
    });

    it('rechaza devolver más de lo vendido', () => {
      expect(() => refundForUnits(100, 2, 1, 2)).toThrow(RangeError);
    });
  });

  describe('effectiveTaxRate', () => {
    it('GENERAL toma la tasa configurada; ZERO y EXEMPT son 0', () => {
      expect(effectiveTaxRate(TaxCategory.GENERAL, 16).toFixed(2)).toBe('0.16');
      expect(effectiveTaxRate(TaxCategory.GENERAL, 8).toFixed(2)).toBe('0.08');
      expect(effectiveTaxRate(TaxCategory.ZERO, 16).toFixed(2)).toBe('0.00');
      expect(effectiveTaxRate(TaxCategory.EXEMPT, 16).toFixed(2)).toBe('0.00');
    });
  });
});
