/**
 * CONTRATO DE TICKETS (P1-3) — requiere PostgreSQL.
 *
 * ⚠️  USA UNA BASE DE DATOS DE PRUEBA: este test escribe y borra registros.
 *
 *   $env:DATABASE_URL="postgresql://postgres:123456@localhost:5432/pharma_test"
 *   npx prisma migrate deploy
 *   npm run test:e2e
 *
 * Qué demuestra:
 *   1. GET de la ficha fiscal es idempotente (una sola Company).
 *   2. Solo puede haber una plantilla predeterminada.
 *   3. No se desactiva la última plantilla activa.
 *   4. Un borrador no se imprime.
 *   5. copyNumber 1 = original, 2 = primera reimpresión.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  PrintChannel,
  SaleFlowStatus,
  SaleStatus,
  UserRole,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyService } from '../src/company/company.service';
import { SalesService } from '../src/sales/sales.service';
import { InventoryService } from '../src/inventory/inventory.service';
import { CashShiftService } from '../src/cash-shift/cash-shift.service';
import { PaymentService } from '../src/payment/payment.service';

jest.setTimeout(60_000);

describe('Tickets: empresa, plantillas e impresiones (integración)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let company: CompanyService;
  let sales: SalesService;

  let userId: number;
  const creados = {
    sales: [] as number[],
    templates: [] as number[],
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        CompanyService,
        SalesService,
        InventoryService,
        CashShiftService,
        PaymentService,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    company = moduleRef.get(CompanyService);
    sales = moduleRef.get(SalesService);

    const stamp = Date.now();
    const user = await prisma.user.create({
      data: {
        userName: `qa_ticket_${stamp}`,
        email: `qa_ticket_${stamp}@test.local`,
        password: 'x',
        firstName: 'QA',
        lastName: 'Tickets',
        role: UserRole.ADMIN,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.saleReceiptPrint.deleteMany({
      where: { saleId: { in: creados.sales } },
    });
    await prisma.sale.deleteMany({ where: { id: { in: creados.sales } } });
    if (creados.templates.length > 0) {
      await prisma.receiptTemplate.deleteMany({
        where: { id: { in: creados.templates } },
      });
    }
    const seed = await prisma.receiptTemplate.findFirst({
      where: { isActive: true, company: { singletonKey: 'default' } },
      orderBy: { id: 'asc' },
    });
    if (seed) {
      await prisma.receiptTemplate.updateMany({
        where: { companyId: seed.companyId, isDefault: true },
        data: { isDefault: false },
      });
      await prisma.receiptTemplate.update({
        where: { id: seed.id },
        data: { isDefault: true, isActive: true },
      });
    }
    await prisma.user.delete({ where: { id: userId } });
    await moduleRef.close();
  });

  it('devuelve siempre la misma ficha fiscal', async () => {
    const a = await company.getProfile();
    const b = await company.getProfile();
    expect(a.company.id).toBe(b.company.id);
    expect(a.company.singletonKey).toBe('default');
    expect(a.defaultTemplate).toBeTruthy();
    expect(a.defaultTemplate?.paperWidthMm).toBe(58);
  });

  it('al crear una plantilla como default, la anterior deja de serlo', async () => {
    const created = await company.createTemplate({
      name: 'Térmica 80 mm QA',
      paperWidthMm: 80,
      isDefault: true,
    });
    creados.templates.push(created.id);

    const profile = await company.getProfile();
    const defaults = profile.templates.filter((t) => t.isDefault && t.isActive);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(created.id);
    expect(created.paperWidthMm).toBe(80);
  });

  it('no permite desactivar la última plantilla activa', async () => {
    const profile = await company.getProfile();
    const extra = profile.templates.find((t) =>
      creados.templates.includes(t.id),
    );
    expect(extra).toBeTruthy();

    await company.deactivateTemplate(extra!.id);

    const seed = (await company.getProfile()).templates.find(
      (t) => t.isActive && !creados.templates.includes(t.id),
    );
    expect(seed).toBeTruthy();
    await expect(company.deactivateTemplate(seed!.id)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('no imprime un borrador y numera original vs copia en una venta cerrada', async () => {
    const draft = await prisma.sale.create({
      data: {
        total: new Decimal(0),
        subtotal: new Decimal(0),
        userId,
        flowStatus: SaleFlowStatus.DRAFT,
        status: SaleStatus.PENDING,
      },
    });
    creados.sales.push(draft.id);

    await expect(
      sales.registerPrint(draft.id, userId, PrintChannel.BROWSER),
    ).rejects.toThrow(BadRequestException);

    const closed = await prisma.sale.create({
      data: {
        total: new Decimal(100),
        subtotal: new Decimal(100),
        userId,
        flowStatus: SaleFlowStatus.COMPLETED,
        status: SaleStatus.COMPLETED,
      },
    });
    creados.sales.push(closed.id);

    const original = await sales.registerPrint(
      closed.id,
      userId,
      PrintChannel.BROWSER,
    );
    const copia = await sales.registerPrint(
      closed.id,
      userId,
      PrintChannel.THERMAL,
    );

    expect(original.copyNumber).toBe(1);
    expect(copia.copyNumber).toBe(2);

    const historial = await sales.listPrints(closed.id);
    expect(historial.map((p) => p.copyNumber)).toEqual([1, 2]);

    const detalle = await sales.findOne(closed.id);
    expect(detalle.receiptPrints).toHaveLength(2);
  });
});
