import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildPaginationMeta,
  resolvePagination,
} from 'src/common/utils/pagination.util';
import type { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';
import {
  SETTINGS_REGISTRY,
  type SettingsMap,
  type SettingsNamespace,
} from './definitions';

/**
 * Cuánto vive una sección en memoria. Acota cuánto tarda en verse un cambio
 * hecho desde OTRA instancia del backend (hoy hay una; en la nube puede haber
 * varias). En esta instancia el cambio se ve de inmediato: `update` invalida.
 * Siguiente escalón cuando haya varias réplicas: invalidación por Redis pub/sub.
 */
export const SETTINGS_CACHE_TTL_MS = 30_000;

type SettingsValues = Record<string, unknown>;

export interface SettingsSnapshot<
  N extends SettingsNamespace = SettingsNamespace,
> {
  namespace: N;
  values: SettingsMap[N];
  defaults: SettingsMap[N];
  /** 0 = nunca se ha guardado (se usan los valores de fábrica). */
  version: number;
  updatedAt: Date | null;
  updatedBy: { id: number; name: string } | null;
}

type AppSettingRow = Prisma.AppSettingGetPayload<{
  include: {
    updatedBy: { select: { id: true; firstName: true; lastName: true } };
  };
}>;

/**
 * CONFIGURACIÓN DE OPERACIÓN (inventario, caja…).
 *
 * Garantías:
 *  1. Nunca devuelve un valor inválido. Lo guardado se valida al leer; si una
 *     versión anterior dejó algo fuera de rango, se usan los de fábrica y se
 *     registra el error. Un ajuste roto no debe tumbar el cobro.
 *  2. Dos gerentes editando a la vez no se pisan: bloqueo optimista por
 *     `version` (409 al segundo).
 *  3. Cada cambio deja rastro en `AppSettingAudit`, en la misma transacción.
 *  4. Leer es barato: caché en memoria con TTL, invalidada al escribir.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<
    SettingsNamespace,
    { snapshot: SettingsSnapshot; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Valores vigentes de una sección. Es lo que usan los demás módulos. */
  async get<N extends SettingsNamespace>(
    namespace: N,
  ): Promise<SettingsMap[N]> {
    const snapshot = await this.getSnapshot(namespace);
    return snapshot.values;
  }

  /** Valores + metadatos (versión, quién y cuándo). Es lo que ve la pantalla. */
  async getSnapshot<N extends SettingsNamespace>(
    namespace: N,
  ): Promise<SettingsSnapshot<N>> {
    const hit = this.cache.get(namespace);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.snapshot as SettingsSnapshot<N>;
    }

    const row = await this.prisma.appSetting.findUnique({
      where: { namespace },
      include: {
        updatedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const snapshot = this.materialize(namespace, row);
    this.cache.set(namespace, {
      snapshot,
      expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS,
    });
    return snapshot;
  }

  /**
   * Cambia una sección. `values` es PARCIAL: sólo lo que el usuario tocó.
   * `version` es la que el usuario tenía en pantalla.
   */
  async update<N extends SettingsNamespace>(
    namespace: N,
    input: { version: number; values: SettingsValues },
    userId: number,
  ): Promise<{ snapshot: SettingsSnapshot<N>; changed: string[] }> {
    const definition = SETTINGS_REGISTRY[namespace];
    const defaults = definition.defaults(
      this.config,
    ) as unknown as SettingsValues;

    const unknown = Object.keys(input.values).filter((k) => !(k in defaults));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Ajuste desconocido en ${namespace}: ${unknown.join(', ')}`,
      );
    }

    let changed: string[];
    try {
      changed = await this.prisma.$transaction(async (tx) => {
        const row = await tx.appSetting.findUnique({ where: { namespace } });
        const currentVersion = row?.version ?? 0;

        if (input.version !== currentVersion) {
          throw this.staleVersion();
        }

        const current = this.materialize(namespace, row)
          .values as unknown as SettingsValues;
        const next = { ...current, ...input.values };

        const errors = this.validate(namespace, next);
        if (errors.length > 0) {
          // Mismo formato que el ValidationPipe: `message` como arreglo.
          throw new BadRequestException(errors);
        }

        const keys = Object.keys(next).filter(
          (k) => !Object.is(current[k], next[k]),
        );
        if (keys.length === 0) return [];

        const value = next as Prisma.InputJsonObject;
        if (row) {
          // Compare-and-swap: si otra transacción ya subió la versión entre la
          // lectura y esta escritura, no se toca nada.
          const cas = await tx.appSetting.updateMany({
            where: { namespace, version: currentVersion },
            data: { value, version: { increment: 1 }, updatedById: userId },
          });
          if (cas.count === 0) throw this.staleVersion();
        } else {
          await tx.appSetting.create({
            data: { namespace, value, version: 1, updatedById: userId },
          });
        }

        await tx.appSettingAudit.createMany({
          data: keys.map((key) => ({
            namespace,
            key,
            oldValue: current[key] as Prisma.InputJsonValue,
            newValue: next[key] as Prisma.InputJsonValue,
            changedById: userId,
          })),
        });

        return keys;
      });
    } catch (error) {
      // Dos "primer guardado" simultáneos: el segundo choca con la llave.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw this.staleVersion();
      }
      throw error;
    }

    this.cache.delete(namespace);

    if (changed.length > 0) {
      // Línea grepeable, mismo formato `clave=valor` que la auditoría de acceso.
      this.logger.log(
        `event=settings.updated namespace=${namespace} keys=${changed.join(',')} userId=${userId}`,
      );
    }

    return { snapshot: await this.getSnapshot(namespace), changed };
  }

  /** Bitácora de cambios de una sección, lo más reciente primero. */
  async history(
    namespace: SettingsNamespace,
    pagination?: PaginationParamsDto,
  ) {
    const page = resolvePagination(pagination);
    const where = { namespace };

    const [rows, total] = await Promise.all([
      this.prisma.appSettingAudit.findMany({
        where,
        orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
        skip: page.skip,
        take: page.take,
        include: {
          changedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.appSettingAudit.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        key: r.key,
        oldValue: r.oldValue,
        newValue: r.newValue,
        changedAt: r.changedAt,
        changedBy: {
          id: r.changedBy.id,
          name: `${r.changedBy.firstName} ${r.changedBy.lastName}`.trim(),
        },
      })),
      pagination: buildPaginationMeta(total, page),
    };
  }

  /** Olvida la caché. Para pruebas y para una futura invalidación distribuida. */
  invalidate(namespace?: SettingsNamespace): void {
    if (namespace) this.cache.delete(namespace);
    else this.cache.clear();
  }

  // ── Internos ──────────────────────────────────────────────────────────────

  /** Fila guardada → valores completos y VÁLIDOS. */
  private materialize<N extends SettingsNamespace>(
    namespace: N,
    row: AppSettingRow | Prisma.AppSettingGetPayload<object> | null,
  ): SettingsSnapshot<N> {
    const definition = SETTINGS_REGISTRY[namespace];
    const defaults = definition.defaults(
      this.config,
    ) as unknown as SettingsValues;

    // Sólo las llaves que la versión actual conoce: un ajuste retirado del
    // código no debe invalidar toda la sección.
    const stored =
      row?.value && typeof row.value === 'object' && !Array.isArray(row.value)
        ? (row.value as SettingsValues)
        : {};
    const known = Object.fromEntries(
      Object.entries(stored).filter(([k]) => k in defaults),
    );
    let values: SettingsValues = { ...defaults, ...known };

    const errors = this.validate(namespace, values);
    if (errors.length > 0) {
      this.logger.error(
        `event=settings.invalid namespace=${namespace} errors="${errors.join(' | ')}" — se usan los valores de fábrica`,
      );
      values = defaults;
    }

    const updatedBy =
      row && 'updatedBy' in row && row.updatedBy
        ? {
            id: row.updatedBy.id,
            name: `${row.updatedBy.firstName} ${row.updatedBy.lastName}`.trim(),
          }
        : null;

    return {
      namespace,
      values: values as unknown as SettingsMap[N],
      defaults: defaults as unknown as SettingsMap[N],
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt ?? null,
      updatedBy,
    };
  }

  /** Mensajes de error (vacío si es válido). Tipos, rangos y reglas cruzadas. */
  private validate(
    namespace: SettingsNamespace,
    values: SettingsValues,
  ): string[] {
    const definition = SETTINGS_REGISTRY[namespace];
    const instance = plainToInstance(
      definition.schema as new () => object,
      values,
    );
    const errors = validateSync(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const messages = flatten(errors);
    if (messages.length > 0) return messages;

    const cross = definition.crossValidate as
      | ((v: SettingsValues) => string[])
      | undefined;
    return cross ? cross(values) : [];
  }

  private staleVersion() {
    return new ConflictException(
      'Otro usuario modificó esta configuración mientras la editabas. Recarga para ver los valores actuales.',
    );
  }
}

function flatten(errors: ValidationError[]): string[] {
  return errors.flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...flatten(e.children ?? []),
  ]);
}
