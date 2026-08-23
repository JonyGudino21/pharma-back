import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { MovementType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Pruebas del contrato de CONCURRENCIA del Kardex (P0-1).
 *
 * Lo que se protege aquí es que el stock NUNCA se mute con un patrón
 * read-modify-write, sino con una sentencia atómica de la base de datos.
 */
describe('InventoryService — mutación atómica de stock', () => {
  let service: InventoryService;

  // Transacción simulada que recibe registerMovement
  const tx = {
    product: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    inventoryMovement: { create: jest.fn() },
    $queryRaw: jest.fn(),
  };

  const mockPrisma = {
    $transaction: jest.fn((cb: any) => cb(tx)),
    product: tx.product,
    inventoryMovement: tx.inventoryMovement,
  };

  const producto = { id: 1, name: 'Paracetamol 500mg', stock: 10, cost: new Decimal(25) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InventoryService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    jest.clearAllMocks();

    tx.product.findUnique.mockResolvedValue(producto);
    tx.product.updateMany.mockResolvedValue({ count: 1 });
    tx.product.update.mockResolvedValue(producto);
    tx.inventoryMovement.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 1, ...data }),
    );
  });

  describe('salidas (SALE / RETURN_OUT / LOSS)', () => {
    it('descuenta con UPDATE condicional atómico (nunca read-modify-write)', async () => {
      await service.registerMovement(
        { productId: 1, type: MovementType.SALE, quantity: 3, reason: 'Venta #1' },
        99,
        tx as any,
      );

      // La guardia `stock >= cantidad` es lo que impide la sobreventa.
      expect(tx.product.updateMany).toHaveBeenCalledWith({
        where: { id: 1, stock: { gte: 3 } },
        data: { stock: { decrement: 3 } },
      });
      // Jamás debe escribirse un stock absoluto calculado en memoria.
      expect(tx.product.update).not.toHaveBeenCalled();
    });

    it('lanza ConflictException cuando la BD reporta 0 filas afectadas (sin stock)', async () => {
      tx.product.updateMany.mockResolvedValue({ count: 0 });
      tx.product.findUnique
        .mockResolvedValueOnce(producto)      // lectura inicial
        .mockResolvedValueOnce({ stock: 1 }); // relectura para el mensaje

      await expect(
        service.registerMovement(
          { productId: 1, type: MovementType.SALE, quantity: 5, reason: 'Venta #2' },
          99,
          tx as any,
        ),
      ).rejects.toThrow(ConflictException);

      // Si no hay existencias, NO debe quedar rastro en el Kardex.
      expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('registra el movimiento con cantidad negativa y valuado al costo vigente', async () => {
      await service.registerMovement(
        { productId: 1, type: MovementType.SALE, quantity: 2, reason: 'Venta #3' },
        99,
        tx as any,
      );

      const arg = tx.inventoryMovement.create.mock.calls[0][0].data;
      expect(arg.quantity).toBe(-2);
      expect(arg.unitCost.toString()).toBe('25');
      expect(arg.totalCost.toString()).toBe('50');
    });
  });

  describe('entradas (PURCHASE / RETURN_IN / INITIAL)', () => {
    it('incrementa de forma atómica delegando a la BD', async () => {
      await service.registerMovement(
        { productId: 1, type: MovementType.PURCHASE, quantity: 7, reason: 'Compra #1' },
        99,
        tx as any,
      );

      expect(tx.product.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { stock: { increment: 7 } },
      });
      expect(tx.product.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('valuación explícita (reversiones)', () => {
    it('respeta unitCostOverride en lugar del costo promedio vigente', async () => {
      await service.registerMovement(
        { productId: 1, type: MovementType.RETURN_OUT, quantity: 4, reason: 'Cancelación compra' },
        99,
        tx as any,
        new Decimal(200), // costo REAL al que entró la mercancía
      );

      const arg = tx.inventoryMovement.create.mock.calls[0][0].data;
      expect(arg.unitCost.toString()).toBe('200'); // no 25
      expect(arg.totalCost.toString()).toBe('800');
    });
  });

  describe('garantías generales', () => {
    it('abre su propia transacción si el llamador no aporta una', async () => {
      await service.registerMovement(
        { productId: 1, type: MovementType.SALE, quantity: 1, reason: 'Venta suelta' },
        99,
      );
      // Sin transacción, un fallo dejaría Kardex y stock desalineados.
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('rechaza un movimiento de cantidad 0', async () => {
      await expect(
        service.registerMovement(
          { productId: 1, type: MovementType.ADJUSTMENT, quantity: 0, reason: 'Ajuste vacío' },
          99,
          tx as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza si el producto no existe', async () => {
      tx.product.findUnique.mockResolvedValue(null);
      await expect(
        service.registerMovement(
          { productId: 404, type: MovementType.SALE, quantity: 1, reason: 'x' },
          99,
          tx as any,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('registerAdjustment (conteo físico)', () => {
    it('rechaza un conteo negativo', async () => {
      await expect(
        service.registerAdjustment(1, -5, 'conteo', 99),
      ).rejects.toThrow(BadRequestException);
    });

    it('bloquea la fila del producto antes de calcular la diferencia', async () => {
      tx.product.findUnique.mockResolvedValue({ ...producto, stock: 10 });
      await service.registerAdjustment(1, 8, 'faltan 2', 99);

      // El bloqueo evita que una venta concurrente invalide el conteo.
      expect(tx.$queryRaw).toHaveBeenCalled();
      // Diferencia -2 => salida de 2 unidades (LOSS)
      expect(tx.product.updateMany).toHaveBeenCalledWith({
        where: { id: 1, stock: { gte: 2 } },
        data: { stock: { decrement: 2 } },
      });
    });
  });
});
