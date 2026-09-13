import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * ¿Es una violación de restricción única (P2002)?
 * Se usa para lógica de reintento local (folios, singletons, idempotencia).
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/**
 * ¿Es un conflicto de escritura / fallo de serialización (P2034)?
 *
 * PostgreSQL aborta una de dos transacciones cuando detecta un deadlock o no
 * puede serializarlas. El ordenamiento determinista por productId reduce la
 * frecuencia, pero no la elimina: bajo carga real sigue ocurriendo, y es un
 * error REINTENTABLE, no un fallo del servidor.
 */
export function isWriteConflictError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  );
}

export interface MappedPrismaError {
  status: HttpStatus;
  /** Mensaje seguro para el cliente: NO revela tabla, columna ni constraint. */
  message: string;
  /** true si el cliente puede reintentar la misma operación tal cual. */
  retryable: boolean;
}

/**
 * Traduce un error conocido de Prisma a una respuesta HTTP correcta.
 *
 * PROBLEMA QUE RESUELVE:
 * El filtro global sólo distinguía `HttpException` de `Error`, así que cualquier
 * error de Prisma salía como **HTTP 500 con el texto crudo de Prisma**. Eso
 * tenía dos consecuencias malas a la vez:
 *
 *   1. Semántica equivocada. Un SKU duplicado (409), un registro inexistente
 *      (404) o un deadmlock reintentable (409) se reportaban como "fallo del
 *      servidor", y el frontend no podía reaccionar de forma útil.
 *   2. Fuga de información. El mensaje de Prisma incluye el nombre de la tabla y
 *      de la columna del constraint violado, es decir, parte del esquema.
 *
 * El detalle técnico sigue yendo al LOG del servidor, que es su lugar.
 *
 * @returns el mapeo, o null si el código no está contemplado (se tratará como 500)
 */
export function mapPrismaError(error: unknown): MappedPrismaError | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    // Errores de inicialización: la base no está accesible. Es 503, no 500:
    // le dice al balanceador y al cliente que el problema es transitorio.
    if (error instanceof Prisma.PrismaClientInitializationError) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message:
          'El servicio no está disponible temporalmente. Intenta de nuevo en unos momentos.',
        retryable: true,
      };
    }
    return null;
  }

  switch (error.code) {
    case 'P2002':
      return {
        status: HttpStatus.CONFLICT,
        message: 'Ya existe un registro con ese valor único.',
        retryable: false,
      };

    case 'P2025':
      return {
        status: HttpStatus.NOT_FOUND,
        message: 'El registro solicitado no existe o ya fue eliminado.',
        retryable: false,
      };

    case 'P2003':
      return {
        status: HttpStatus.CONFLICT,
        message:
          'La operación está bloqueada porque existen registros relacionados.',
        retryable: false,
      };

    case 'P2000':
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'Uno de los valores enviados excede la longitud permitida.',
        retryable: false,
      };

    case 'P2034':
      // Deadlock o fallo de serialización: la BD abortó la transacción para
      // preservar la consistencia. Reintentar suele resolverlo.
      return {
        status: HttpStatus.CONFLICT,
        message:
          'Otra operación modificó los mismos datos al mismo tiempo. Vuelve a intentarlo.',
        retryable: true,
      };

    case 'P1001':
    case 'P1002':
    case 'P1008':
    case 'P1017':
      // Conexión perdida, timeout o servidor caído.
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message:
          'El servicio no está disponible temporalmente. Intenta de nuevo en unos momentos.',
        retryable: true,
      };

    default:
      return null;
  }
}
