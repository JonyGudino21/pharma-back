import { Prisma } from '@prisma/client';
import { money, decimalText } from './decimal.util';

/**
 * Estos helpers formatean lo que acaba escrito en notas de auditoria, mensajes
 * de error al cajero y logs de conciliacion. Un importe mal formateado no
 * rompe nada en ejecucion: simplemente miente, y nadie lo nota hasta el arqueo.
 */
describe('formato de importes', () => {
  describe('money', () => {
    it('incluye el simbolo de moneda', () => {
      expect(money(new Prisma.Decimal(1250))).toBe('$1250.00');
    });

    it('siempre muestra dos decimales', () => {
      expect(money(new Prisma.Decimal('7.5'))).toBe('$7.50');
      expect(money(new Prisma.Decimal(0))).toBe('$0.00');
    });

    it('acepta numeros y cadenas ademas de Decimal', () => {
      expect(money(42)).toBe('$42.00');
      expect(money('99.999')).toBe('$100.00');
    });

    it('conserva el signo en importes negativos', () => {
      expect(money(new Prisma.Decimal(-30))).toBe('$-30.00');
    });
  });

  describe('decimalText', () => {
    it('no redondea: es lo que lo separa de money', () => {
      expect(decimalText(new Prisma.Decimal('25.123456'))).toBe('25.123456');
    });

    it('no antepone simbolo de moneda', () => {
      expect(decimalText(new Prisma.Decimal(25))).toBe('25');
    });
  });
});
