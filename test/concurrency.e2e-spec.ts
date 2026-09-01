/**
 * PRUEBA DE CONCURRENCIA REAL (P0-1) — requiere PostgreSQL.
 *
 * ⚠️  USA UNA BASE DE DATOS DE PRUEBA: este test escribe y borra registros.
 *
 *   # 1) Apunta DATABASE_URL a una BD desechable y aplica el esquema
 *   $env:DATABASE_URL="postgresql://postgres:123456@localhost:5432/pharma_test"
 *   npx prisma migrate deploy
 *
 *   # 2) Ejecuta
 *   npm run test:e2e
 *
 * Qué demuestra:
 *   1. Sobreventa imposible: N ventas simultáneas contra un stock menor.
 *   2. Doble cierre imposible: la misma venta cerrada dos veces en paralelo.
 *   3. Límite de crédito respetado bajo concurrencia.
 *   4. El costo promedio se restaura al cancelar una compra recibida.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentMethod } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../src/sales/sales.service';
import { PurchaseService } from '../src/purchase/purchase.service';
import { InventoryService } from '../src/inventory/inventory.service';
import { CashShiftService } from '../src/cash-shift/cash-shift.service';
import { PaymentService } from '../src/payment/payment.service';

jest.setTimeout(60_000);

describe('Concurrencia de inventario y ventas (integración)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let sales: SalesService;
  let purchases: PurchaseService;

  let userId: number;
  let cashShiftId: number;
  const creados = {
    products: [] as number[],
    sales: [] as number[],
    clients: [] as number[],
    suppliers: [] as number[],
    purchases: [] as number[],
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        SalesService,
        PurchaseService,
        InventoryService,
        CashShiftService,
        PaymentService,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    sales = moduleRef.get(SalesService);
    purchases = moduleRef.get(PurchaseService);

    const stamp = Date.now();
    const user = await prisma.user.create({
      data: {
        userName: `qa_conc_${stamp}`,
        email: `qa_conc_${stamp}@test.local`,
        password: 'x',
        firstName: 'QA',
        lastName: 'Concurrencia',
        role: 'ADMIN',
      },
    });
    userId = user.id;

    // El cobro en efectivo exige un turno de caja abierto (PaymentService.resolveCashShiftId).
    // Sin él, las ventas de contado quedan con saldo pendiente y NINGÚN cierre prospera,
    // con lo que la prueba de sobreventa dejaría de probar lo que dice probar.
    const shift = await prisma.cashShift.create({
      data: { userId, initialAmount: new Decimal(1000) },
    });
    cashShiftId = shift.id;
  });

  afterAll(async () => {
    // Limpieza respetando las llaves foráneas. El orden importa: primero las tablas
    // hijas, después las padres. Sale referencia a CashShift, así que el turno se
    // borra al final.
    await prisma.inventoryMovement.deleteMany({
      where: { productId: { in: creados.products } },
    });
    await prisma.saleItem.deleteMany({
      where: { saleId: { in: creados.sales } },
    });
    await prisma.salePayment.deleteMany({
      where: { saleId: { in: creados.sales } },
    });
    await prisma.sale.deleteMany({ where: { id: { in: creados.sales } } });
    await prisma.purchaseItem.deleteMany({
      where: { purchaseId: { in: creados.purchases } },
    });
    await prisma.purchase.deleteMany({
      where: { id: { in: creados.purchases } },
    });
    await prisma.productPriceHistory.deleteMany({
      where: { productId: { in: creados.products } },
    });
    // Asignar un cliente a una venta genera precio especial e historial para ese cliente.
    await prisma.clientProductPriceHistory.deleteMany({
      where: { productId: { in: creados.products } },
    });
    await prisma.clientProductPrice.deleteMany({
      where: { productId: { in: creados.products } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: creados.products } },
    });
    await prisma.client.deleteMany({ where: { id: { in: creados.clients } } });
    await prisma.supplier.deleteMany({
      where: { id: { in: creados.suppliers } },
    });
    await prisma.cashTransaction.deleteMany({
      where: { shiftId: cashShiftId },
    });
    await prisma.cashShift.delete({ where: { id: cashShiftId } });
    await prisma.user.delete({ where: { id: userId } });
    await moduleRef.close();
  });

  const nuevoProducto = async (stock: number, cost = 50, price = 100) => {
    const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    const p = await prisma.product.create({
      data: {
        name: `QA Producto ${stamp}`,
        sku: `QA-${stamp}`,
        stock,
        minStock: 0,
        price: new Decimal(price),
        cost: new Decimal(cost),
      },
    });
    creados.products.push(p.id);
    return p;
  };

  // ───────────────────────────────────────────────────────────────────
  it('1) NO permite sobreventa: 12 cierres simultáneos contra stock de 5', async () => {
    const producto = await nuevoProducto(5);

    // 12 ventas en borrador, cada una de 1 unidad
    const borradores = await Promise.all(
      Array.from({ length: 12 }, () =>
        sales.create(
          { items: [{ productId: producto.id, quantity: 1 }] },
          userId,
        ),
      ),
    );
    borradores.forEach((s) => creados.sales.push(s.id));

    // Pagamos cada venta para que sea de contado (balance 0). Si el cobro fallara,
    // la prueba debe romperse aquí y no disfrazar el fallo como "no hubo sobreventa".
    for (const s of borradores) {
      await sales.addPayment(
        s.id,
        { method: PaymentMethod.CASH, amount: Number(s.total) },
        userId,
      );
    }

    // CIERRE SIMULTÁNEO
    const resultados = await Promise.allSettled(
      borradores.map((s) => sales.completeSale(s.id, userId)),
    );

    const exitosos = resultados.filter((r) => r.status === 'fulfilled').length;
    const fallidos = resultados.filter((r) => r.status === 'rejected').length;

    const final = await prisma.product.findUnique({
      where: { id: producto.id },
    });
    const movimientos = await prisma.inventoryMovement.aggregate({
      where: { productId: producto.id, type: 'SALE' },
      _sum: { quantity: true },
    });

    console.log(
      `   cierres OK: ${exitosos}, rechazados: ${fallidos}, stock final: ${final?.stock}`,
    );

    expect(final?.stock).toBe(0); // nunca negativo
    expect(exitosos).toBeLessThanOrEqual(5); // como máximo lo que había
    expect(Number(movimientos._sum.quantity)).toBe(-exitosos); // Kardex cuadra con lo vendido
    expect(exitosos + fallidos).toBe(12);
  });

  // ───────────────────────────────────────────────────────────────────
  it('2) NO permite cerrar dos veces la misma venta (doble clic)', async () => {
    const producto = await nuevoProducto(50);
    const venta = await sales.create(
      { items: [{ productId: producto.id, quantity: 3 }] },
      userId,
    );
    creados.sales.push(venta.id);
    await sales.addPayment(
      venta.id,
      { method: PaymentMethod.CASH, amount: Number(venta.total) },
      userId,
    );

    const [a, b] = await Promise.allSettled([
      sales.completeSale(venta.id, userId),
      sales.completeSale(venta.id, userId),
    ]);

    const exitosos = [a, b].filter((r) => r.status === 'fulfilled').length;
    const final = await prisma.product.findUnique({
      where: { id: producto.id },
    });
    const folios = await prisma.sale.findUnique({
      where: { id: venta.id },
      select: { invoiceNumber: true },
    });

    expect(exitosos).toBe(1); // exactamente un cierre
    expect(final?.stock).toBe(47); // descontado UNA vez (50 - 3)
    expect(folios?.invoiceNumber).toBeTruthy();
  });

  // ───────────────────────────────────────────────────────────────────
  it('3) respeta el límite de crédito con dos ventas simultáneas', async () => {
    const producto = await nuevoProducto(100, 50, 600);
    const cliente = await prisma.client.create({
      data: {
        name: `QA Cliente ${Date.now()}`,
        hasCredit: true,
        creditLimit: new Decimal(1000),
        currentDebt: new Decimal(0),
      },
    });
    creados.clients.push(cliente.id);

    // Dos ventas de $600 a crédito: juntas serían $1200 > $1000
    const v1 = await sales.create(
      {
        clientId: cliente.id,
        items: [{ productId: producto.id, quantity: 1 }],
      },
      userId,
    );
    const v2 = await sales.create(
      {
        clientId: cliente.id,
        items: [{ productId: producto.id, quantity: 1 }],
      },
      userId,
    );
    creados.sales.push(v1.id, v2.id);

    const res = await Promise.allSettled([
      sales.completeSale(v1.id, userId),
      sales.completeSale(v2.id, userId),
    ]);
    const exitosos = res.filter((r) => r.status === 'fulfilled').length;

    const clienteFinal = await prisma.client.findUnique({
      where: { id: cliente.id },
    });

    expect(exitosos).toBe(1); // solo una pasa
    expect(Number(clienteFinal?.currentDebt)).toBeLessThanOrEqual(1000); // límite respetado
  });

  // ───────────────────────────────────────────────────────────────────
  it('4) restaura el costo promedio al cancelar una compra recibida', async () => {
    const producto = await nuevoProducto(10, 100); // 10 u @ $100
    const proveedor = await prisma.supplier.create({
      data: { name: `QA Prov ${Date.now()}` },
    });
    creados.suppliers.push(proveedor.id);

    const compra = await purchases.create(
      {
        supplierId: proveedor.id,
        invoiceNumber: `QA-${Date.now()}`,
        items: [{ productId: producto.id, quantity: 10, cost: 200 }], // 10 u @ $200
      },
      userId,
    );
    if (!compra) throw new Error('No se pudo crear la compra de prueba');
    creados.purchases.push(compra.id);

    await purchases.receive(compra.id, userId);
    const trasRecibir = await prisma.product.findUnique({
      where: { id: producto.id },
    });
    expect(Number(trasRecibir?.cost)).toBeCloseTo(150, 2); // promedio ponderado
    expect(trasRecibir?.stock).toBe(20);

    await purchases.cancel(compra.id, userId);
    const trasCancelar = await prisma.product.findUnique({
      where: { id: producto.id },
    });

    expect(trasCancelar?.stock).toBe(10);
    expect(Number(trasCancelar?.cost)).toBeCloseTo(100, 2); // costo RESTAURADO
  });
});
