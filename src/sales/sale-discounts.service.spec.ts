import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { createSettingsMock } from '../common/testing/settings.mock';
import { SaleDiscountsService } from './sale-discounts.service';
import { capForRole, decideDiscount } from './discount-policy';
import { DISCOUNT_SETTINGS } from '../settings/definitions/discounts.settings';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn().mockResolvedValue('$2b$12$senuelo'),
}));

const cfg = DISCOUNT_SETTINGS.defaults({ get: () => undefined } as never);

describe('política de descuentos', () => {
  it('tope por rol con los valores de fábrica (cajero 0, farm. 5, gerente 20, admin 50)', () => {
    expect(capForRole(UserRole.CASHIER, cfg)).toBe(0);
    expect(capForRole(UserRole.PHARMACIST, cfg)).toBe(5);
    expect(capForRole(UserRole.MANAGER, cfg)).toBe(20);
    expect(capForRole(UserRole.ADMIN, cfg)).toBe(50);
  });

  it('ningún tope supera el máximo absoluto', () => {
    expect(
      capForRole(UserRole.MANAGER, {
        ...cfg,
        managerMaxPercent: 80,
        maxPercent: 30,
      }),
    ).toBe(30);
  });

  it('bajar o quitar un descuento siempre se permite, aun con descuentos apagados', () => {
    expect(
      decideDiscount({
        role: UserRole.CASHIER,
        percent: 0,
        previousPercent: 15,
        cfg: { ...cfg, enabled: false },
      }),
    ).toEqual({ kind: 'allowed' });
  });

  it('dentro del tope: permitido; arriba: requiere autorización', () => {
    expect(
      decideDiscount({
        role: UserRole.PHARMACIST,
        percent: 5,
        previousPercent: 0,
        cfg,
      }).kind,
    ).toBe('allowed');
    expect(
      decideDiscount({
        role: UserRole.PHARMACIST,
        percent: 6,
        previousPercent: 0,
        cfg,
      }),
    ).toEqual({
      kind: 'needs-authorization',
      cap: 5,
    });
  });

  it('por encima del máximo absoluto se rechaza para todos', () => {
    expect(
      decideDiscount({
        role: UserRole.ADMIN,
        percent: 51,
        previousPercent: 0,
        cfg,
      }).kind,
    ).toBe('rejected');
  });

  it('sin autorización habilitada, rebasar el tope se rechaza', () => {
    expect(
      decideDiscount({
        role: UserRole.CASHIER,
        percent: 5,
        previousPercent: 0,
        cfg: { ...cfg, allowAuthorization: false },
      }).kind,
    ).toBe('rejected');
  });

  it('con descuentos desactivados no se puede subir ninguno', () => {
    expect(
      decideDiscount({
        role: UserRole.ADMIN,
        percent: 1,
        previousPercent: 0,
        cfg: { ...cfg, enabled: false },
      }).kind,
    ).toBe('rejected');
  });
});

