import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { SalesService } from './sales.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { CashShiftService } from '../cash-shift/cash-shift.service';
import { PaymentService } from '../payment/payment.service';

/**
 * Contrato de DEVOLUCIONES (P0-2). No requiere base de datos.
 *
 * Invariantes protegidos:
 *   - Nunca se devuelve más de lo vendido (descontando devoluciones previas).
 *   - El reembolso se reparte entre deuda y efectivo sin dejar saldos negativos.
 *   - La mercancía dañada no descuenta stock dos veces.
 */
describe('SalesService — devoluciones', () => {
  let service: SalesService;

  const tx = {
    $queryRaw: jest.fn(),
    sale: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    saleItem: { findMany: jest.fn() },
    saleReturn: { create: jest.fn() },
    saleReturnItem: { create: jest.fn(), groupBy: jest.fn() },
    saleRefund: { create: jest.fn() },
    cashTransaction: { create: jest.fn() },
    client: { update: jest.fn() },
  };

  const mockPrisma = {
    $transaction: jest.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
  };
  const mockInventory = {
    registerMovement: jest.fn(),
    lockProductRow: jest.fn(),
  };
  const mockCashShift = { getCurrentShift: jest.fn() };
  const mockPayment = {
    applyToSale: jest.fn(),
    decreaseClientDebt: jest.fn(),
    resolveCashShiftId: jest.fn(),
  };

  // Venta de contado: 10 u a $50 = $500, totalmente pagada
  const ventaContado = {
    id: 1,
    clientId: null,
    client: null,
    total: new Decimal(500),
    paidAmount: new Decimal(500),
    balance: new Decimal(0),
    flowStatus: 'COMPLETED',
    status: 'COMPLETED',
  };
  const itemsVenta = [
    { id: 10, saleId: 1, productId: 100, quantity: 10, price: new Decimal(50) },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InventoryService, useValue: mockInventory },
        { provide: CashShiftService, useValue: mockCashShift },
        { provide: PaymentService, useValue: mockPayment },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);
    jest.clearAllMocks();

    tx.sale.findUnique.mockResolvedValue(ventaContado);
    tx.saleItem.findMany.mockResolvedValue(itemsVenta);
    tx.saleReturnItem.groupBy.mockResolvedValue([]); // sin devoluciones previas
    tx.saleReturn.create.mockResolvedValue({ id: 55 });
    tx.saleRefund.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 9, ...data }),
    );
    mockCashShift.getCurrentShift.mockResolvedValue({ id: 42 });
  });

  describe('acumulación de devoluciones previas', () => {
    it('bloquea la venta antes de leer el histórico', async () => {
      await service.createReturn(
        1,
        { items: [{ saleItemId: 10, quantity: 2, restock: true }] },
        99,
      );
      // Sin el bloqueo, dos devoluciones simultáneas leerían "ya devuelto = 0".
      expect(tx.$queryRaw).toHaveBeenCalled();
    });

    it('rechaza devolver más de lo que queda tras devoluciones previas', async () => {
      // Ya se devolvieron 8 de 10 → solo quedan 2
      tx.saleReturnItem.groupBy.mockResolvedValue([
        { saleItemId: 10, _sum: { quantity: 8 } },
      ]);

      await expect(
        service.createReturn(
          1,
          { items: [{ saleItemId: 10, quantity: 3, restock: true }] },
          99,
        ),
      ).rejects.toThrow(BadRequestException);

      // Falla ANTES de escribir nada
      expect(tx.saleReturn.create).not.toHaveBeenCalled();
      expect(mockInventory.registerMovement).not.toHaveBeenCalled();
    });

    it('permite devolver exactamente lo que queda disponible', async () => {
      tx.saleReturnItem.groupBy.mockResolvedValue([
        { saleItemId: 10, _sum: { quantity: 8 } },
      ]);

      const res = await service.createReturn(
        1,
        { items: [{ saleItemId: 10, quantity: 2, restock: true }] },
        99,
      );
      expect(res.totalReturned.toString()).toBe('100'); // 2 x $50
    });

    it('consolida líneas repetidas del mismo item en una sola petición', async () => {
      // 6 + 6 = 12 sobre 10 vendidas: por separado cada línea pasaría
      await expect(
        service.createReturn(
          1,
          {
            items: [
              { saleItemId: 10, quantity: 6, restock: true },
              { saleItemId: 10, quantity: 6, restock: true },
            ],
          },
          99,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza un item que no pertenece a la venta', async () => {
      await expect(
        service.createReturn(
          1,
          { items: [{ saleItemId: 999, quantity: 1, restock: true }] },
          99,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza una devolución vacía', async () => {
      await expect(service.createReturn(1, { items: [] }, 99)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('validación del estado de la venta', () => {
    it('solo permite devoluciones sobre ventas finalizadas', async () => {
      tx.sale.findUnique.mockResolvedValue({
        ...ventaContado,
        flowStatus: 'DRAFT',
      });
      await expect(
        service.createReturn(
          1,
          { items: [{ saleItemId: 10, quantity: 1, restock: true }] },
          99,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza devoluciones sobre una venta cancelada', async () => {
      tx.sale.findUnique.mockResolvedValue({
        ...ventaContado,
        status: 'CANCELLED',
      });
      await expect(
        service.createReturn(
          1,
          { items: [{ saleItemId: 10, quantity: 1, restock: true }] },
          99,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza NotFound si la venta no existe', async () => {
      tx.sale.findUnique.mockResolvedValue(null);
      await expect(
        service.createReturn(
          1,
          { items: [{ saleItemId: 10, quantity: 1, restock: true }] },
          99,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('impacto en inventario', () => {
    it('mercancía en buen estado: un solo reingreso al stock', async () => {
      await service.createReturn(
        1,
        { items: [{ saleItemId: 10, quantity: 3, restock: true }] },
        99,
      );

      expect(mockInventory.registerMovement).toHaveBeenCalledTimes(1);
      const [[movimiento]] = mockInventory.registerMovement.mock.calls as Array<
        [Record<string, unknown>]
      >;
      expect(movimiento).toMatchObject({
        productId: 100,
        type: 'RETURN_IN',
        quantity: 3,
      });
    });

    it('mercancía dañada: reingresa y se da de baja (efecto neto CERO en stock)', async () => {
      await service.createReturn(
        1,
        { items: [{ saleItemId: 10, quantity: 3, restock: false }] },
        99,
      );

      // Antes se registraba SOLO el LOSS, descontando stock que ya había salido
      // con la venta (pérdida fantasma) y pudiendo fallar por "stock insuficiente".
      const llamadas = mockInventory.registerMovement.mock.calls as Array<
        [{ type: string }]
      >;
      const tipos = llamadas.map((c) => c[0].type);
      expect(tipos).toEqual(['RETURN_IN', 'LOSS']);
    });
  });

  describe('reparto del reembolso', () => {
    it('venta de contado: todo el reembolso sale en efectivo', async () => {
      const res = await service.createReturn(
        1,
        {
          items: [{ saleItemId: 10, quantity: 5, restock: true }],
          refundToCustomer: true,
        },
        99,
      );

      expect(res.debtApplied.toString()).toBe('0');
      expect(res.cashRefunded.toString()).toBe('250');
      expect(tx.cashTransaction.create).toHaveBeenCalled(); // salida de caja
      expect(tx.saleRefund.create).toHaveBeenCalled(); // registro contable
    });

    it('venta a crédito: primero cancela deuda y el resto en efectivo', async () => {
      // Total $500, pagó $300, debe $200. Devuelve $500.
      tx.sale.findUnique.mockResolvedValue({
        ...ventaContado,
        clientId: 7,
        client: { id: 7 },
        paidAmount: new Decimal(300),
        balance: new Decimal(200),
      });

      const res = await service.createReturn(
        1,
        {
          items: [{ saleItemId: 10, quantity: 10, restock: true }],
          refundToCustomer: true,
        },
        99,
      );

      expect(res.debtApplied.toString()).toBe('200'); // se cancela el saldo
      expect(res.cashRefunded.toString()).toBe('300'); // el resto, en efectivo
      // Antes se bajaba la deuda por los $500 completos, dejando el balance en -300.
      expect(mockPayment.decreaseClientDebt).toHaveBeenCalled();
    });

    it('exige caja abierta para devolver efectivo', async () => {
      mockCashShift.getCurrentShift.mockResolvedValue(null);
      await expect(
        service.createReturn(
          1,
          {
            items: [{ saleItemId: 10, quantity: 1, restock: true }],
            refundToCustomer: true,
          },
          99,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('sin refundToCustomer no mueve dinero, solo inventario', async () => {
      const res = await service.createReturn(
        1,
        {
          items: [{ saleItemId: 10, quantity: 2, restock: true }],
          refundToCustomer: false,
        },
        99,
      );

      expect(res.cashRefunded.toString()).toBe('0');
      expect(res.debtApplied.toString()).toBe('0');
      expect(tx.cashTransaction.create).not.toHaveBeenCalled();
      expect(mockInventory.registerMovement).toHaveBeenCalled();
    });
  });

  describe('estado final de la venta', () => {
    it('marca REFUNDED cuando se devuelve la venta completa', async () => {
      await service.createReturn(
        1,
        {
          items: [{ saleItemId: 10, quantity: 10, restock: true }],
          refundToCustomer: false,
        },
        99,
      );

      expect(tx.sale.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'REFUNDED' },
      });
    });

    it('NO marca REFUNDED en una devolución parcial', async () => {
      await service.createReturn(
        1,
        {
          items: [{ saleItemId: 10, quantity: 4, restock: true }],
          refundToCustomer: false,
        },
        99,
      );

      const actualizaciones = tx.sale.update.mock.calls as Array<
        [{ data?: { status?: string } }]
      >;
      const refunded = actualizaciones.some(
        (c) => c[0]?.data?.status === 'REFUNDED',
      );
      expect(refunded).toBe(false);
    });
  });
});
