import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrintChannel, SaleFlowStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { SalesService } from './sales.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { InventoryBatchesService } from '../inventory/inventory-batches.service';
import { CashShiftService } from '../cash-shift/cash-shift.service';
import { PaymentService } from '../payment/payment.service';

describe('SalesService — registro de impresiones de ticket', () => {
  let service: SalesService;

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
});