describe('SaleDiscountsService', () => {
  let service: SaleDiscountsService;
  const settings = createSettingsMock();
  const compare = bcrypt.compare as unknown as jest.Mock;

  const linea = (over: Record<string, unknown> = {}) => ({
    id: 1,
    saleId: 10,
    price: new Decimal(100),
    quantity: 2,
    discountPercent: new Decimal(0),
    taxRate: new Decimal(0),
    costAtSale: new Decimal(40),
    product: { name: 'Ibuprofeno' },
    ...over,
  });

  const tx = {
    $queryRaw: jest.fn(),
    sale: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    saleItem: { findMany: jest.fn(), update: jest.fn() },
    user: { findFirst: jest.fn() },
  };
  const mockPrisma = {
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };

  const cajero = { id: 5, role: UserRole.CASHIER };
  const gerente = { id: 2, role: 'MANAGER', isActive: true, password: 'hash' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SaleDiscountsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SettingsService, useValue: settings },
      ],
    }).compile();
    service = module.get(SaleDiscountsService);
    jest.clearAllMocks();
    settings.reset();

    tx.sale.findUnique.mockResolvedValue({
      flowStatus: 'DRAFT',
      paidAmount: new Decimal(0),
    });
    tx.sale.findUniqueOrThrow.mockResolvedValue({ paidAmount: new Decimal(0) });
    // 1ª llamada: líneas objetivo; 2ª: líneas para recalcular totales.
    tx.saleItem.findMany.mockImplementation((args: { select?: unknown }) =>
      Promise.resolve(
        args.select
          ? [
              {
                price: new Decimal(100),
                quantity: 2,
                discount: new Decimal(20),
                subtotal: new Decimal(180),
                taxAmount: new Decimal(0),
                taxRate: new Decimal(0),
              },
            ]
          : [linea()],
      ),
    );
    tx.user.findFirst.mockResolvedValue(gerente);
    compare.mockResolvedValue(true);
  });

  const escrituraDeLinea = () =>
    (
      tx.saleItem.update.mock.calls as [{ data: Record<string, unknown> }][]
    ).map((c) => c[0].data);

  it('gerente dentro de su tope: aplica sin autorización y registra quién', async () => {
    const res = await service.applyToItem(
      10,
      1,
      { percent: 10, reason: 'Cliente frecuente' },
      { id: 2, role: UserRole.MANAGER },
    );

    const [auditoria, importes] = escrituraDeLinea();
    expect(auditoria).toMatchObject({
      discountPercent: 10,
      discountReason: 'Cliente frecuente',
      discountAppliedById: 2,
      discountAuthorizedById: null,
    });
    expect((importes.subtotal as Decimal).toFixed(2)).toBe('180.00');
    expect(res.totals.discountTotal.toFixed(2)).toBe('20.00');
  });

  it('cajero con tope 0 y sin autorización: 403 con el tope en el mensaje', async () => {
    await expect(
      service.applyToItem(10, 1, { percent: 10, reason: 'x' }, cajero),
    ).rejects.toThrow('Tu tope de descuento es 0%');
    expect(tx.saleItem.update).not.toHaveBeenCalled();
  });

  it('cajero + credenciales de gerente válidas: aplica y registra al autorizador', async () => {
    await service.applyToItem(
      10,
      1,
      {
        percent: 10,
        reason: 'Promoción',
        authorizer: { login: 'gerente', password: 'secreta' },
      },
      cajero,
    );
    expect(tx.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ userName: 'gerente' }, { email: 'gerente' }] },
      }),
    );
    expect(escrituraDeLinea()[0]).toMatchObject({
      discountAppliedById: 5,
      discountAuthorizedById: 2,
    });
  });

  it('contraseña incorrecta: 403 genérico y nada escrito', async () => {
    compare.mockResolvedValue(false);
    const err = await service
      .applyToItem(
        10,
        1,
        {
          percent: 10,
          reason: 'x',
          authorizer: { login: 'gerente', password: 'mal' },
        },
        cajero,
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as Error).message).toBe(
      'Autorización rechazada: usuario o contraseña incorrectos.',
    );
    expect(tx.saleItem.update).not.toHaveBeenCalled();
  });

  it('usuario inexistente: MISMO mensaje y también compara (contra el señuelo)', async () => {
    tx.user.findFirst.mockResolvedValue(null);
    await expect(
      service.applyToItem(
        10,
        1,
        {
          percent: 10,
          reason: 'x',
          authorizer: { login: 'nadie', password: 'x' },
        },
        cajero,
      ),
    ).rejects.toThrow(
      'Autorización rechazada: usuario o contraseña incorrectos.',
    );
    expect(compare).toHaveBeenCalledWith('x', '$2b$12$senuelo');
  });

  it('autorizador inactivo: mismo 403', async () => {
    tx.user.findFirst.mockResolvedValue({ ...gerente, isActive: false });
    await expect(
      service.applyToItem(
        10,
        1,
        {
          percent: 10,
          reason: 'x',
          authorizer: { login: 'gerente', password: 'x' },
        },
        cajero,
      ),
    ).rejects.toThrow('Autorización rechazada');
  });

  it('un cajero NO puede autorizar a otro cajero', async () => {
    tx.user.findFirst.mockResolvedValue({ ...gerente, id: 8, role: 'CASHIER' });
    await expect(
      service.applyToItem(
        10,
        1,
        {
          percent: 10,
          reason: 'x',
          authorizer: { login: 'otro', password: 'x' },
        },
        cajero,
      ),
    ).rejects.toThrow('no puede aprobar 10%');
  });

  it('el gerente no autoriza por encima de SU propio tope (20 %)', async () => {
    await expect(
      service.applyToItem(
        10,
        1,
        {
          percent: 25,
          reason: 'x',
          authorizer: { login: 'gerente', password: 'x' },
        },
        cajero,
      ),
    ).rejects.toThrow('su tope es 20%');
  });

  it('nadie se autoriza a sí mismo', async () => {
    tx.user.findFirst.mockResolvedValue({ ...gerente, id: 5 });
    await expect(
      service.applyToItem(
        10,
        1,
        {
          percent: 10,
          reason: 'x',
          authorizer: { login: 'yo', password: 'x' },
        },
        cajero,
      ),
    ).rejects.toThrow('otra persona');
  });

  it('motivo obligatorio (fábrica)', async () => {
    await expect(
      service.applyToItem(
        10,
        1,
        { percent: 5 },
        { id: 2, role: UserRole.MANAGER },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('bajo costo: se rechaza antes de escribir (fábrica)', async () => {
    // 2 × $100 con 70 % = $60 < costo 2 × $40 = $80 · el admin (tope 50) tampoco podría,
    // así que se sube el máximo para aislar la regla de costo.
    settings.set('discounts', { maxPercent: 100 });
    await expect(
      service.applyToItem(
        10,
        1,
        { percent: 70, reason: 'x' },
        { id: 1, role: UserRole.ADMIN },
      ),
    ).rejects.toThrow('por debajo de su costo');
    expect(tx.saleItem.update).not.toHaveBeenCalled();
  });

  it('bajo costo permitido por configuración: aplica', async () => {
    settings.set('discounts', { maxPercent: 100, allowBelowCost: true });
    await service.applyToItem(
      10,
      1,
      { percent: 70, reason: 'Liquidación' },
      { id: 1, role: UserRole.ADMIN },
    );
    expect(tx.saleItem.update).toHaveBeenCalled();
  });

  it('con un pago registrado el descuento queda congelado: 409', async () => {
    tx.sale.findUnique.mockResolvedValue({
      flowStatus: 'DRAFT',
      paidAmount: new Decimal(50),
    });
    await expect(
      service.applyToItem(
        10,
        1,
        { percent: 5, reason: 'x' },
        { id: 2, role: UserRole.MANAGER },
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('venta ya cerrada: 400', async () => {
    tx.sale.findUnique.mockResolvedValue({
      flowStatus: 'COMPLETED',
      paidAmount: new Decimal(0),
    });
    await expect(
      service.applyToItem(
        10,
        1,
        { percent: 5, reason: 'x' },
        { id: 2, role: UserRole.MANAGER },
      ),
    ).rejects.toThrow('ya no es editable');
  });

  it('quitar el descuento (0 %) lo puede hacer un cajero y limpia la auditoría de la línea', async () => {
    tx.saleItem.findMany.mockImplementation((args: { select?: unknown }) =>
      Promise.resolve(
        args.select ? [] : [linea({ discountPercent: new Decimal(15) })],
      ),
    );
    await service.applyToItem(10, 1, { percent: 0 }, cajero);
    expect(escrituraDeLinea()[0]).toEqual({
      discountPercent: 0,
      discountReason: null,
      discountAppliedById: null,
      discountAuthorizedById: null,
    });
  });

  it('descuento a toda la venta: mismo % en cada línea, bloqueando la venta primero', async () => {
    tx.saleItem.findMany.mockImplementation((args: { select?: unknown }) =>
      Promise.resolve(
        args.select
          ? []
          : [
              linea({ id: 1 }),
              linea({ id: 2, product: { name: 'Paracetamol' } }),
            ],
      ),
    );
    await service.applyToSale(
      10,
      { percent: 10, reason: 'Convenio' },
      { id: 2, role: UserRole.MANAGER },
    );
    expect(tx.$queryRaw).toHaveBeenCalled();
    const auditorias = escrituraDeLinea().filter((d) => 'discountPercent' in d);
    expect(auditorias).toHaveLength(2);
  });
});
