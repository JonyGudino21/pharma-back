import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ControlledLogEntryType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface ControlledExportQuery {
  startDate?: string;
  endDate?: string;
  productId?: number;
  entryType?: ControlledLogEntryType;
}

export interface ControlledExportResult {
  filename: string;
  /** Contenido CSV listo para descargar (incluye BOM para Excel). */
  content: string;
  /** Huella del contenido: permite demostrar que el archivo no fue alterado. */
  integrityHash: string;
  totalEntries: number;
}

/**
 * Exportación del LIBRO DE MEDICAMENTOS CONTROLADOS para inspección sanitaria.
 *
 * El endpoint de consulta existente pagina y filtra, que sirve para la pantalla
 * pero no para una visita de COFEPRIS: ahí se pide un documento del periodo
 * completo, con los datos obligatorios de cada dispensación, totales por
 * sustancia y constancia de quién lo emitió.
 *
 * Decisiones de formato deliberadas:
 *  - CSV y no PDF: es el formato que el inspector puede cotejar y que el
 *    contador puede reprocesar. Un PDF se genera después a partir de esto.
 *  - BOM UTF-8 al inicio: sin él, Excel en Windows destroza los acentos, y este
 *    archivo se abre en Excel el 100% de las veces.
 *  - Huella SHA-256 del contenido, impresa en el propio archivo: si alguien
 *    edita una fila, la huella deja de cuadrar. Es la contraparte exportada de
 *    la inmutabilidad que los triggers garantizan en la base.
 */
