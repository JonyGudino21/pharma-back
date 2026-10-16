import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  PrintChannel,
  PrintDocument,
  SaleFlowStatus,
  SaleStatus,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import { SalesService } from './sales.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { InventoryBatchesService } from '../inventory/inventory-batches.service';
import { CashShiftService } from '../cash-shift/cash-shift.service';
import { PaymentService } from '../payment/payment.service';
import { SettingsService } from '../settings/settings.service';
import {
  createSettingsMock,
  type SettingsMock,
} from '../common/testing/settings.mock';

describe('SalesService — registro de impresiones de ticket', () => {
  let service: SalesService;
  let settings: SettingsMock;

  const tx = {
    sale: { findUnique: jest.fn() },
    saleReceiptPrint: {
      aggregate: jest.fn(),
      create: jest.fn(),
    },
  };

  const prisma = {
    receiptTemplate: { findFirst: jest.fn() },
    sale: { findUnique: jest.fn() },
    saleReceiptPrint: { findMany: jest.fn() },
    $transaction: jest.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    settings = createSettingsMock();
    prisma.$transaction.mockImplementation(
      (cb: (client: typeof tx) => unknown) => cb(tx),
    );

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: PrismaService, useValue: prisma },
        { provide: InventoryService, useValue: {} },
        { provide: InventoryBatchesService, useValue: {} },
        { provide: CashShiftService, useValue: {} },
        { provide: PaymentService, useValue: {} },
        { provide: SettingsService, useValue: settings },
      ],
    }).compile();

    service = moduleRef.get(SalesService);
  });

  it('rechaza imprimir una venta en borrador', async () => {
    tx.sale.findUnique.mockResolvedValue({
      id: 7,
      flowStatus: SaleFlowStatus.DRAFT,
    });

    await expect(
      service.registerPrint(7, 1, PrintChannel.BROWSER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.saleReceiptPrint.create).not.toHaveBeenCalled();
  });

  it('asigna copyNumber 1 a la primera impresión y 2 a la siguiente', async () => {
    tx.sale.findUnique.mockResolvedValue({
      id: 7,
      flowStatus: SaleFlowStatus.COMPLETED,
    });
    tx.saleReceiptPrint.aggregate
      .mockResolvedValueOnce({ _max: { copyNumber: null } })
      .mockResolvedValueOnce({ _max: { copyNumber: 1 } });
    tx.saleReceiptPrint.create
      .mockResolvedValueOnce({ id: 1, copyNumber: 1, channel: 'BROWSER' })
      .mockResolvedValueOnce({ id: 2, copyNumber: 2, channel: 'THERMAL' });

    const original = await service.registerPrint(7, 1, PrintChannel.BROWSER);
    const copia = await service.registerPrint(7, 1, PrintChannel.THERMAL);

    expect(original.copyNumber).toBe(1);
    expect(copia.copyNumber).toBe(2);
    const creaciones = tx.saleReceiptPrint.create.mock.calls as Array<
      [{ data: { copyNumber: number; printedById: number } }]
    >;
    expect(creaciones[0][0].data.copyNumber).toBe(1);
    expect(creaciones[0][0].data.printedById).toBe(1);
  });

  it('reintenta si dos cajas reclaman el mismo copyNumber a la vez', async () => {
    tx.sale.findUnique.mockResolvedValue({
      id: 7,
      flowStatus: SaleFlowStatus.COMPLETED,
    });
    tx.saleReceiptPrint.aggregate
      .mockResolvedValueOnce({ _max: { copyNumber: 0 } })
      .mockResolvedValueOnce({ _max: { copyNumber: 1 } });
    tx.saleReceiptPrint.create
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      )
      .mockResolvedValueOnce({ id: 2, copyNumber: 2 });

    const print = await service.registerPrint(7, 1, PrintChannel.BROWSER);
    expect(print.copyNumber).toBe(2);
    expect(tx.saleReceiptPrint.create).toHaveBeenCalledTimes(2);
  });

  it('no imprime con una plantilla inexistente o inactiva', async () => {
    prisma.receiptTemplate.findFirst.mockResolvedValue(null);
    await expect(
      service.registerPrint(7, 1, PrintChannel.BROWSER, 99),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lista impresiones de una venta que existe y 404 si no', async () => {
    prisma.sale.findUnique.mockResolvedValueOnce({ id: 7 });
    prisma.saleReceiptPrint.findMany.mockResolvedValue([{ copyNumber: 1 }]);
    await expect(service.listPrints(7)).resolves.toEqual([{ copyNumber: 1 }]);

    prisma.sale.findUnique.mockResolvedValueOnce(null);
    await expect(service.listPrints(99)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('nota de remisión', () => {
    const completada = {
      id: 7,
      flowStatus: SaleFlowStatus.COMPLETED,
      status: SaleStatus.COMPLETED,
    };

    it('numera las copias POR DOCUMENTO: la remisión tiene su propio original', async () => {
      tx.sale.findUnique.mockResolvedValue(completada);
      // El ticket ya va en la copia 3; la remisión nunca se ha impreso.
      tx.saleReceiptPrint.aggregate.mockResolvedValue({
        _max: { copyNumber: null },
      });
      tx.saleReceiptPrint.create.mockResolvedValue({
        id: 9,
        copyNumber: 1,
        document: 'REMISSION',
      });

      const print = await service.registerPrint(
        7,
        1,
        PrintChannel.BROWSER,
        undefined,
        PrintDocument.REMISSION,
      );

      expect(print.copyNumber).toBe(1);
      expect(tx.saleReceiptPrint.aggregate).toHaveBeenCalledWith({
        where: { saleId: 7, document: PrintDocument.REMISSION },
        _max: { copyNumber: true },
      });
      const [llamada] = tx.saleReceiptPrint.create.mock.calls[0] as [
        { data: { document: PrintDocument } },
      ];
      expect(llamada.data.document).toBe(PrintDocument.REMISSION);
    });

    it('sin indicar documento registra un TICKET (compatibilidad)', async () => {
      tx.sale.findUnique.mockResolvedValue(completada);
      tx.saleReceiptPrint.aggregate.mockResolvedValue({
        _max: { copyNumber: null },
      });
      tx.saleReceiptPrint.create.mockResolvedValue({ id: 1, copyNumber: 1 });

      await service.registerPrint(7, 1, PrintChannel.BROWSER);

      expect(tx.saleReceiptPrint.aggregate).toHaveBeenCalledWith({
        where: { saleId: 7, document: PrintDocument.TICKET },
        _max: { copyNumber: true },
      });
    });

    it('rechaza la remisión si el gerente la desactivó (pantalla desactualizada)', async () => {
      settings.set('remission', { enabled: false });

      await expect(
        service.registerPrint(
          7,
          1,
          PrintChannel.BROWSER,
          undefined,
          PrintDocument.REMISSION,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('desactivar la remisión NO afecta al ticket', async () => {
      settings.set('remission', { enabled: false });
      tx.sale.findUnique.mockResolvedValue(completada);
      tx.saleReceiptPrint.aggregate.mockResolvedValue({
        _max: { copyNumber: null },
      });
      tx.saleReceiptPrint.create.mockResolvedValue({ id: 1, copyNumber: 1 });

      await expect(
        service.registerPrint(7, 1, PrintChannel.BROWSER),
      ).resolves.toMatchObject({ copyNumber: 1 });
    });

    it.each([
      ['flujo cancelado', SaleFlowStatus.CANCELLED, SaleStatus.PENDING],
      ['estado anulado', SaleFlowStatus.COMPLETED, SaleStatus.CANCELLED],
    ])(
      'no emite comprobante de una venta anulada (%s)',
      async (_, flow, st) => {
        tx.sale.findUnique.mockResolvedValue({
          id: 7,
          flowStatus: flow,
          status: st,
        });

        await expect(
          service.registerPrint(
            7,
            1,
            PrintChannel.BROWSER,
            undefined,
            PrintDocument.REMISSION,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(tx.saleReceiptPrint.create).not.toHaveBeenCalled();
      },
    );

    it('lista las impresiones filtrando por documento', async () => {
      prisma.sale.findUnique.mockResolvedValue({ id: 7 });
      prisma.saleReceiptPrint.findMany.mockResolvedValue([]);

      await service.listPrints(7, PrintDocument.REMISSION);

      const [args] = prisma.saleReceiptPrint.findMany.mock.calls[0] as [
        { where: unknown },
      ];
      expect(args.where).toEqual({ saleId: 7, document: 'REMISSION' });
    });
  });

  describe('folio de la venta', () => {
    afterEach(() => jest.useRealTimers());

    it('usa la fecha de la farmacia (México), no la de UTC', () => {
      // 18:26 del 10/10 en México = 00:26 del 11/10 en UTC.
      jest.useFakeTimers({ now: new Date('2026-10-11T00:26:00.000Z') });
      const folio = (
        service as unknown as { generateInvoiceNumber(id: number): string }
      ).generateInvoiceNumber(4);
      expect(folio).toBe('FAC-20261010-000004');
    });
  });
});
