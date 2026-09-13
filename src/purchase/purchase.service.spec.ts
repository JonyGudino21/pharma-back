import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PurchaseService } from './purchase.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { InventoryBatchesService } from '../inventory/inventory-batches.service';
import { CashShiftService } from '../cash-shift/cash-shift.service';

/**
 * Contrato de COMPRAS. No requiere base de datos.
 *
 * Era el servicio más grande del proyecto sin una sola prueba: recepción de
 * mercancía, costo promedio ponderado, creación de lotes, pagos a proveedor y
 * cancelación con reversión contable. Todo el dinero que SALE de la farmacia
 * pasaba por aquí sin red de seguridad.
 *
 * Invariantes que estas pruebas fijan:
 *   1. El costo promedio ponderado se calcula con la fórmula por VALOR y se
 *      revierte de forma exacta al cancelar.
 *   2. Ninguna transición (recibir / cancelar) puede aplicarse dos veces.
 *   3. Todo read-modify-write sobre el costo ocurre con la fila bloqueada.
 *   4. Un controlado no entra al almacén sin lote y caducidad.
 *   5. La deuda con el proveedor se calcula con datos FRESCOS de la transacción.
 */
describe('PurchaseService — recepción, costo promedio y cancelación', () => {
  let service: PurchaseService;

  const tx = {
    purchase: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    purchaseItem: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn(),
      findUnique: jest.fn(),
    },
    purchasePayment: {
      create: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
    },
    product: { findUnique: jest.fn(), update: jest.fn() },
    productBatch: { findUnique: jest.fn() },
    productPriceHistory: { create: jest.fn() },
    supplier: { update: jest.fn() },
    cashTransaction: { create: jest.fn() },
  };

  const mockPrisma = {
    $transaction: jest.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
    purchase: { findUnique: jest.fn(), update: jest.fn() },
    product: { findMany: jest.fn(), findUnique: jest.fn() },
    supplier: { findUnique: jest.fn() },
    purchasePayment: { findUnique: jest.fn() },
  };

  const mockInventory = {
    registerMovement: jest.fn(),
    lockProductRow: jest.fn(),
  };
  const mockBatches = { receiveIntoBatch: jest.fn() };
  const mockCashShift = { getCurrentShift: jest.fn() };

  const item = {
    id: 50,
    purchaseId: 5,
    productId: 100,
    quantity: 10,
    cost: new Decimal(200),
    subtotal: new Decimal(2000),
    lotNumber: null as string | null,
    expiryDate: null as Date | null,
    product: { name: 'Paracetamol', sku: 'PARA-500' },
  };

  /** Compra PENDIENTE de recibir: 10 u a $200 = $2,000, sin pagos. */
  const compraPendiente = {
    id: 5,
    supplierId: 3,
    invoiceNumber: 'F-001',
    subtotal: new Decimal(2000),
    total: new Decimal(2000),
    paidAmount: new Decimal(0),
    balance: new Decimal(2000),
    status: 'PENDING',
    deliveryStatus: 'PENDING',
    items: [item],
    payments: [],
    supplier: { id: 3, name: 'Proveedor S.A.' },
  };

  /** 10 u a $100 → al recibir 10 a $200 el promedio debe quedar en $150. */
  const productoExistente = {
    id: 100,
    name: 'Paracetamol',
    stock: 10,
    cost: new Decimal(100),
    controlled: false,
  };

  const dataDe = (mock: jest.Mock, i = 0) =>
    (mock.mock.calls[i][0] as { data: Record<string, unknown> }).data;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InventoryService, useValue: mockInventory },
        { provide: InventoryBatchesService, useValue: mockBatches },
        { provide: CashShiftService, useValue: mockCashShift },
      ],
    }).compile();

    service = module.get<PurchaseService>(PurchaseService);
    jest.clearAllMocks();

    mockPrisma.purchase.findUnique.mockResolvedValue(compraPendiente);
    tx.purchase.updateMany.mockResolvedValue({ count: 1 });
    tx.purchase.findUnique.mockResolvedValue(compraPendiente);
    tx.purchase.findUniqueOrThrow.mockResolvedValue({
      ...compraPendiente,
      deliveryStatus: 'RECEIVED',
    });
    tx.purchase.update.mockImplementation(({ data }: { data: unknown }) => ({
      ...compraPendiente,
      ...(data as object),
    }));
    tx.product.findUnique.mockResolvedValue(productoExistente);
    tx.product.update.mockResolvedValue(productoExistente);
    tx.productBatch.findUnique.mockResolvedValue(null);
    tx.purchaseItem.aggregate.mockResolvedValue({
      _sum: { subtotal: new Decimal(0) },
    });
    mockInventory.registerMovement.mockResolvedValue({ id: 1 });
    mockInventory.lockProductRow.mockResolvedValue(undefined);
    mockCashShift.getCurrentShift.mockResolvedValue({ id: 42 });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('costo promedio ponderado al recibir', () => {
    it('aplica la fórmula ponderada por VALOR, no el promedio de los costos', async () => {
      // 10 u × $100 (valor 1,000) + 10 u × $200 (valor 2,000) = 3,000 / 20 = $150
      // El promedio aritmético de 100 y 200 daría lo mismo aquí sólo porque las
      // cantidades coinciden; el siguiente caso lo distingue.
      await service.receive(5, 99);

      expect(tx.product.update).toHaveBeenCalledTimes(1);
      expect((dataDe(tx.product.update).cost as Decimal).toString()).toBe('150');
    });

    it('pondera por cantidad: 90 u a $100 + 10 u a $200 da $110, no $150', async () => {
      tx.product.findUnique.mockResolvedValue({
        ...productoExistente,
        stock: 90,
      });

      await service.receive(5, 99);

      // (90×100 + 10×200) / 100 = 11,000 / 100 = 110
      expect((dataDe(tx.product.update).cost as Decimal).toString()).toBe('110');
    });

    it('bloquea la fila del producto ANTES de leerla para recalcular', async () => {
      await service.receive(5, 99);

      // Sin el bloqueo, dos recepciones del mismo producto leen el mismo costo
      // y una sobreescribe el promedio calculado por la otra.
      expect(mockInventory.lockProductRow).toHaveBeenCalledWith(tx, 100);
      expect(mockInventory.lockProductRow.mock.invocationCallOrder[0]).toBeLessThan(
        tx.product.findUnique.mock.invocationCallOrder[0],
      );
    });

    it('deja constancia del nuevo costo en el historial de precios', async () => {
      await service.receive(5, 99);

      expect(tx.productPriceHistory.create).toHaveBeenCalledTimes(1);
      const data = dataDe(tx.productPriceHistory.create);
      expect((data.price as Decimal).toString()).toBe('150');
      expect(data.changedById).toBe(99);
    });

    it('no escribe historial si el costo no cambió (evita ruido en la auditoría)', async () => {
      // Entra al mismo costo que ya tenía: el promedio no se mueve.
      tx.purchase.findUnique.mockResolvedValue({
        ...compraPendiente,
        items: [{ ...item, cost: new Decimal(100) }],
      });

      await service.receive(5, 99);

      expect((dataDe(tx.product.update).cost as Decimal).toString()).toBe('100');
      expect(tx.productPriceHistory.create).not.toHaveBeenCalled();
    });

    it('toma el costo de entrada tal cual cuando no había existencias', async () => {
      tx.product.findUnique.mockResolvedValue({
        ...productoExistente,
        stock: 0,
        cost: new Decimal(0),
      });

      await service.receive(5, 99);

      expect((dataDe(tx.product.update).cost as Decimal).toString()).toBe('200');
    });

    it('procesa los items en orden ascendente de productId (previene deadlocks)', async () => {
      tx.purchase.findUnique.mockResolvedValue({
        ...compraPendiente,
        items: [
          { ...item, id: 52, productId: 300 },
          { ...item, id: 51, productId: 100 },
          { ...item, id: 53, productId: 200 },
        ],
      });
      tx.product.findUnique.mockImplementation(
        ({ where }: { where: { id: number } }) => ({
          ...productoExistente,
          id: where.id,
        }),
      );

      await service.receive(5, 99);

      // Dos transacciones que tocan los mismos productos en el mismo orden
      // esperan; en orden distinto se abrazan y PostgreSQL mata a una.
      const orden = mockInventory.lockProductRow.mock.calls.map((c) => c[1]);
      expect(orden).toEqual([100, 200, 300]);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('claim atómico de la recepción', () => {
    it('reclama la transición PENDING → RECEIVED con un UPDATE condicional', async () => {
      await service.receive(5, 99);

      expect(tx.purchase.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 5,
            deliveryStatus: 'PENDING',
          }),
          data: { deliveryStatus: 'RECEIVED' },
        }),
      );
    });

    it('la segunda recepción simultánea no suma stock ni deuda otra vez', async () => {
      tx.purchase.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.receive(5, 99)).rejects.toThrow(ConflictException);

      expect(tx.product.update).not.toHaveBeenCalled();
      expect(tx.supplier.update).not.toHaveBeenCalled();
      expect(mockInventory.registerMovement).not.toHaveBeenCalled();
    });

    it('rechaza recibir una compra ya recibida', async () => {
      mockPrisma.purchase.findUnique.mockResolvedValue({
        ...compraPendiente,
        deliveryStatus: 'RECEIVED',
      });
      await expect(service.receive(5, 99)).rejects.toThrow(BadRequestException);
    });

    it('rechaza recibir una compra cancelada', async () => {
      mockPrisma.purchase.findUnique.mockResolvedValue({
        ...compraPendiente,
        status: 'CANCELLED',
      });
      await expect(service.receive(5, 99)).rejects.toThrow(BadRequestException);
    });

    it('rechaza recibir una compra inexistente', async () => {
      mockPrisma.purchase.findUnique.mockResolvedValue(null);
      await expect(service.receive(999, 99)).rejects.toThrow(NotFoundException);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('deuda con el proveedor al recibir', () => {
    it('la deuda se hace oficial al recibir la mercancía, no al ordenarla', async () => {
      await service.receive(5, 99);

      expect(tx.supplier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 3 },
          data: { balance: { increment: expect.anything() } },
        }),
      );
    });

    it('usa el balance FRESCO leído dentro de la transacción', async () => {
      // Un pago concurrente dejó el balance en $500. Con el dato viejo le
      // cargaríamos $2,000 al proveedor y le deberíamos $1,500 de más.
      tx.purchase.findUnique.mockResolvedValue({
        ...compraPendiente,
        balance: new Decimal(500),
      });

      await service.receive(5, 99);

      const inc = (dataDe(tx.supplier.update).balance as { increment: Decimal })
        .increment;
      expect(inc.toString()).toBe('500');
    });

    it('no toca al proveedor si la compra ya venía pagada por adelantado', async () => {
      tx.purchase.findUnique.mockResolvedValue({
        ...compraPendiente,
        balance: new Decimal(0),
      });

      await service.receive(5, 99);
      expect(tx.supplier.update).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('lotes, caducidad y controlados', () => {
    it('crea el lote cuando la compra trae número y caducidad', async () => {
      tx.purchase.findUnique.mockResolvedValue({
        ...compraPendiente,
        items: [
          { ...item, lotNumber: 'L-2026-A', expiryDate: new Date('2027-06-30') },
        ],
      });

      await service.receive(5, 99);

      expect(mockBatches.receiveIntoBatch).toHaveBeenCalledTimes(1);
      expect(mockInventory.registerMovement).not.toHaveBeenCalled();
    });

    it('sin lote la mercancía entra por el Kardex como PURCHASE', async () => {
      await service.receive(5, 99);

      expect(mockBatches.receiveIntoBatch).not.toHaveBeenCalled();
      expect(mockInventory.registerMovement).toHaveBeenCalledWith(
        expect.objectContaining({ productId: 100, type: 'PURCHASE' }),
        99,
        tx,
      );
    });

    it('un controlado NO entra al almacén sin lote (bloqueo COFEPRIS al recibir)', async () => {
      tx.product.findUnique.mockResolvedValue({
        ...productoExistente,
        name: 'Clonazepam',
        controlled: true,
      });

      await expect(service.receive(5, 99)).rejects.toThrow(BadRequestException);
      expect(mockBatches.receiveIntoBatch).not.toHaveBeenCalled();
    });

    it('un controlado no se puede ni ordenar sin lote (bloqueo en la captura)', async () => {
      mockPrisma.supplier.findUnique.mockResolvedValue({ id: 3, name: 'Prov' });
      mockPrisma.product.findMany.mockResolvedValue([
        { id: 100, name: 'Clonazepam', controlled: true },
      ]);

      await expect(
        service.create(
          {
            supplierId: 3,
            invoiceNumber: 'F-002',
            items: [{ productId: 100, quantity: 5, cost: 50 }],
          } as never,
          99,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(tx.purchase.create).not.toHaveBeenCalled();
    });

    it('rechaza lote sin caducidad: dejaría el FEFO ciego', async () => {
      mockPrisma.supplier.findUnique.mockResolvedValue({ id: 3, name: 'Prov' });
      mockPrisma.product.findMany.mockResolvedValue([
        { id: 100, name: 'Paracetamol', controlled: false },
      ]);

      await expect(
        service.create(
          {
            supplierId: 3,
            items: [
              { productId: 100, quantity: 5, cost: 50, lotNumber: 'L-1' },
            ],
          } as never,
          99,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('cancelación: reversión exacta del costo promedio', () => {
    // Estado tras haber recibido: el producto quedó en 20 u a $150.
    const compraRecibida = {
      ...compraPendiente,
      deliveryStatus: 'RECEIVED',
      status: 'PENDING',
    };

    beforeEach(() => {
      mockPrisma.purchase.findUnique.mockResolvedValue(compraRecibida);
      tx.purchase.findUnique.mockResolvedValue(compraRecibida);
      tx.product.findUnique.mockResolvedValue({
        ...productoExistente,
        stock: 20,
        cost: new Decimal(150),
      });
    });

    it('restaura EXACTAMENTE el costo previo si no hubo movimientos intermedios', async () => {
      await service.cancel(5, 99);

      // valorActual 20×150 = 3,000 − (10×200 = 2,000) = 1,000 / 10 u = $100
      // Justo el costo que el producto tenía antes de esta compra.
      expect((dataDe(tx.product.update).cost as Decimal).toString()).toBe('100');
    });

    it('retira el valor al costo REAL de la compra, no al promedio vigente', async () => {
      await service.cancel(5, 99);

      // Si retirara 10 × $150 (promedio) el costo quedaría en $150 y el valor
      // del inventario arrastraría para siempre la compra cancelada.
      expect((dataDe(tx.product.update).cost as Decimal).toString()).not.toBe(
        '150',
      );
    });

    it('conserva el último costo conocido si el stock resultante queda en 0', async () => {
      // Se vendió todo menos lo de esta compra: al revertir queda en 0 y el
      // promedio no tiene sentido matemático (división entre cero).
      tx.product.findUnique.mockResolvedValue({
        ...productoExistente,
        stock: 10,
        cost: new Decimal(150),
      });

      await service.cancel(5, 99);

      expect(tx.product.update).not.toHaveBeenCalled();
      expect(tx.productPriceHistory.create).not.toHaveBeenCalled();
    });

    it('aborta la reversión —sin corromper el costo— si el valor saldría negativo', async () => {
      // Datos inconsistentes: el valor a retirar excede el valor en libros.
      tx.product.findUnique.mockResolvedValue({
        ...productoExistente,
        stock: 30,
        cost: new Decimal(10),
      });

      await service.cancel(5, 99);

      // 30×10 = 300 − 2,000 = −1,700. Preferimos un costo viejo a un costo absurdo.
      expect(tx.product.update).not.toHaveBeenCalled();
    });

    it('revierte el costo ANTES de sacar el stock del Kardex', async () => {
      await service.cancel(5, 99);

      // El orden importa: el cálculo necesita leer el stock que TODAVÍA
      // incluye la mercancía de esta compra.
      expect(tx.product.update.mock.invocationCallOrder[0]).toBeLessThan(
        mockInventory.registerMovement.mock.invocationCallOrder[0],
      );
    });

    it('saca la mercancía como RETURN_OUT valuada al costo de compra', async () => {
      await service.cancel(5, 99);

      expect(mockInventory.registerMovement).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 100,
          type: 'RETURN_OUT',
          quantity: 10,
        }),
        99,
        tx,
        expect.anything(),
      );
      const costo = mockInventory.registerMovement.mock.calls[0][3] as Decimal;
      expect(costo.toString()).toBe('200');
    });

    it('falla en vez de descuadrar si el lote a revertir ya no existe', async () => {
      tx.purchase.findUnique.mockResolvedValue({
        ...compraRecibida,
        items: [
          { ...item, lotNumber: 'L-2026-A', expiryDate: new Date('2027-06-30') },
        ],
      });
      tx.productBatch.findUnique.mockResolvedValue(null);

      await expect(service.cancel(5, 99)).rejects.toThrow(ConflictException);
    });

    it('no toca inventario si la mercancía nunca llegó al almacén', async () => {
      mockPrisma.purchase.findUnique.mockResolvedValue(compraPendiente);
      tx.purchase.findUnique.mockResolvedValue(compraPendiente);

      await service.cancel(5, 99);

      expect(mockInventory.registerMovement).not.toHaveBeenCalled();
      expect(tx.product.update).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('cancelación: claim atómico y dinero', () => {
    it('reclama la cancelación con un UPDATE condicional', async () => {
      await service.cancel(5, 99);

      expect(tx.purchase.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 5, status: { not: 'CANCELLED' } },
          data: { status: 'CANCELLED' },
        }),
      );
    });

    it('la segunda cancelación simultánea no saca el stock dos veces', async () => {
      mockPrisma.purchase.findUnique.mockResolvedValue({
        ...compraPendiente,
        deliveryStatus: 'RECEIVED',
      });
      tx.purchase.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.cancel(5, 99)).rejects.toThrow(ConflictException);

      expect(mockInventory.registerMovement).not.toHaveBeenCalled();
      expect(tx.supplier.update).not.toHaveBeenCalled();
    });

    it('rechaza cancelar una compra ya cancelada', async () => {
      mockPrisma.purchase.findUnique.mockResolvedValue({
        ...compraPendiente,
        status: 'CANCELLED',
      });
      await expect(service.cancel(5, 99)).rejects.toThrow(BadRequestException);
    });

    it('genera nota de crédito por defecto: el saldo del proveedor queda a favor', async () => {
      mockPrisma.purchase.findUnique.mockResolvedValue({
        ...compraPendiente,
        paidAmount: new Decimal(800),
        balance: new Decimal(1200),
      });
      tx.purchase.findUnique.mockResolvedValue({
        ...compraPendiente,
        paidAmount: new Decimal(800),
        balance: new Decimal(1200),
      });

      await service.cancel(5, 99);

      const dec = (dataDe(tx.supplier.update).balance as { decrement: Decimal })
        .decrement;
      expect(dec.toString()).toBe('800');
      expect(tx.cashTransaction.create).not.toHaveBeenCalled();
    });

    it('con returnToCash el efectivo regresa a la caja y exige turno abierto', async () => {
      const conAnticipo = {
        ...compraPendiente,
        paidAmount: new Decimal(800),
        balance: new Decimal(1200),
      };
      mockPrisma.purchase.findUnique.mockResolvedValue(conAnticipo);
      tx.purchase.findUnique.mockResolvedValue(conAnticipo);

      await service.cancel(5, 99, true);
      expect(dataDe(tx.cashTransaction.create).type).toBe('REFUND_IN');

      jest.clearAllMocks();
      mockPrisma.purchase.findUnique.mockResolvedValue(conAnticipo);
      tx.purchase.findUnique.mockResolvedValue(conAnticipo);
      tx.purchase.updateMany.mockResolvedValue({ count: 1 });
      mockCashShift.getCurrentShift.mockResolvedValue(null);

      // Sin caja abierta el efectivo entraría al aire: no se puede registrar.
      await expect(service.cancel(5, 99, true)).rejects.toThrow(
        ConflictException,
      );
    });

    it('anula la deuda de la compra al cancelar', async () => {
      await service.cancel(5, 99);

      const ultima = tx.purchase.update.mock.calls.at(-1)![0] as {
        data: { balance: Decimal; deliveryStatus: string };
      };
      expect(ultima.data.balance.toString()).toBe('0');
      expect(ultima.data.deliveryStatus).toBe('CANCELLED');
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('pagos a proveedor', () => {
    it('rechaza pagar una compra que ya está saldada', async () => {
      mockPrisma.purchase.findUnique.mockResolvedValue({
        ...compraPendiente,
        paidAmount: new Decimal(2000),
        balance: new Decimal(0),
        status: 'PAID',
      });

      await expect(
        service.addPayment(5, { method: 'CASH', amount: 100 } as never, 99),
      ).rejects.toThrow(BadRequestException);
      expect(tx.purchasePayment.create).not.toHaveBeenCalled();
    });

    it('rechaza pagar una compra cancelada', async () => {
      mockPrisma.purchase.findUnique.mockResolvedValue({
        ...compraPendiente,
        status: 'CANCELLED',
      });

      await expect(
        service.addPayment(5, { method: 'CASH', amount: 100 } as never, 99),
      ).rejects.toThrow(BadRequestException);
    });

    it('un pago en efectivo exige caja abierta', async () => {
      mockCashShift.getCurrentShift.mockResolvedValue(null);

      await expect(
        service.addPayment(5, { method: 'CASH', amount: 100 } as never, 99),
      ).rejects.toThrow(ConflictException);
      expect(tx.purchasePayment.create).not.toHaveBeenCalled();
    });

    it('un pago por transferencia NO toca la caja física', async () => {
      await service.addPayment(
        5,
        { method: 'TRANSFER', amount: 500 } as never,
        99,
      );

      expect(tx.cashTransaction.create).not.toHaveBeenCalled();
      expect(tx.purchasePayment.create).toHaveBeenCalled();
    });

    it('un abono parcial deja la compra en PARTIAL con el saldo correcto', async () => {
      await service.addPayment(
        5,
        { method: 'TRANSFER', amount: 500 } as never,
        99,
      );

      const data = dataDe(tx.purchase.update) as {
        paidAmount: Decimal;
        balance: Decimal;
        status: string;
      };
      expect(data.paidAmount.toString()).toBe('500');
      expect(data.balance.toString()).toBe('1500');
      expect(data.status).toBe('PARTIAL');
    });

    it('el pago que cubre el total deja la compra en PAID', async () => {
      await service.addPayment(
        5,
        { method: 'TRANSFER', amount: 2000 } as never,
        99,
      );

      const data = dataDe(tx.purchase.update) as {
        balance: Decimal;
        status: string;
      };
      expect(data.balance.toString()).toBe('0');
      expect(data.status).toBe('PAID');
    });

    it('si la mercancía ya se recibió, pagar baja la deuda del proveedor', async () => {
      mockPrisma.purchase.findUnique.mockResolvedValue({
        ...compraPendiente,
        deliveryStatus: 'RECEIVED',
      });

      await service.addPayment(
        5,
        { method: 'TRANSFER', amount: 500 } as never,
        99,
      );

      expect(
        (dataDe(tx.supplier.update).balance as { decrement: number }).decrement,
      ).toBe(500);
    });

    it('si aún no se recibe, pagar NO altera el saldo del proveedor', async () => {
      // La deuda todavía no existe: se carga al recibir. Descontarla ahora
      // dejaría al proveedor con saldo a favor inventado.
      await service.addPayment(
        5,
        { method: 'TRANSFER', amount: 500 } as never,
        99,
      );

      expect(tx.supplier.update).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('reversión de un pago', () => {
    const pago = {
      id: 900,
      purchaseId: 5,
      method: 'CASH',
      amount: new Decimal(800),
    };

    beforeEach(() => {
      mockPrisma.purchase.findUnique.mockResolvedValue({
        ...compraPendiente,
        paidAmount: new Decimal(800),
        balance: new Decimal(1200),
        status: 'PARTIAL',
      });
      mockPrisma.purchasePayment.findUnique.mockResolvedValue(pago);
    });

    it('rechaza revertir un pago que no pertenece a esa compra', async () => {
      mockPrisma.purchasePayment.findUnique.mockResolvedValue(null);

      await expect(service.removePayment(5, 900, 99)).rejects.toThrow(
        NotFoundException,
      );
      expect(tx.purchasePayment.delete).not.toHaveBeenCalled();
    });

    it('devuelve el efectivo a la caja y exige turno abierto', async () => {
      await service.removePayment(5, 900, 99);
      expect(dataDe(tx.cashTransaction.create).type).toBe('MANUAL_ADD');

      jest.clearAllMocks();
      mockPrisma.purchase.findUnique.mockResolvedValue({
        ...compraPendiente,
        paidAmount: new Decimal(800),
        balance: new Decimal(1200),
      });
      mockPrisma.purchasePayment.findUnique.mockResolvedValue(pago);
      mockCashShift.getCurrentShift.mockResolvedValue(null);

      await expect(service.removePayment(5, 900, 99)).rejects.toThrow(
        ConflictException,
      );
      expect(tx.purchasePayment.delete).not.toHaveBeenCalled();
    });

    it('al quedar en cero la compra vuelve a PENDING con el saldo completo', async () => {
      await service.removePayment(5, 900, 99);

      const data = dataDe(tx.purchase.update) as {
        paidAmount: Decimal;
        balance: Decimal;
        status: string;
      };
      expect(data.paidAmount.toString()).toBe('0');
      expect(data.balance.toString()).toBe('2000');
      expect(data.status).toBe('PENDING');
    });

    it('si la mercancía ya se recibió, revertir el pago nos vuelve a endeudar', async () => {
      mockPrisma.purchase.findUnique.mockResolvedValue({
        ...compraPendiente,
        deliveryStatus: 'RECEIVED',
        paidAmount: new Decimal(800),
        balance: new Decimal(1200),
      });

      await service.removePayment(5, 900, 99);

      const inc = (dataDe(tx.supplier.update).balance as { increment: Decimal })
        .increment;
      expect(inc.toString()).toBe('800');
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('la compra recibida es inmutable', () => {
    beforeEach(() => {
      mockPrisma.purchase.findUnique.mockResolvedValue({
        ...compraPendiente,
        deliveryStatus: 'RECEIVED',
      });
    });

    it('no se pueden agregar productos', async () => {
      await expect(
        service.addItem(5, { productId: 100, quantity: 1, cost: 10 } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('no se pueden modificar productos', async () => {
      await expect(
        service.updateItem(5, 50, { quantity: 2, cost: 10 } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('no se pueden eliminar productos', async () => {
      await expect(service.removeItem(5, 50)).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.purchaseItem.delete).not.toHaveBeenCalled();
    });
  });

  describe('la compra cancelada es inmutable', () => {
    beforeEach(() => {
      mockPrisma.purchase.findUnique.mockResolvedValue({
        ...compraPendiente,
        status: 'CANCELLED',
      });
    });

    it('no acepta nuevos productos', async () => {
      await expect(
        service.addItem(5, { productId: 100, quantity: 1, cost: 10 } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('no acepta cambios de proveedor ni de folio', async () => {
      await expect(service.update(5, { invoiceNumber: 'X' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
