import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SalePriceSource, UserRole } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from 'src/settings/settings.service';
import type { PricingSettings } from 'src/settings/definitions';
import { SalePricesService, puedeCambiarPrecio } from './sale-prices.service';
import { argDe } from '../common/testing/mock-inspect.util';

/**
 * CAMBIO DE PRECIO EN CAJA (ADR-0025): quién puede, cuándo no se puede, el
 * costo como límite y el precio especial del cliente.
 */
describe('SalePricesService', () => {
  let service: SalePricesService;

  const cfgBase: PricingSettings = {
    enabled: true,
    cashierCanEdit: false,
    pharmacistCanEdit: true,
    requireReason: false,
    saveForClientByDefault: true,
    allowBelowCost: false,
  };
  let cfg: PricingSettings;

  const tx = {
    $queryRaw: jest.fn(),
    sale: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    saleItem: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    clientProductPrice: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    clientProductPriceHistory: { updateMany: jest.fn(), create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };

  /** Línea: lista $12, costo $9, sin descuento, 2 piezas. */
  const linea = {
    id: 50,
    saleId: 1,
    productId: 100,
    quantity: 2,
    price: new Decimal(12),
    listPrice: new Decimal(12),
    discountPercent: new Decimal(0),
    taxRate: new Decimal(0),
    costAtSale: new Decimal(9),
    product: { name: 'Paracetamol', price: new Decimal(12) },
  };

  const gerente = { id: 3, role: UserRole.MANAGER };
  const conCliente = {
    flowStatus: 'DRAFT',
    paidAmount: new Decimal(0),
    clientId: 7,
    client: { name: 'Farmacia A' },
  };

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        SalePricesService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettingsService, useValue: { get: jest.fn(() => cfg) } },
      ],
    }).compile();
    service = mod.get(SalePricesService);
    jest.clearAllMocks();
    cfg = { ...cfgBase };
    tx.sale.findUnique.mockResolvedValue(conCliente);
    tx.saleItem.findFirst.mockResolvedValue(linea);
    tx.saleItem.findMany.mockResolvedValue([
      {
        ...linea,
        price: new Decimal(10),
        discount: new Decimal(0),
        subtotal: new Decimal(20),
        taxAmount: new Decimal(0),
      },
    ]);
    tx.sale.findUniqueOrThrow.mockResolvedValue({ paidAmount: new Decimal(0) });
    tx.clientProductPrice.findUnique.mockResolvedValue(null);
  });

  describe('quién puede', () => {
    it.each([
      [UserRole.ADMIN, true],
      [UserRole.MANAGER, true],
      [UserRole.PHARMACIST, true],
      [UserRole.CASHIER, false],
    ])('%s con la configuración de fábrica → %s', (rol, puede) => {
      expect(puedeCambiarPrecio(rol, cfgBase)).toBe(puede);
    });

    it('apagado: nadie, ni gerencia', () => {
      expect(
        puedeCambiarPrecio(UserRole.ADMIN, { ...cfgBase, enabled: false }),
      ).toBe(false);
    });

    it('un cajero sin permiso recibe 403 y no se toca la venta', async () => {
      await expect(
        service.setItemPrice(
          1,
          50,
          { price: 10 },
          { id: 9, role: UserRole.CASHIER },
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('motivo obligatorio si así se configuró', async () => {
      cfg.requireReason = true;
      await expect(
        service.setItemPrice(1, 50, { price: 10 }, gerente),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cuándo no se puede', () => {
    it('con un pago ya registrado: 409', async () => {
      tx.sale.findUnique.mockResolvedValue({
        ...conCliente,
        paidAmount: new Decimal(5),
      });
      await expect(
        service.setItemPrice(1, 50, { price: 10 }, gerente),
      ).rejects.toThrow(ConflictException);
      expect(tx.saleItem.update).not.toHaveBeenCalled();
    });

    it('venta ya cerrada: 400', async () => {
      tx.sale.findUnique.mockResolvedValue({
        ...conCliente,
        flowStatus: 'COMPLETED',
      });
      await expect(
        service.setItemPrice(1, 50, { price: 10 }, gerente),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('costo', () => {
    it('debajo del costo se rechaza (fábrica) con el costo en el mensaje', async () => {
      await expect(
        service.setItemPrice(1, 50, { price: 8.5 }, gerente),
      ).rejects.toThrow(/por debajo de su costo/);
      expect(tx.saleItem.update).not.toHaveBeenCalled();
    });

    it('debajo del costo se acepta si se permite, y se informa', async () => {
      cfg.allowBelowCost = true;
      const r = await service.setItemPrice(1, 50, { price: 8.5 }, gerente);
      expect(r.margin).toBe('BAJO_COSTO');
    });

    it('igual al costo se acepta con aviso SIN_GANANCIA', async () => {
      const r = await service.setItemPrice(1, 50, { price: 9 }, gerente);
      expect(r.margin).toBe('SIN_GANANCIA');
    });
  });

  describe('precio especial del cliente', () => {
    it('con "guardar para el cliente": lo guarda con la venta y el motivo', async () => {
      const r = await service.setItemPrice(
        1,
        50,
        { price: 10, saveForClient: true, reason: 'Viáticos' },
        gerente,
      );

      expect(r.priceSource).toBe(SalePriceSource.CLIENT);
      expect(r.clientPrice?.saved).toBe(true);
      expect(argDe(tx.clientProductPriceHistory.create)).toMatchObject({
        data: { clientId: 7, productId: 100, saleId: 1, reason: 'Viáticos' },
      });
      expect(argDe(tx.saleItem.update)).toMatchObject({
        data: {
          priceSource: SalePriceSource.CLIENT,
          priceChangedById: 3,
          priceReason: 'Viáticos',
        },
      });
    });

    it('sin la casilla: sólo esta venta (MANUAL) y el cliente no cambia', async () => {
      const r = await service.setItemPrice(1, 50, { price: 10 }, gerente);
      expect(r.priceSource).toBe(SalePriceSource.MANUAL);
      expect(r.clientPrice).toBeNull();
      expect(tx.clientProductPrice.upsert).not.toHaveBeenCalled();
    });

    it('igual al precio de lista con la casilla: QUITA el especial (sigue la lista)', async () => {
      tx.clientProductPrice.findUnique.mockResolvedValue({
        price: new Decimal(10),
        isActive: true,
      });
      const r = await service.setItemPrice(
        1,
        50,
        { price: 12, saveForClient: true },
        gerente,
      );
      expect(r.priceSource).toBe(SalePriceSource.LIST);
      expect(argDe(tx.clientProductPrice.update)).toMatchObject({
        data: { isActive: false },
      });
    });

    it('Público General: la casilla se ignora', async () => {
      tx.sale.findUnique.mockResolvedValue({
        ...conCliente,
        clientId: null,
        client: null,
      });
      const r = await service.setItemPrice(
        1,
        50,
        { price: 10, saveForClient: true },
        gerente,
      );
      expect(r.priceSource).toBe(SalePriceSource.MANUAL);
      expect(r.clientPrice).toBeNull();
    });
  });
});
