import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  isUniqueConstraintError,
  isWriteConflictError,
  mapPrismaError,
} from './prisma-error.util';

/**
 * Contrato de TRADUCCIÓN DE ERRORES DE PRISMA (Fase 2 · hallazgo A-3).
 *
 * Antes, cualquier error de Prisma salía como HTTP 500 con el texto crudo, que
 * además revela la tabla y la columna del constraint violado.
 */
describe('mapPrismaError', () => {
  const conocido = (code: string, message = 'detalle interno de prisma') =>
    new Prisma.PrismaClientKnownRequestError(message, {
      code,
      clientVersion: 'test',
    });

  it('P2002 (duplicado) → 409, no 500', () => {
    const r = mapPrismaError(conocido('P2002'));
    expect(r?.status).toBe(HttpStatus.CONFLICT);
    expect(r?.retryable).toBe(false);
  });

  it('P2025 (no encontrado) → 404, no 500', () => {
    const r = mapPrismaError(conocido('P2025'));
    expect(r?.status).toBe(HttpStatus.NOT_FOUND);
  });

  it('P2003 (llave foránea) → 409', () => {
    expect(mapPrismaError(conocido('P2003'))?.status).toBe(HttpStatus.CONFLICT);
  });

  it('P2000 (valor demasiado largo) → 400', () => {
    expect(mapPrismaError(conocido('P2000'))?.status).toBe(
      HttpStatus.BAD_REQUEST,
    );
  });

  it('P2034 (deadlock) → 409 y marcado como REINTENTABLE', () => {
    const r = mapPrismaError(conocido('P2034'));
    expect(r?.status).toBe(HttpStatus.CONFLICT);
    // Es la diferencia clave: el POS puede reintentar en lugar de fallar.
    expect(r?.retryable).toBe(true);
  });

  it('errores de conexión → 503 reintentable, no 500', () => {
    for (const code of ['P1001', 'P1002', 'P1008', 'P1017']) {
      const r = mapPrismaError(conocido(code));
      expect(r?.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(r?.retryable).toBe(true);
    }
  });

  it('NUNCA expone el mensaje interno de Prisma al cliente', () => {
    const crudo =
      'Unique constraint failed on the fields: (`sku`) on table `Product`';
    const r = mapPrismaError(conocido('P2002', crudo));

    expect(r?.message).not.toContain('sku');
    expect(r?.message).not.toContain('Product');
    expect(r?.message).not.toContain('constraint');
  });

  it('devuelve null para códigos no contemplados (se tratan como 500)', () => {
    expect(mapPrismaError(conocido('P9999'))).toBeNull();
  });

  it('devuelve null para errores que no son de Prisma', () => {
    expect(mapPrismaError(new Error('cualquier cosa'))).toBeNull();
    expect(mapPrismaError('texto')).toBeNull();
    expect(mapPrismaError(null)).toBeNull();
  });

  describe('predicados', () => {
    it('isUniqueConstraintError sólo reconoce P2002', () => {
      expect(isUniqueConstraintError(conocido('P2002'))).toBe(true);
      expect(isUniqueConstraintError(conocido('P2025'))).toBe(false);
      expect(isUniqueConstraintError(new Error('x'))).toBe(false);
    });

    it('isWriteConflictError sólo reconoce P2034', () => {
      expect(isWriteConflictError(conocido('P2034'))).toBe(true);
      expect(isWriteConflictError(conocido('P2002'))).toBe(false);
      expect(isWriteConflictError(new Error('x'))).toBe(false);
    });
  });
});
