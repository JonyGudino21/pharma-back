import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from 'src/settings/settings.service';
import { ClientPricesService } from './client-prices.service';
import { argDe } from '../common/testing/mock-inspect.util';

/**
 * Precios especiales desde la ficha del cliente (ADR-0025): mismas reglas que
 * en caja (costo como límite; igual a lista = sin precio especial).
 */
describe('ClientPricesService', () => {
  let service: ClientPricesService;
  const cfg = { allowBelowCost: false };

  const tx = {
    clientProductPrice: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    clientProductPriceHistory: { updateMany: jest.fn(), create: jest.fn() },
  };
  const prisma = {
    client: { findUnique: jest.fn() },
    product: { findUnique: jest.fn() },
    clientProductPrice: { findMany: jest.fn() },
    clientProductPriceHistory: { findMany: jest.fn() },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        ClientPricesService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettingsService, useValue: { get: jest.fn(() => cfg) } },
      ],
    }).compile();
    service = mod.get(ClientPricesService);
    jest.clearAllMocks();
    cfg.allowBelowCost = false;
    prisma.client.findUnique.mockResolvedValue({
      id: 7,
      name: 'Farmacia A',
      isActive: true,
    });
    prisma.product.findUnique.mockResolvedValue({
      id: 100,
      name: 'Paracetamol',
      price: new Decimal(12),
      cost: new Decimal(9),
      isActive: true,
    });
    tx.clientProductPrice.findUnique.mockResolvedValue(null);
  });

  it('guarda un precio especial con su motivo', async () => {
    const r = await service.set(7, 100, { price: 10, reason: 'Viáticos' }, 3);
    expect(r.saved).toBe(true);
    expect(argDe(tx.clientProductPriceHistory.create)).toMatchObject({
      data: { clientId: 7, productId: 100, changedById: 3, reason: 'Viáticos' },
    });
  });

  it('debajo del costo se rechaza si no se permite', async () => {
    await expect(service.set(7, 100, { price: 8 }, 3)).rejects.toThrow(
      BadRequestException,
    );
    expect(tx.clientProductPrice.upsert).not.toHaveBeenCalled();
  });

  it('igual al costo se acepta y avisa SIN_GANANCIA', async () => {
    const r = await service.set(7, 100, { price: 9 }, 3);
    expect(r.margin).toBe('SIN_GANANCIA');
  });

  it('igual al precio de lista: no guarda especial (el cliente sigue la lista)', async () => {
    tx.clientProductPrice.findUnique.mockResolvedValue({
      price: new Decimal(10),
      isActive: true,
    });
    const r = await service.set(7, 100, { price: 12 }, 3);
    expect(r.current).toBeNull();
    expect(argDe(tx.clientProductPrice.update)).toMatchObject({
      data: { isActive: false },
    });
  });

  it('cliente inactivo: no se le capturan precios', async () => {
    prisma.client.findUnique.mockResolvedValue({
      id: 7,
      name: 'X',
      isActive: false,
    });
    await expect(service.set(7, 100, { price: 10 }, 3)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('quitar uno que no existe: 404 claro', async () => {
    await expect(service.remove(7, 100, {}, 3)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('lista con precio de lista, diferencia y margen', async () => {
    prisma.clientProductPrice.findMany.mockResolvedValue([
      {
        productId: 100,
        price: new Decimal(10),
        updatedAt: new Date('2026-10-20T10:00:00Z'),
        product: {
          id: 100,
          name: 'Paracetamol',
          sku: 'P',
          strength: null,
          presentation: null,
          price: new Decimal(12),
          cost: new Decimal(9),
          isActive: true,
        },
      },
    ]);
    prisma.clientProductPriceHistory.findMany.mockResolvedValue([]);

    const [fila] = await service.list(7);
    expect(fila.difference.toNumber()).toBe(-2);
    expect(fila.margin).toBe('OK');
  });
});
