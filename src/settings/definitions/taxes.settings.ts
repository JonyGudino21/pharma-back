import { IsBoolean, IsIn } from 'class-validator';
import { defineSettings } from './settings-definition';

/**
 * Tratamientos de IVA. Mismos valores que el enum `TaxCategory` de Prisma, pero
 * declarados aquí para que el catálogo de configuración no dependa del modelo
 * de datos (se valida igual; un valor fuera de la lista se rechaza).
 */
export const TAX_CATEGORIES = ['GENERAL', 'ZERO', 'EXEMPT'] as const;
export type TaxCategoryValue = (typeof TAX_CATEGORIES)[number];

/** Tasas de IVA "general" que admite la ley: 16 % o 8 % (estímulo región fronteriza). */
export const GENERAL_RATES = [16, 8] as const;
export type GeneralRate = (typeof GENERAL_RATES)[number];

/**
 * IMPUESTOS (IVA).
 *
 * Los precios se capturan y exhiben CON IVA incluido (LFPC art. 7 Bis): esto no
 * es configurable. Lo configurable es la tasa general, el tratamiento con que
 * nacen los productos nuevos y si el ticket muestra el desglose.
 */
export class TaxSettings {
  /**
   * 16 % (general) u 8 % sólo si la farmacia está inscrita en el padrón del
   * estímulo de región fronteriza. Confirmar con el contador.
   */
  @IsIn([...GENERAL_RATES], { message: 'La tasa general debe ser 16% u 8%.' })
  generalRate!: GeneralRate;

  /** Con qué tratamiento se da de alta un producto si no se indica otro. */
  @IsIn([...TAX_CATEGORIES], {
    message: 'El tratamiento por defecto debe ser General, Tasa 0% o Exento.',
  })
  defaultCategory!: TaxCategoryValue;

  /** Imprimir en el ticket "IVA incluido" por tasa. */
  @IsBoolean({ message: 'Mostrar el desglose debe ser sí o no.' })
  showBreakdownOnTicket!: boolean;
}

export const TAX_SETTINGS = defineSettings<TaxSettings>({
  namespace: 'taxes',
  schema: TaxSettings,
  defaults: () => ({
    generalRate: 16,
    defaultCategory: 'ZERO',
    showBreakdownOnTicket: true,
  }),
});
