import { esRfcValido, normalizarRfc, rfcDeSemilla } from './rfc.util';

describe('rfc.util', () => {
  it('normaliza mayúsculas, espacios y guiones', () => {
    expect(normalizarRfc(' xaxx-010101 000 ')).toBe('XAXX010101000');
  });

  it('acepta RFC de persona moral (12) y física (13)', () => {
    expect(esRfcValido('ABC010101AB1')).toBe(true);
    expect(esRfcValido('XAXX010101000')).toBe(true);
    expect(esRfcValido('XAXX01010100')).toBe(false);
  });

  describe('rfcDeSemilla', () => {
    it('sin valor no escribe nada', () => {
      expect(rfcDeSemilla(undefined)).toBeUndefined();
      expect(rfcDeSemilla('   ')).toBeUndefined();
    });

    it('normaliza lo escrito a mano en el .env', () => {
      expect(rfcDeSemilla('xaxx-010101-000')).toBe('XAXX010101000');
    });

    it('detiene la semilla con un mensaje claro si el formato es inválido', () => {
      expect(() => rfcDeSemilla('PENDIENTE')).toThrow(/SEED_COMPANY_RFC/);
    });
  });
});
