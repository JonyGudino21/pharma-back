import { Decimal } from '@prisma/client/runtime/library';
import { fijarPrecioCliente } from './client-prices';
import { argDe } from '../common/testing/mock-inspect.util';

/**
 * Escritor único de precios especiales por cliente (ADR-0025): siempre con
 * historial (quién, de cuánto a cuánto, por qué y desde qué venta) y sin
 * escrituras cuando nada cambia.
 */
describe('fijarPrecioCliente', () => {
  const tx = {
    clientProductPrice: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    clientProductPriceHistory: { updateMany: jest.fn(), create: jest.fn() },
  };
  const base = { clientId: 7, productId: 100, userId: 3 };

  beforeEach(() => jest.clearAllMocks());

  it('primer precio especial: lo crea y abre historial sin precio anterior', async () => {
    tx.clientProductPrice.findUnique.mockResolvedValue(null);

    const r = await fijarPrecioCliente(tx as never, {
      ...base,
      price: new Decimal(10),
      reason: 'Viáticos',
      saleId: 55,
    });

    expect(r).toMatchObject({ anterior: null, cambio: true });
    expect(tx.clientProductPrice.upsert).toHaveBeenCalled();
    expect(argDe(tx.clientProductPriceHistory.create)).toMatchObject({
      data: {
        clientId: 7,
        productId: 100,
        changedById: 3,
        previousPrice: null,
        reason: 'Viáticos',
        saleId: 55,
      },
    });
  });

  it('cambio de precio: cierra el periodo anterior y registra de cuánto a cuánto', async () => {
    tx.clientProductPrice.findUnique.mockResolvedValue({
      price: new Decimal(12),
      isActive: true,
    });

    const r = await fijarPrecioCliente(tx as never, {
      ...base,
      price: new Decimal(10),
    });

    expect(r.cambio).toBe(true);
    expect(r.anterior?.toNumber()).toBe(12);
    expect(tx.clientProductPriceHistory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 7, productId: 100, endDate: null },
      }),
    );
    const hist = argDe<{ data: { previousPrice: Decimal; price: Decimal } }>(
      tx.clientProductPriceHistory.create,
    ).data;
    expect(hist.previousPrice.toNumber()).toBe(12);
    expect(new Decimal(hist.price).toNumber()).toBe(10);
  });

  it('mismo precio: no escribe nada', async () => {
    tx.clientProductPrice.findUnique.mockResolvedValue({
      price: new Decimal(10),
      isActive: true,
    });

    const r = await fijarPrecioCliente(tx as never, {
      ...base,
      price: new Decimal(10),
    });

    expect(r.cambio).toBe(false);
    expect(tx.clientProductPrice.upsert).not.toHaveBeenCalled();
    expect(tx.clientProductPriceHistory.create).not.toHaveBeenCalled();
  });

  it('una fila INACTIVA cuenta como "sin precio especial" y se reactiva', async () => {
    tx.clientProductPrice.findUnique.mockResolvedValue({
      price: new Decimal(10),
      isActive: false,
    });

    const r = await fijarPrecioCliente(tx as never, {
      ...base,
      price: new Decimal(10),
    });

    expect(r).toMatchObject({ anterior: null, cambio: true });
    expect(argDe(tx.clientProductPrice.upsert)).toMatchObject({
      update: { isActive: true },
    });
  });

  it('quitar: desactiva (no borra) y deja constancia en el historial', async () => {
    tx.clientProductPrice.findUnique.mockResolvedValue({
      price: new Decimal(10),
      isActive: true,
    });

    const r = await fijarPrecioCliente(tx as never, { ...base, price: null });

    expect(r).toMatchObject({ nuevo: null, cambio: true });
    expect(argDe(tx.clientProductPrice.update)).toMatchObject({
      data: { isActive: false },
    });
    const hist = argDe<{ data: { endDate: Date; reason: string } }>(
      tx.clientProductPriceHistory.create,
    ).data;
    expect(hist.endDate).toBeInstanceOf(Date);
    expect(hist.reason).toBe('Precio especial retirado');
  });

  it('quitar uno que no existe: no hace nada', async () => {
    tx.clientProductPrice.findUnique.mockResolvedValue(null);

    const r = await fijarPrecioCliente(tx as never, { ...base, price: null });

    expect(r.cambio).toBe(false);
    expect(tx.clientProductPrice.update).not.toHaveBeenCalled();
  });
});
