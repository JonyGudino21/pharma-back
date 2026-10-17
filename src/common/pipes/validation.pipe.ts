import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

/** Una falla de validación aplanada, con la ruta completa del campo. */
export interface CampoInvalido {
  campo: string;
  /** `no_permitido` = el DTO no declara el campo (whitelist). */
  regla: string;
  mensaje: string;
}

/** Código de error para "la pantalla mandó un campo que el servidor no conoce". */
export const CODIGO_CAMPOS_NO_RECONOCIDOS = 'CAMPOS_NO_RECONOCIDOS';

function aplanar(errores: ValidationError[], prefijo = ''): CampoInvalido[] {
  const salida: CampoInvalido[] = [];
  for (const e of errores) {
    const campo = prefijo ? `${prefijo}.${e.property}` : e.property;
    for (const [regla, mensaje] of Object.entries(e.constraints ?? {})) {
      salida.push({
        campo,
        regla: regla === 'whitelistValidation' ? 'no_permitido' : regla,
        mensaje,
      });
    }
    if (e.children?.length) salida.push(...aplanar(e.children, campo));
  }
  return salida;
}

/**
 * Convierte las fallas de class-validator en un 400 entendible.
 *
 * El caso que motivó esto: el alta de producto mandaba `isActive` y el cajero
 * vio «property isActive should not exist» frente al cliente. Un campo que el
 * servidor no reconoce casi siempre es una pantalla de OTRA versión (caja con
 * la versión anterior abierta) o un error de programación: el mensaje lo dice
 * en español y pide recargar; el detalle técnico viaja en `campos`.
 */
export function construirErrorDeValidacion(
  errores: ValidationError[],
): BadRequestException {
  const campos = aplanar(errores);
  const desconocidos = campos.filter((c) => c.regla === 'no_permitido');

  if (desconocidos.length > 0) {
    const nombres = desconocidos.map((c) => `«${c.campo}»`).join(', ');
    return new BadRequestException({
      message:
        `La pantalla envió datos que el servidor no reconoce (${nombres}). ` +
        'Recarga la página (F5) para usar la versión más reciente; si continúa, reporta este error con su referencia.',
      codigo: CODIGO_CAMPOS_NO_RECONOCIDOS,
      campos,
    });
  }

  return new BadRequestException({
    message: campos.map((c) => c.mensaje).join(', '),
    campos,
  });
}

/**
 * El ValidationPipe global. Única fuente de verdad: lo usan la app
 * (configure-http.ts) y las pruebas de contrato, para que nunca difieran.
 */
export function crearValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: construirErrorDeValidacion,
  });
}
