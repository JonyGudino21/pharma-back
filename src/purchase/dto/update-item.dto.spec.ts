import { crearValidationPipe } from '../../common/pipes/validation.pipe';
import { UpdatePurchaseItemDto } from './update-item.dto';

/**
 * Editar una partida: `null` en lote y caducidad significa "borrar". Debe
 * pasar la validación global intacto (no rechazarse ni convertirse en otra cosa).
 */
describe('UpdatePurchaseItemDto con el ValidationPipe de la app', () => {
  // El MISMO pipe que usa la app (configure-http.ts).
  const pipe = crearValidationPipe();

  const validar = (body: Record<string, unknown>) =>
    pipe.transform(body, {
      type: 'body',
      metatype: UpdatePurchaseItemDto,
    }) as Promise<UpdatePurchaseItemDto>;

  it('acepta null para borrar lote y caducidad', async () => {
    const dto = await validar({
      quantity: 2,
      cost: 10,
      lotNumber: null,
      expiryDate: null,
    });

    expect(dto.lotNumber).toBeNull();
    expect(dto.expiryDate).toBeNull();
  });

  it('sin los campos quedan ausentes (se conserva el lote)', async () => {
    const dto = await validar({ quantity: 2, cost: 10 });

    // La clase declara los campos, así que existen con valor `undefined`; el
    // servicio distingue "ausente" con `!== undefined`, no con `in`.
    expect(dto.lotNumber).toBeUndefined();
    expect(dto.expiryDate).toBeUndefined();
  });

  it('sigue validando el formato de la caducidad', async () => {
    await expect(
      validar({
        quantity: 2,
        cost: 10,
        lotNumber: 'A1',
        expiryDate: '31/01/2027',
      }),
    ).rejects.toThrow();
  });
});