@Injectable()
export class ControlledLogExportService {
  private readonly logger = new Logger(ControlledLogExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Escapa un campo según RFC 4180.
   *
   * Sin esto, un nombre de paciente con coma ("Pérez, Juan") o un motivo con
   * salto de línea partirían la fila y desalinearían TODO el archivo: un
   * documento regulatorio ilegible. Las comillas internas se duplican.
   */
  private csvField(value: unknown): string {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (/[",\n\r;]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  private csvRow(fields: unknown[]): string {
    return fields.map((f) => this.csvField(f)).join(',');
  }

  private formatDate(d: Date): string {
    // Fecha y hora en horario de la farmacia, no en UTC: el inspector compara
    // contra las recetas físicas, que están en hora local.
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  }

  async exportCsv(
    query: ControlledExportQuery,
    requestedBy: { id: number; userName: string },
  ): Promise<ControlledExportResult> {
    const where: Prisma.ControlledSaleLogWhereInput = {};

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }
    if (query.productId != null) where.productId = query.productId;
    if (query.entryType) where.entryType = query.entryType;

    // Sin paginación a propósito: un libro parcial no sirve para una inspección.
    // El rango de fechas es el que acota el volumen.
    const [entries, company] = await Promise.all([
      this.prisma.controlledSaleLog.findMany({
        where,
        orderBy: { createdAt: 'asc' }, // orden cronológico, como exige un libro
        include: {
          product: { select: { name: true, sku: true, strength: true, format: true } },
          batch: { select: { lotNumber: true, expiryDate: true } },
          soldBy: { select: { firstName: true, lastName: true, userName: true } },
          sale: { select: { invoiceNumber: true } },
        },
      }),
      this.prisma.company.findFirst(),
    ]);

    const lineas: string[] = [];

    // ── Encabezado del documento ─────────────────────────────────────────────
    lineas.push(this.csvRow(['LIBRO DE MEDICAMENTOS CONTROLADOS']));
    lineas.push(this.csvRow(['Establecimiento', company?.tradeName ?? 'No configurado']));
    lineas.push(this.csvRow(['Razón social', company?.legalName ?? 'No configurada']));
    lineas.push(this.csvRow(['RFC', company?.rfc ?? 'No configurado']));
    lineas.push(this.csvRow(['Domicilio', company?.address ?? 'No configurado']));
    lineas.push(
      this.csvRow([
        'Periodo',
        query.startDate ? `Desde ${query.startDate}` : 'Sin fecha inicial',
        query.endDate ? `Hasta ${query.endDate}` : 'Sin fecha final',
      ]),
    );
    lineas.push(this.csvRow(['Emitido por', requestedBy.userName]));
    lineas.push(this.csvRow(['Fecha de emisión', this.formatDate(new Date())]));
    lineas.push(this.csvRow(['Total de asientos', entries.length]));
    lineas.push('');

    // ── Detalle ──────────────────────────────────────────────────────────────
    lineas.push(
      this.csvRow([
        'Folio asiento',
        'Fecha y hora',
        'Tipo de movimiento',
        'Medicamento',
        'SKU',
        'Concentración',
        'Forma farmacéutica',
        'Lote',
        'Caducidad',
        'Cantidad',
        'Folio de receta',
        'Médico',
        'Cédula profesional',
        'Paciente',
        'Despachó',
        'Folio de venta',
      ]),
    );

    for (const e of entries) {
      lineas.push(
        this.csvRow([
          e.id,
          this.formatDate(e.createdAt),
          e.entryType,
          e.product.name,
          e.product.sku,
          e.product.strength ?? '',
          e.product.format ?? '',
          e.batch?.lotNumber ?? 'SIN LOTE',
          e.batch?.expiryDate
            ? e.batch.expiryDate.toISOString().slice(0, 10)
            : '',
          e.quantity,
          e.prescriptionNo ?? '',
          e.doctorName ?? '',
          e.doctorLicense ?? '',
          e.patientName ?? '',
          `${e.soldBy.firstName} ${e.soldBy.lastName}`.trim() || e.soldBy.userName,
          e.sale?.invoiceNumber ?? '',
        ]),
      );
    }

    // ── Totales por sustancia ────────────────────────────────────────────────
    // El inspector no suma a mano: pide el consolidado por medicamento.
    const porProducto = new Map<
      string,
      { nombre: string; sku: string; dispensado: number; devuelto: number; destruido: number }
    >();

    for (const e of entries) {
      const clave = e.product.sku;
      const acc =
        porProducto.get(clave) ??
        { nombre: e.product.name, sku: e.product.sku, dispensado: 0, devuelto: 0, destruido: 0 };

      if (e.entryType === ControlledLogEntryType.DISPENSE) acc.dispensado += e.quantity;
      else if (e.entryType === ControlledLogEntryType.RETURN) acc.devuelto += e.quantity;
      else if (e.entryType === ControlledLogEntryType.DESTRUCTION) acc.destruido += e.quantity;

      porProducto.set(clave, acc);
    }

    lineas.push('');
    lineas.push(this.csvRow(['RESUMEN POR MEDICAMENTO']));
    lineas.push(
      this.csvRow(['SKU', 'Medicamento', 'Dispensado', 'Devuelto', 'Destruido', 'Neto dispensado']),
    );
    for (const r of [...porProducto.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))) {
      lineas.push(
        this.csvRow([
          r.sku,
          r.nombre,
          r.dispensado,
          r.devuelto,
          r.destruido,
          r.dispensado - r.devuelto,
        ]),
      );
    }

    // ── Huella de integridad ─────────────────────────────────────────────────
    // Se calcula sobre el cuerpo y se añade al final, de modo que recalcularla
    // sobre el archivo (sin la última línea) permite verificar que nada cambió.
    const cuerpo = lineas.join('\r\n');
    const integrityHash = createHash('sha256').update(cuerpo, 'utf8').digest('hex');

    const contenido =
      '﻿' + // BOM: sin esto Excel en Windows rompe los acentos
      cuerpo +
      '\r\n\r\n' +
      this.csvRow(['Huella de integridad (SHA-256)', integrityHash]) +
      '\r\n';

    const sello = new Date().toISOString().slice(0, 10);
    const filename = `libro-controlados_${sello}.csv`;

    this.logger.log(
      `Libro de controlados exportado por ${requestedBy.userName} (usuario #${requestedBy.id}): ` +
        `${entries.length} asiento(s), periodo ${query.startDate ?? 'inicio'} a ${query.endDate ?? 'hoy'}, ` +
        `huella ${integrityHash.slice(0, 12)}.`,
    );

    return { filename, content: contenido, integrityHash, totalEntries: entries.length };
  }
}
