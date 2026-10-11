import { IsBoolean, IsIn, IsString, MaxLength } from 'class-validator';
import { defineSettings } from './settings-definition';

/**
 * Tamaños de hoja que admite la nota de remisión. México usa Carta de forma
 * casi universal; A4 existe para quien compró papel o impresora de otro país.
 */
export const REMISSION_PAPERS = ['LETTER', 'A4'] as const;
export type RemissionPaper = (typeof REMISSION_PAPERS)[number];

/**
 * Densidad de la tabla de partidas.
 *  - AUTO: cómoda (renglón amplio con lote y código debajo) en notas cortas y
 *    compacta (renglón de una línea) cuando no cabrían en una hoja. Recomendado.
 *  - COMFORTABLE / COMPACT: fuerzan una u otra.
 */
export const REMISSION_DENSITIES = ['AUTO', 'COMFORTABLE', 'COMPACT'] as const;
export type RemissionDensity = (typeof REMISSION_DENSITIES)[number];

/**
 * NOTA DE REMISIÓN (hoja completa).
 *
 * Documento no fiscal que acompaña una entrega: datos de la farmacia y del
 * cliente, partidas con precio y total con letra. Se emite desde una venta ya
 * cobrada; el contenido lo toma de la venta guardada, nunca recalcula importes
 * (ADR-0016). Aquí vive sólo lo que el gerente puede ajustar.
 *
 * Los textos se imprimen tal cual: el límite de longitud evita que una leyenda
 * larga desplace las partidas y parta la hoja.
 */
export class RemissionSettings {
  /** Apagarlo oculta el botón en el POS y rechaza el registro en el servidor. */
  @IsBoolean({ message: 'Activar la nota de remisión debe ser sí o no.' })
  enabled!: boolean;

  @IsIn([...REMISSION_PAPERS], {
    message: 'El tamaño de hoja debe ser Carta o A4.',
  })
  paper!: RemissionPaper;

  /**
   * Leyenda al pie. Por defecto aclara que NO es un CFDI: sin esa línea un
   * cliente podría presentarla como factura.
   */
  @IsString({ message: 'La leyenda debe ser texto.' })
  @MaxLength(300, { message: 'La leyenda no puede pasar de 300 caracteres.' })
  legend!: string;

  /** Condiciones (devoluciones, vigencia, crédito). Vacío = no se imprime. */
  @IsString({ message: 'Las condiciones deben ser texto.' })
  @MaxLength(600, {
    message: 'Las condiciones no pueden pasar de 600 caracteres.',
  })
  terms!: string;

  /** Líneas "Entregó" y "Recibí de conformidad". */
  @IsBoolean({ message: 'Mostrar firmas debe ser sí o no.' })
  showSignatures!: boolean;

  /** Forma de pago, pagado y saldo. Imprescindible para ventas a crédito. */
  @IsBoolean({ message: 'Mostrar pagos debe ser sí o no.' })
  showPayments!: boolean;

  /** Columna de SKU/código en las partidas. */
  @IsBoolean({ message: 'Mostrar el código debe ser sí o no.' })
  showSku!: boolean;

  /** "IVA incluido" por tasa bajo el total (los precios ya lo incluyen). */
  @IsBoolean({ message: 'Mostrar el desglose de IVA debe ser sí o no.' })
  showTaxBreakdown!: boolean;

  @IsIn([...REMISSION_DENSITIES], {
    message: 'La densidad debe ser Automática, Cómoda o Compacta.',
  })
  density!: RemissionDensity;
}

export const DEFAULT_REMISSION_LEGEND =
  'Nota de remisión. Documento sin validez fiscal: no es un CFDI.';

export const REMISSION_SETTINGS = defineSettings<RemissionSettings>({
  namespace: 'remission',
  schema: RemissionSettings,
  defaults: () => ({
    enabled: true,
    paper: 'LETTER',
    legend: DEFAULT_REMISSION_LEGEND,
    terms: '',
    showSignatures: true,
    showPayments: true,
    showSku: true,
    showTaxBreakdown: false,
    density: 'AUTO',
  }),
});
