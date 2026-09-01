export const RECEIPT_BLOCKS = [
  'header',
  'meta',
  'items',
  'totals',
  'payments',
  'footer',
] as const;

export type ReceiptBlock = (typeof RECEIPT_BLOCKS)[number];

export interface ReceiptLayout {
  blocks: ReceiptBlock[];
}

export const DEFAULT_RECEIPT_LAYOUT: ReceiptLayout = {
  blocks: [...RECEIPT_BLOCKS],
};

const BLOCK_SET = new Set<string>(RECEIPT_BLOCKS);

/**
 * Acepta JSON sucio del cliente y deja un layout imprimible.
 * Hace falta `items` y `totals`: un ticket sin lineas o sin total no es un ticket.
 */
export function normalizeReceiptLayout(layout: unknown): ReceiptLayout {
  if (!layout || typeof layout !== 'object') {
    return { blocks: [...DEFAULT_RECEIPT_LAYOUT.blocks] };
  }

  const raw = (layout as { blocks?: unknown }).blocks;
  if (!Array.isArray(raw)) {
    return { blocks: [...DEFAULT_RECEIPT_LAYOUT.blocks] };
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

  return { blocks };
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
