import type { ConfigService } from '@nestjs/config';
import {
  SETTINGS_REGISTRY,
  type SettingsMap,
  type SettingsNamespace,
} from 'src/settings/definitions';

type Overrides = { [N in SettingsNamespace]?: Partial<SettingsMap[N]> };

/**
 * Doble de `SettingsService` para pruebas unitarias.
 *
 * Parte de los valores de FÁBRICA reales de cada sección (no de una copia): si
 * un default cambia, las pruebas lo ven. `set` permite cambiar un ajuste a
 * mitad de una prueba ("con cierre ciego activado…").
 */
export function createSettingsMock(initial: Overrides = {}) {
  const noEnv = { get: () => undefined } as unknown as ConfigService;
  let overrides: Overrides = { ...initial };

  const valuesOf = <N extends SettingsNamespace>(ns: N): SettingsMap[N] =>
    ({
      ...SETTINGS_REGISTRY[ns].defaults(noEnv),
      ...(overrides[ns] ?? {}),
    }) as SettingsMap[N];

  return {
    get: jest.fn(<N extends SettingsNamespace>(ns: N) =>
      Promise.resolve(valuesOf(ns)),
    ),
    set<N extends SettingsNamespace>(ns: N, values: Partial<SettingsMap[N]>) {
      overrides = {
        ...overrides,
        [ns]: { ...(overrides[ns] ?? {}), ...values },
      };
    },
    reset() {
      overrides = { ...initial };
    },
  };
}

export type SettingsMock = ReturnType<typeof createSettingsMock>;
