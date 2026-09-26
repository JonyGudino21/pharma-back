import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { ClientService } from './client.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CashShiftService } from '../cash-shift/cash-shift.service';
import { PaymentService } from '../payment/payment.service';
import { argDe, argsDe } from '../common/testing/mock-inspect.util';

/**
 * Contrato de CLIENTES Y COBRANZA. No requiere base de datos.
 *
 * Eran 700 líneas con cero cobertura moviendo la deuda de los clientes: quién
 * debe cuánto, qué venta se salda primero con un abono y qué pasa con el dinero
 * que sobra. El mismo perfil de riesgo que tenía `purchase.service.ts` antes de
 * que las pruebas encontraran cosas ahí.
 *
 * Invariantes que estas pruebas fijan:
 *   1. Un abono se aplica FIFO: la venta más antigua se salda primero.
 *   2. El excedente NO se acredita ni deja la deuda en negativo.
 *   3. La deuda la descuenta PaymentService, no este servicio (descontarla aquí
 *      la restaría dos veces).
 *   4. El efectivo exige caja abierta.
 *   5. Un abono sin ventas pendientes se rechaza en vez de perderse.
 */
describe('ClientService — cobranza y deuda', () => {
  let service: ClientService;

  const tx = {
    sale: { findMany: jest.fn() },
    client: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
  };

  const mockPrisma = {
    $transaction: jest.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
    client: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
  };

  const mockCashShift = { getCurrentShift: jest.fn() };
  const mockPayment = { applyToSale: jest.fn() };

  /** Cliente con $1,000 de deuda y crédito autorizado. */
  const clienteConDeuda = {
    id: 7,
    name: 'Farmacia del Centro',
    currentDebt: new Decimal(1000),
    creditLimit: new Decimal(5000),
    hasCredit: true,
    isActive: true,
  };

  /** Tres ventas pendientes, de la más antigua a la más reciente. */
  const ventasPendientes = [
    {
      id: 1,
      invoiceNumber: 'F-001',
      balance: new Decimal(300),
      paidAmount: new Decimal(0),
    },
    {
      id: 2,
      invoiceNumber: 'F-002',
      balance: new Decimal(500),
      paidAmount: new Decimal(0),
    },
    {
      id: 3,
      invoiceNumber: 'F-003',
      balance: new Decimal(200),
      paidAmount: new Decimal(0),
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CashShiftService, useValue: mockCashShift },
        { provide: PaymentService, useValue: mockPayment },
      ],
    }).compile();

    service = module.get<ClientService>(ClientService);
    jest.clearAllMocks();

    mockPrisma.client.findUnique.mockResolvedValue(clienteConDeuda);
    tx.sale.findMany.mockResolvedValue(ventasPendientes);
    tx.client.findUniqueOrThrow.mockResolvedValue({
      currentDebt: new Decimal(0),
    });
    mockCashShift.getCurrentShift.mockResolvedValue({ id: 42 });
    mockPayment.applyToSale.mockImplementation(() =>
      Promise.resolve({ payment: { id: Math.random() } }),
    );
  });

  const abonar = (amount: number, method = 'TRANSFER') =>
    service.registerPayment(7, { amount, method } as never, 99);

  // ══════════════════════════════════════════════════════════════════
  describe('aplicación FIFO', () => {
    it('consulta las ventas pendientes de la MÁS ANTIGUA a la más reciente', async () => {
      await abonar(300);

      const { orderBy, where } = argDe<{
        orderBy: { createdAt: string };
        where: Record<string, unknown>;
      }>(tx.sale.findMany);

      // Sin este orden, un abono saldaría la venta más reciente y dejaría viva
      // la vieja: la antigüedad de la cartera se falsearía y el reporte de
      // morosidad dejaría de reflejar la realidad.
      expect(orderBy.createdAt).toBe('asc');
      expect(where.clientId).toBe(7);
      expect(where.balance).toEqual({ gt: 0 });
    });

    it('salda por completo la venta más antigua antes de tocar la siguiente', async () => {
      await abonar(300);

      expect(mockPayment.applyToSale).toHaveBeenCalledTimes(1);
      const { saleId, amount } = argDe<{ saleId: number; amount: Decimal }>(
        mockPayment.applyToSale,
        0,
        1,
      );
      expect(saleId).toBe(1);
      expect(amount.toString()).toBe('300');
    });

    it('reparte un abono grande entre varias ventas, en orden', async () => {
      // $900 = 300 (F-001) + 500 (F-002) + 100 a cuenta de F-003.
      await abonar(900);

      const aplicaciones = argsDe<{ saleId: number; amount: Decimal }>(
        mockPayment.applyToSale,
        1,
      );

      expect(aplicaciones.map((a) => a.saleId)).toEqual([1, 2, 3]);
      expect(aplicaciones.map((a) => a.amount.toString())).toEqual([
        '300',
        '500',
        '100',
      ]);
    });

    it('un abono parcial no toca las ventas siguientes', async () => {
      await abonar(150);

      expect(mockPayment.applyToSale).toHaveBeenCalledTimes(1);
      const { amount } = argDe<{ amount: Decimal }>(
        mockPayment.applyToSale,
        0,
        1,
      );
      expect(amount.toString()).toBe('150');
    });

    it('nunca aplica a una venta más de lo que se debe', async () => {
      // El arreglo clásico: `min(saldo, restante)`. Sin él, un abono de $900
      // sobre una venta de $300 generaría un pago de $900 y un saldo de -$600.
      await abonar(900);

      const aplicaciones = argsDe<{ saleId: number; amount: Decimal }>(
        mockPayment.applyToSale,
        1,
      );
      const saldoDe = new Map(ventasPendientes.map((v) => [v.id, v.balance]));

      for (const { saleId, amount } of aplicaciones) {
        const saldo = saldoDe.get(saleId);
        expect(saldo).toBeDefined();
        expect(amount.lte(saldo ?? new Decimal(0))).toBe(true);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('sobrepago', () => {
    it('el excedente NO se aplica y se informa por separado', async () => {
      // Deuda total $1,000; el cliente paga $1,500.
      const res = await abonar(1500);

      expect(res.appliedAmount).toBe(1000);
      expect(res.overpaidAmount).toBe(500);
    });

    it('el excedente no genera un pago fantasma', async () => {
      await abonar(1500);

      // Exactamente tres aplicaciones: una por venta pendiente. Ni una más.
      expect(mockPayment.applyToSale).toHaveBeenCalledTimes(3);
      const total = argsDe<{ amount: Decimal }>(
        mockPayment.applyToSale,
        1,
      ).reduce((acc, a) => acc.add(a.amount), new Decimal(0));

      expect(total.toString()).toBe('1000');
    });

    it('el mensaje avisa de que el excedente no queda a cuenta', async () => {
      const res = await abonar(1500);
      expect(res.message).toMatch(/excedente/i);
    });

    it('un pago exacto no reporta excedente', async () => {
      const res = await abonar(1000);
      expect(res.overpaidAmount).toBe(0);
      expect(res.appliedAmount).toBe(1000);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('quién descuenta la deuda', () => {
    it('NO actualiza currentDebt: lo hace PaymentService', async () => {
      await abonar(1000);

      // Si este servicio también la descontara, el abono se restaría DOS veces
      // y la deuda del cliente quedaría a la mitad de lo real.
      expect(tx.client.update).not.toHaveBeenCalled();
    });

    it('relee la deuda resultante para informarla, sin recalcularla', async () => {
      tx.client.findUniqueOrThrow.mockResolvedValue({
        currentDebt: new Decimal(250),
      });

      const res = await abonar(750);

      expect(tx.client.findUniqueOrThrow).toHaveBeenCalled();
      expect(res.remainingDebt).toBe(250);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('control de caja', () => {
    it('un abono en EFECTIVO exige turno de caja abierto', async () => {
      mockCashShift.getCurrentShift.mockResolvedValue(null);

      await expect(abonar(300, 'CASH')).rejects.toThrow(ConflictException);
      expect(mockPayment.applyToSale).not.toHaveBeenCalled();
    });

    it('el efectivo se ata al turno que lo recibió', async () => {
      await abonar(300, 'CASH');

      const { cashShiftId } = argDe<{ cashShiftId: number | null }>(
        mockPayment.applyToSale,
        0,
        1,
      );
      // Sin esto, el dinero no aparecería en el arqueo de ese turno y el cierre
      // saldría con un sobrante inexplicable.
      expect(cashShiftId).toBe(42);
    });

    it('una transferencia NO exige caja ni la vincula', async () => {
      await abonar(300, 'TRANSFER');

      expect(mockCashShift.getCurrentShift).not.toHaveBeenCalled();
      const { cashShiftId } = argDe<{ cashShiftId: number | null }>(
        mockPayment.applyToSale,
        0,
        1,
      );
      expect(cashShiftId).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('rechazos', () => {
    it('rechaza cobrar a un cliente sin deuda', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({
        ...clienteConDeuda,
        currentDebt: new Decimal(0),
      });

      await expect(abonar(100)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rechaza cobrar a un cliente inexistente', async () => {
      mockPrisma.client.findUnique.mockResolvedValue(null);
      await expect(abonar(100)).rejects.toThrow(NotFoundException);
    });

    it('rechaza el abono si la deuda existe pero no hay ventas pendientes', async () => {
      // Deuda desincronizada. Aceptar el abono lo haría desaparecer sin quedar
      // asentado en ninguna venta: dinero cobrado que no consta en ningún lado.
      tx.sale.findMany.mockResolvedValue([]);

      await expect(abonar(100)).rejects.toThrow(BadRequestException);
      expect(mockPayment.applyToSale).not.toHaveBeenCalled();
    });

    it('sólo considera ventas CERRADAS y no canceladas', async () => {
      await abonar(100);

      const { where } = argDe<{
        where: { status: unknown; flowStatus: unknown };
      }>(tx.sale.findMany);

      // Un borrador del mostrador o una venta anulada no deben recibir abonos.
      expect(where.flowStatus).toBe('COMPLETED');
      expect(where.status).toEqual({ not: 'CANCELLED' });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('configuración de crédito', () => {
    it('valida que el cliente exista antes de tocar su límite', async () => {
      mockPrisma.client.findUnique.mockResolvedValue(null);

      await expect(
        service.updateCreditConfiguration(7, {
          hasCredit: true,
          creditLimit: 9000,
        } as never),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.client.update).not.toHaveBeenCalled();
    });

    it('permite retirar el crédito aunque el cliente deba dinero', async () => {
      // Decisión de negocio explícita: quitar el permiso impide COMPRAR más,
      // pero la deuda existente sigue siendo exigible. Borrarla al retirar el
      // crédito sería condonarla por accidente.
      mockPrisma.client.update.mockResolvedValue({
        ...clienteConDeuda,
        hasCredit: false,
      });

      await service.updateCreditConfiguration(7, {
        hasCredit: false,
        creditLimit: 0,
      } as never);

      const { data } = argDe<{ data: { hasCredit: boolean } }>(
        mockPrisma.client.update,
      );
      expect(data.hasCredit).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('detalle por venta', () => {
    it('informa a qué folios se aplicó el abono y por cuánto', async () => {
      const res = await abonar(500);

      // El cliente pide su recibo: tiene que poder ver qué facturas quedaron
      // saldadas y cuáles siguen abiertas.
      expect(res.appliedBySale).toEqual([
        { saleId: 1, invoiceNumber: 'F-001', amount: 300 },
        { saleId: 2, invoiceNumber: 'F-002', amount: 200 },
      ]);
    });

    it('cuenta las ventas efectivamente abonadas', async () => {
      const res = await abonar(900);
      expect(res.salesPaid).toBe(3);
    });
  });
});
