import type { ConfigService } from '@nestjs/config';
import type { ClassConstructor } from 'class-transformer';

/**
 * Contrato de una SECCIÓN de configuración (inventario, caja…).
 *
 * Cada sección declara en un solo lugar:
 *  - `schema`: clase con decoradores de class-validator. Es la única fuente de
 *    verdad de tipos, rangos y mensajes. Se valida al LEER (lo guardado podría
 *    venir de una versión anterior) y al ESCRIBIR.
 *  - `defaults`: valores de fábrica. Pueden leer el entorno validado para que
 *    una instalación existente conserve su comportamiento (p. ej. la tolerancia
 *    del arqueo que antes vivía en `TOLERANCE_THRESHOLD`).
 *  - `crossValidate`: reglas entre campos que un decorador no expresa
 *    ("crítico" debe ser menor que "advertencia").
 *
 * Agregar un ajuste nuevo = agregar el campo aquí con su default. Sin
 * migración: la fila guardada no lo trae y se completa con el default.
 */
export interface SettingsDefinition<T extends object> {
  namespace: string;
  schema: ClassConstructor<T>;
  defaults(config: ConfigService): T;
  // Propiedad (no método): se pasa y se invoca suelta sin depender de `this`.
  crossValidate?: (values: T) => string[];
}

/** Ayuda de tipos: conserva `T` inferido sin repetirlo. */
export function defineSettings<T extends object>(
  definition: SettingsDefinition<T>,
): SettingsDefinition<T> {
  return definition;
}
