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

  /** Código (SKU) bajo el nombre de cada partida. */
  @IsBoolean({ message: 'Mostrar el código debe ser sí o no.' })
  showSku!: boolean;

  /**
   * Número de lote de cada partida. Útil para retiros de producto y para
   * clínicas que llevan trazabilidad; no es obligatorio en una nota.
   */
  @IsBoolean({ message: 'Mostrar el lote debe ser sí o no.' })
  showLot!: boolean;

  /**
   * Caducidad (MM/AAAA) de cada lote. Hay farmacias que prefieren no mostrarla
   * al cliente. Sólo cambia lo que se IMPRIME: el FEFO y el libro de
   * controlados siguen usando lote y caducidad.
   */
  @IsBoolean({ message: 'Mostrar la caducidad debe ser sí o no.' })
  showExpiry!: boolean;

  /** "IVA incluido" por tasa bajo el total (los precios ya lo incluyen). */
  @IsBoolean({ message: 'Mostrar el desglose de IVA debe ser sí o no.' })
  showTaxBreakdown!: boolean;

  @IsIn([...REMISSION_DENSITIES], {
    message: 'La densidad debe ser Automática, Cómoda o Compacta.',
  })
  density!: RemissionDensity;

  /*
   * Datos de la farmacia en el encabezado. Los VALORES viven en la ficha de la
   * farmacia (Configuración › Ticket); aquí sólo se decide si se IMPRIMEN en la
   * nota, porque el ticket y la nota van a públicos distintos (p. ej. una
   * clínica cliente quiere el RFC y el régimen; un particular no los necesita).
   * Un dato se imprime sólo si su interruptor está encendido Y la ficha lo tiene.
   * Todos encendidos de fábrica: así la nota de una instalación existente no
   * pierde nada al actualizar (el régimen fiscal es lo único que se agrega).
   * El nombre de la farmacia siempre se imprime: sin él la nota no identifica
   * a quién la emite.
   */

  /** Logo de la farmacia (o la marca de PharmaPOS si no hay logo). */
  @IsBoolean({ message: 'Mostrar el logo debe ser sí o no.' })
  showLogo!: boolean;

  /** Razón social, cuando es distinta del nombre comercial. */
  @IsBoolean({ message: 'Mostrar la razón social debe ser sí o no.' })
  showLegalName!: boolean;

  @IsBoolean({ message: 'Mostrar el RFC debe ser sí o no.' })
  showRfc!: boolean;

  /** Régimen fiscal tal como se capturó en la ficha (texto libre). */
  @IsBoolean({ message: 'Mostrar el régimen fiscal debe ser sí o no.' })
  showFiscalRegime!: boolean;

  @IsBoolean({ message: 'Mostrar el domicilio debe ser sí o no.' })
  showAddress!: boolean;

  @IsBoolean({ message: 'Mostrar el teléfono debe ser sí o no.' })
  showPhone!: boolean;

  @IsBoolean({ message: 'Mostrar el correo debe ser sí o no.' })
  showEmail!: boolean;
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
    showLot: true,
    showExpiry: true,
    showTaxBreakdown: false,
    density: 'AUTO',
    showLogo: true,
    showLegalName: true,
    showRfc: true,
    showFiscalRegime: true,
    showAddress: true,
    showPhone: true,
    showEmail: true,
  }),
});
