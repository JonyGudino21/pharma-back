import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { SalesService } from './sales.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { InventoryBatchesService } from '../inventory/inventory-batches.service';
import { CashShiftService } from '../cash-shift/cash-shift.service';
import { PaymentService } from '../payment/payment.service';

/**
 * Contrato del CARRITO ATÓMICO (Fase 1 · hallazgos C-1, C-2, A-4).
 *
 * No requiere base de datos: lo que se fija aquí es la FORMA de las sentencias.
 * Si alguien vuelve al patrón read-modify-write (leer cantidad, sumar en memoria
 * y escribir el total), estas pruebas fallan.
 *
 * El bug que previenen: 20 escaneos del mismo producto en menos de un segundo
 * registraban 1 unidad. Se entregaba mercancía que nunca se cobró.
 */
describe('SalesService — carrito atómico', () => {
  let service: SalesService;

  const tx = {
    sale: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    saleItem: {
      upsert: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      aggregate: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockPrisma = {
    $transaction: jest.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
    product: { findUnique: jest.fn() },
    clientProductPrice: { findUnique: jest.fn() },
    sale: { findUnique: jest.fn() },
  };

  const mockInventory = { registerMovement: jest.fn(), lockProductRow: jest.fn() };
  const mockBatches = {
    consumeForSale: jest.fn(),
    restoreFromSaleItem: jest.fn(),
    getSellableQuantity: jest.fn(),
    writeControlledLog: jest.fn(),
  };
  const mockCashShift = { getCurrentShift: jest.fn() };
  const mockPayment = {
    applyToSale: jest.fn(),
    decreaseClientDebt: jest.fn(),
    resolveCashShiftId: jest.fn(),
  };

  const ventaDraft = {
    id: 10,
    clientId: null as number | null,
    flowStatus: 'DRAFT',
    status: 'PENDING',
    paidAmount: new Decimal(0),
    balance: new Decimal(0),
    total: new Decimal(0),
  };

  const producto = {
    id: 55,
    name: 'Paracetamol 500mg',
    isActive: true,
    price: new Decimal(50),
    cost: new Decimal(20),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InventoryService, useValue: mockInventory },
        { provide: InventoryBatchesService, useValue: mockBatches },
        { provide: CashShiftService, useValue: mockCashShift },
        { provide: PaymentService, useValue: mockPayment },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);
    jest.clearAllMocks();

    mockPrisma.sale.findUnique.mockResolvedValue(ventaDraft);
    mockPrisma.product.findUnique.mockResolvedValue(producto);
    mockPrisma.clientProductPrice.findUnique.mockResolvedValue(null);

    tx.saleItem.upsert.mockResolvedValue({ id: 77 });
    // Tras el upsert, la BD ya consolidó la cantidad.
    tx.saleItem.findUniqueOrThrow.mockResolvedValue({
      id: 77,
      quantity: 3,
      price: new Decimal(50),
    });
    tx.saleItem.aggregate.mockResolvedValue({
      _sum: { subtotal: new Decimal(150) },
    });
    tx.sale.findUniqueOrThrow.mockResolvedValue({ paidAmount: new Decimal(0) });
    tx.sale.update.mockResolvedValue(ventaDraft);
  });

  describe('acumulación de cantidad', () => {
    it('usa upsert con increment: la suma la hace la base de datos', async () => {
      await service.addItem(10, { productId: 55, quantity: 1 });

      expect(tx.saleItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { saleId_productId: { saleId: 10, productId: 55 } },
          update: { quantity: { increment: 1 } },
        }),
      );
    });

    it('NUNCA escribe una cantidad absoluta calculada en memoria', async () => {
      await service.addItem(10, { productId: 55, quantity: 1 });

      // La única actualización permitida sobre la línea es la del subtotal.
      const updates = tx.saleItem.update.mock.calls as Array<
        [{ data: Record<string, unknown> }]
      >;
      for (const [arg] of updates) {
        expect(arg.data).not.toHaveProperty('quantity');
      }
    });

    it('recalcula el subtotal sobre la cantidad ya consolidada por la BD', async () => {
      // La BD reporta 3 unidades acumuladas a $50 => $150
      await service.addItem(10, { productId: 55, quantity: 1 });

      expect(tx.saleItem.update).toHaveBeenCalledWith({
        where: { id: 77 },
        data: { subtotal: expect.anything() },
      });
      const arg = tx.saleItem.update.mock.calls[0][0] as {
        data: { subtotal: Decimal };
      };
      expect(arg.data.subtotal.toString()).toBe('150');
    });

    it('crea la línea con la cantidad inicial cuando el producto no estaba', async () => {
      await service.addItem(10, { productId: 55, quantity: 4 });

      const arg = tx.saleItem.upsert.mock.calls[0][0] as {
        create: Record<string, unknown>;
      };
      expect(arg.create).toMatchObject({ productId: 55, quantity: 4 });
    });
  });

  describe('validaciones de la línea', () => {
    it('rechaza un producto inactivo', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        ...producto,
        isActive: false,
      });
      await expect(
        service.addItem(10, { productId: 55, quantity: 1 }),
      ).rejects.toThrow(NotFoundException);
      expect(tx.saleItem.upsert).not.toHaveBeenCalled();
    });

    it('rechaza un producto inexistente', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(
        service.addItem(10, { productId: 999, quantity: 1 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('balance con pagado fresco (A-4)', () => {
    it('relee paidAmount DENTRO de la transacción, no desde la lectura previa', async () => {
      // La venta se leyó fuera de la transacción con paidAmount 0, pero entre
      // esa lectura y el recálculo entró un abono de $100.
      tx.sale.findUniqueOrThrow.mockResolvedValue({
        paidAmount: new Decimal(100),
      });

      await service.addItem(10, { productId: 55, quantity: 1 });

      // El balance debe descontar el abono real ($150 - $100), no ignorarlo.
      expect(tx.sale.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 10 },
        select: { paidAmount: true },
      });
      const arg = tx.sale.update.mock.calls[0][0] as {
        data: { balance: Decimal };
      };
      expect(arg.data.balance.toString()).toBe('50');
    });
  });
});
