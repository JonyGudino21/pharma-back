/**
 * CONTRATO DEL HISTORIAL DE VENTAS Y DEVOLUCIONES (P1-2) — requiere PostgreSQL.
 *
 * ⚠️  USA UNA BASE DE DATOS DE PRUEBA: este test escribe y borra registros.
 *
 * Por qué existe: la pantalla de historial decide qué botones ofrece (devolver,
 * anular) replicando las reglas del backend. Si el servicio deja de devolver el
 * historial de devoluciones, o si la autorización por estado cambia, la UI no
 * falla: ofrece acciones que terminan en error, o esconde acciones legítimas.
 * Ninguna de las dos cosas la detecta una prueba unitaria con mocks, porque el
 * mock siempre devuelve lo que el test quiere creer.
 *
 * Qué demuestra:
 *   1. El cajero descarta su propio borrador (rutina de mostrador).
 *   2. El cajero NO anula una venta cerrada, y el rechazo no deja rastro.
 *   3. La gerencia sí la anula: stock y dinero vuelven.
 *   4. El detalle expone las devoluciones con importe, para que el front sepa
 *      cuánto queda por devolver de cada línea.
 *   5. El listado cuenta las devoluciones sin cargarlas.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { PaymentMethod, SaleFlowStatus, UserRole } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../src/sales/sales.service';
import { InventoryService } from '../src/inventory/inventory.service';
import { CashShiftService } from '../src/cash-shift/cash-shift.service';
import { PaymentService } from '../src/payment/payment.service';

jest.setTimeout(60_000);

describe('Historial de ventas y devoluciones (integración)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let sales: SalesService;

  let cajeroId: number;
  let gerenteId: number;
  let cashShiftId: number;
  let cashShiftGerenteId: number;
  const creados = {
    products: [] as number[],
    sales: [] as number[],
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        SalesService,
        InventoryService,
        CashShiftService,
        PaymentService,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    sales = moduleRef.get(SalesService);

    const stamp = Date.now();
    const cajero = await prisma.user.create({
      data: {
        userName: `qa_hist_cajero_${stamp}`,
        email: `qa_hist_cajero_${stamp}@test.local`,
        password: 'x',
        firstName: 'QA',
        lastName: 'Cajero',
        role: UserRole.CASHIER,
      },
    });
    cajeroId = cajero.id;

    const gerente = await prisma.user.create({
      data: {
        userName: `qa_hist_gerente_${stamp}`,
        email: `qa_hist_gerente_${stamp}@test.local`,
        password: 'x',
        firstName: 'QA',
        lastName: 'Gerente',
        role: UserRole.MANAGER,
      },
    });
    gerenteId = gerente.id;

    // Cobrar en efectivo exige turno abierto; sin él las ventas quedarían con
    // saldo y no podrían cerrarse, que es justo el estado que estas pruebas necesitan.
    const shift = await prisma.cashShift.create({
      data: { userId: cajeroId, initialAmount: new Decimal(5000) },
    });
    cashShiftId = shift.id;

    // El gerente necesita SU PROPIO turno abierto: el efectivo de un reembolso
    // sale de la caja de quien lo autoriza, no de la del cajero que vendió.
    // Es la razón por la que la pantalla avisa antes de confirmar la devolución.
    const shiftGerente = await prisma.cashShift.create({
      data: { userId: gerenteId, initialAmount: new Decimal(5000) },
    });
    cashShiftGerenteId = shiftGerente.id;
  });

  afterAll(async () => {
    // Orden dictado por las llaves foráneas: primero las hijas.
    const devoluciones = await prisma.saleReturn.findMany({
      where: { saleId: { in: creados.sales } },
      select: { id: true },
    });
    const devolucionIds = devoluciones.map((d) => d.id);

    await prisma.saleRefund.deleteMany({
      where: { saleReturnId: { in: devolucionIds } },
    });
    await prisma.saleReturnItem.deleteMany({
      where: { saleReturnId: { in: devolucionIds } },
    });
    await prisma.saleReturn.deleteMany({
      where: { id: { in: devolucionIds } },
    });

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
    await prisma.productPriceHistory.deleteMany({
      where: { productId: { in: creados.products } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: creados.products } },
    });
    await prisma.cashTransaction.deleteMany({
      where: { shiftId: { in: [cashShiftId, cashShiftGerenteId] } },
    });
    await prisma.cashShift.deleteMany({
      where: { id: { in: [cashShiftId, cashShiftGerenteId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [cajeroId, gerenteId] } },
    });
    await moduleRef.close();
  });

  const nuevoProducto = async (stock = 100, cost = 50, price = 100) => {
    const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    const p = await prisma.product.create({
      data: {
        name: `QA Hist ${stamp}`,
        sku: `QAH-${stamp}`,
        stock,
        minStock: 0,
        price: new Decimal(price),
        cost: new Decimal(cost),
      },
    });
    creados.products.push(p.id);
    return p;
  };

  /** Venta cerrada y pagada de contado, lista para devolver o anular. */
  const ventaCerrada = async (productId: number, cantidad: number) => {
    const venta = await sales.create(
      { items: [{ productId, quantity: cantidad }] },
      cajeroId,
    );
    creados.sales.push(venta.id);
    await sales.addPayment(
      venta.id,
      { method: PaymentMethod.CASH, amount: Number(venta.total) },
      cajeroId,
    );
    await sales.completeSale(venta.id, cajeroId);
    return venta;
  };

  // ───────────────────────────────────────────────────────────────────
  it('1) el cajero descarta su propio borrador', async () => {
    const producto = await nuevoProducto(20);
    const borrador = await sales.create(
      { items: [{ productId: producto.id, quantity: 2 }] },
      cajeroId,
    );
    creados.sales.push(borrador.id);

    await sales.cancel(borrador.id, cajeroId, UserRole.CASHIER);

    const final = await prisma.sale.findUnique({ where: { id: borrador.id } });
    const productoFinal = await prisma.product.findUnique({
      where: { id: producto.id },
    });

    expect(final?.status).toBe('CANCELLED');
    // El borrador nunca descontó stock, así que cancelarlo tampoco debe devolverlo.
    expect(productoFinal?.stock).toBe(20);
  });

  // ───────────────────────────────────────────────────────────────────
  it('2) el cajero NO anula una venta cerrada, y el rechazo no deja rastro', async () => {
    const producto = await nuevoProducto(20);
    const venta = await ventaCerrada(producto.id, 3);

    await expect(
      sales.cancel(venta.id, cajeroId, UserRole.CASHIER),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Lo que de verdad se prueba aquí: el rechazo ocurre DESPUÉS del claim
    // atómico que marca la venta como cancelada. Si la excepción no revirtiera
    // la transacción, la venta quedaría anulada sin haber devuelto el stock ni
    // el dinero: una venta fantasma imposible de detectar desde la UI.
    const final = await prisma.sale.findUnique({ where: { id: venta.id } });
    const productoFinal = await prisma.product.findUnique({
      where: { id: producto.id },
    });

    expect(final?.status).not.toBe('CANCELLED');
    expect(productoFinal?.stock).toBe(17); // sigue descontado: la venta sigue viva
  });

  // ───────────────────────────────────────────────────────────────────
  it('3) la gerencia sí anula una venta cerrada y el stock vuelve', async () => {
    const producto = await nuevoProducto(20);
    const venta = await ventaCerrada(producto.id, 4);

    await sales.cancel(venta.id, gerenteId, UserRole.MANAGER);

    const final = await prisma.sale.findUnique({ where: { id: venta.id } });
    const productoFinal = await prisma.product.findUnique({
      where: { id: producto.id },
    });

    expect(final?.status).toBe('CANCELLED');
    expect(productoFinal?.stock).toBe(20); // reingresado
  });

  // ───────────────────────────────────────────────────────────────────
  it('4) el detalle expone la devolución con su reembolso e importe', async () => {
    const producto = await nuevoProducto(20);
    const venta = await ventaCerrada(producto.id, 5);
    const linea = await prisma.saleItem.findFirstOrThrow({
      where: { saleId: venta.id },
    });

    await sales.createReturn(
      venta.id,
      {
        items: [{ saleItemId: linea.id, quantity: 2, restock: true }],
        refundToCustomer: true,
      },
      gerenteId,
    );

    const detalle = await sales.findOne(venta.id);

    expect(detalle.saleReturn).toHaveLength(1);
    const devolucion = detalle.saleReturn[0];
    expect(devolucion.items).toHaveLength(1);
    expect(devolucion.items[0].quantity).toBe(2);
    expect(devolucion.items[0].saleItemId).toBe(linea.id);

    // El front resta las unidades ya devueltas para saber cuántas ofrece. Si
    // `saleItemId` o `quantity` dejaran de venir, ofrecería devolver de nuevo
    // mercancía ya devuelta y el backend lo rechazaría en la cara del usuario.
    const devueltasPorLinea = detalle.saleReturn
      .flatMap((d) => d.items)
      .reduce<Record<number, number>>(
        (acc, i) => ({
          ...acc,
          [i.saleItemId]: (acc[i.saleItemId] ?? 0) + i.quantity,
        }),
        {},
      );
    expect(devueltasPorLinea[linea.id]).toBe(2);

    // Quien procesó la devolución se muestra en el detalle: es la traza de
    // auditoría de quien autorizó la salida de dinero.
    expect(devolucion.processedBy).toBeTruthy();

    // La venta estaba liquidada, así que la devolución salió en efectivo.
    const reembolsado = devolucion.refund.reduce(
      (acc, r) => acc + Number(r.amount),
      0,
    );
    expect(reembolsado).toBeCloseTo(200, 2); // 2 unidades × $100

    const productoFinal = await prisma.product.findUnique({
      where: { id: producto.id },
    });
    expect(productoFinal?.stock).toBe(17); // 20 − 5 vendidas + 2 devueltas al anaquel
  });

  // ───────────────────────────────────────────────────────────────────
  it('5) anular tras una devolución parcial no duplica stock ni dinero', async () => {
    // El caso que P1-2 vuelve alcanzable: "Devolver" y "Anular venta" conviven
    // en la misma pantalla, a un clic de distancia. Antes de este arreglo,
    // anular reingresaba la cantidad VENDIDA y reembolsaba lo PAGADO completos,
    // ignorando la devolución previa: inventario fantasma y dinero pagado dos
    // veces. Ninguno de los dos descuadres es visible desde la UI.
    const producto = await nuevoProducto(50, 50, 100);
    const venta = await ventaCerrada(producto.id, 6); // 6 × $100 = $600
    const linea = await prisma.saleItem.findFirstOrThrow({
      where: { saleId: venta.id },
    });

    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: producto.id } }))
        .stock,
    ).toBe(44); // 50 − 6

    // Devolución parcial: 2 unidades vuelven al anaquel y $200 salen de la caja.
    await sales.createReturn(
      venta.id,
      {
        items: [{ saleItemId: linea.id, quantity: 2, restock: true }],
        refundToCustomer: true,
      },
      gerenteId,
    );

    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: producto.id } }))
        .stock,
    ).toBe(46); // 44 + 2

    await sales.cancel(venta.id, gerenteId, UserRole.MANAGER);

    // El cliente solo tenía 4 unidades en la mano: son las únicas que vuelven.
    const productoFinal = await prisma.product.findUniqueOrThrow({
      where: { id: producto.id },
    });
    expect(productoFinal.stock).toBe(50);

    // Y del dinero: de los $600 pagados ya se habían devuelto $200, así que la
    // anulación solo puede sacar los $400 restantes de la caja.
    const reembolsos = await prisma.saleRefund.aggregate({
      where: { saleId: venta.id },
      _sum: { amount: true },
    });
    expect(Number(reembolsos._sum.amount)).toBeCloseTo(600, 2);
  });

  // ───────────────────────────────────────────────────────────────────
  it('6) el listado cuenta las devoluciones sin cargarlas', async () => {
    const producto = await nuevoProducto(20);
    const venta = await ventaCerrada(producto.id, 3);
    const linea = await prisma.saleItem.findFirstOrThrow({
      where: { saleId: venta.id },
    });

    await sales.createReturn(
      venta.id,
      {
        items: [{ saleItemId: linea.id, quantity: 1, restock: false }],
        refundToCustomer: false,
      },
      gerenteId,
    );

    const { sales: listado } = await sales.findAll({
      invoiceNumber: (
        await prisma.sale.findUniqueOrThrow({
          where: { id: venta.id },
          select: { invoiceNumber: true },
        })
      ).invoiceNumber!,
    });

    expect(listado).toHaveLength(1);
    expect(listado[0]._count.saleReturn).toBe(1);

    // `restock: false` es merma: la mercancía NO vuelve al anaquel.
    const productoFinal = await prisma.product.findUnique({
      where: { id: producto.id },
    });
    expect(productoFinal?.stock).toBe(17); // 20 − 3, la devuelta no reingresa
  });

  it('7) el listado no mezcla borradores del mostrador', async () => {
    const producto = await nuevoProducto(20);
    const borrador = await sales.create(
      { items: [{ productId: producto.id, quantity: 1 }] },
      cajeroId,
    );
    creados.sales.push(borrador.id);

    const { sales: porDefecto } = await sales.findAll({
      userId: cajeroId,
      limit: 100,
    });
    expect(porDefecto.some((s) => s.id === borrador.id)).toBe(false);

    const { sales: soloBorradores } = await sales.findAll({
      userId: cajeroId,
      flowStatus: SaleFlowStatus.DRAFT,
      limit: 100,
    });
    expect(soloBorradores.some((s) => s.id === borrador.id)).toBe(true);
  });
});
