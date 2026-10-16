export const RECEIPT_BLOCKS = [
  'header',
  'meta',
  'items',
  'totals',
  'payments',
  'footer',
] as const;

export type ReceiptBlock = (typeof RECEIPT_BLOCKS)[number];

/**
 * Juego de caracteres con el que se habla con la impresora térmica.
 *
 * - `ascii`: sólo caracteres básicos. Funciona en CUALQUIER impresora, pero se
 *   pierden acentos y eñes ("Sueño" sale "Sueno"). Es el valor por defecto
 *   porque no puede salir basura.
 * - `cp850`: página de códigos 850 (Europa occidental), que casi todas las
 *   térmicas Epson-compatibles soportan. Imprime á é í ó ú ñ ü ¿ ¡. Si una
 *   impresora no la soporta, los acentos salen como símbolos raros: por eso se
 *   elige a mano y se valida con una impresión de prueba.
 */
export const RECEIPT_CHARSETS = ['ascii', 'cp850'] as const;
export type ReceiptCharset = (typeof RECEIPT_CHARSETS)[number];

export interface ReceiptLayout {
  blocks: ReceiptBlock[];
  charset: ReceiptCharset;
}

export const DEFAULT_RECEIPT_LAYOUT: ReceiptLayout = {
  blocks: [...RECEIPT_BLOCKS],
  charset: 'ascii',
};

const BLOCK_SET = new Set<string>(RECEIPT_BLOCKS);
const CHARSET_SET = new Set<string>(RECEIPT_CHARSETS);

/**
 * Acepta JSON sucio del cliente y deja un layout imprimible.
 * Hace falta `items` y `totals`: un ticket sin lineas o sin total no es un ticket.
 *
 * El ORDEN de `blocks` se respeta tal cual llega: es lo que permite reordenar
 * las secciones del ticket desde la pantalla de configuración.
 */
export function normalizeReceiptLayout(layout: unknown): ReceiptLayout {
  if (!layout || typeof layout !== 'object') {
    return {
      blocks: [...DEFAULT_RECEIPT_LAYOUT.blocks],
      charset: DEFAULT_RECEIPT_LAYOUT.charset,
    };
  }

  const rawCharset = (layout as { charset?: unknown }).charset;
  const charset: ReceiptCharset =
    typeof rawCharset === 'string' && CHARSET_SET.has(rawCharset)
      ? (rawCharset as ReceiptCharset)
      : DEFAULT_RECEIPT_LAYOUT.charset;

  const raw = (layout as { blocks?: unknown }).blocks;
  if (!Array.isArray(raw)) {
    return { blocks: [...DEFAULT_RECEIPT_LAYOUT.blocks], charset };
  }

  const seen = new Set<ReceiptBlock>();
  const blocks: ReceiptBlock[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || !BLOCK_SET.has(entry)) continue;
    const block = entry as ReceiptBlock;
    if (seen.has(block)) continue;
    seen.add(block);
    blocks.push(block);
  }

  if (!blocks.includes('items') || !blocks.includes('totals')) {
    throw new Error(
      'El layout del ticket debe incluir al menos los bloques items y totals',
    );
  }

  return { blocks, charset };
}

export const DEFAULT_COMPANY = {
  singletonKey: 'default',
  legalName: 'Mi Farmacia',
  tradeName: 'Mi Farmacia',
  rfc: '',
  address: '',
  ticketFooter:
    'Conserve su ticket. Para devoluciones presente este comprobante.',
} as const;
