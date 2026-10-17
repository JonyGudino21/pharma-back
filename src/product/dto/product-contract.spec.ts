import { BadRequestException } from '@nestjs/common';
import { crearValidationPipe } from '../../common/pipes/validation.pipe';
import { CreateProductDto } from './create-product.dto';
import { UpdateProductDto } from './update-product.dto';

/**
 * CONTRATO front ↔ back del alta y la edición de producto, con el
 * ValidationPipe REAL de la app (whitelist + forbidNonWhitelisted).
 *
 * El alta respondía 400 «property isActive should not exist» con el cliente
 * enfrente: el formulario mandaba `isActive` y CreateProductDto no lo
 * declaraba. Ninguna prueba lo vio porque las pruebas creaban productos por
 * código, nunca con el cuerpo que manda la pantalla. Estos cuerpos son copia
 * de los que arma `buildProductPayload` (pharma-front/app/utils/product-payload.ts).
 */
describe('Contrato de producto (ValidationPipe real)', () => {
  const pipe = crearValidationPipe();

  const validar = <T>(metatype: new () => T, body: object) =>
    pipe.transform(body, { type: 'body', metatype }) as Promise<T>;

  /** Lo que manda el formulario al CREAR (todos los campos posibles). */
  const altaDesdePantalla = {
    name: 'Paracetamol',
    strength: '500 mg',
    format: 'Tabletas',
    presentation: 'Caja con 20',
    description: 'Analgésico',
    barcode: '7501234567890',
    controlled: false,
    minStock: 5,
    price: 45.5,
    cost: 20,
    taxCategory: 'ZERO',
    categories: [1, 2],
    stock: 10,
    lotNumber: 'L-2026-01',
    expiryDate: '2027-12-31',
  };

  it('acepta el alta tal como la manda la pantalla', async () => {
    const dto = await validar(CreateProductDto, altaDesdePantalla);
    expect(dto.name).toBe('Paracetamol');
    expect(dto.isActive).toBeUndefined(); // el servicio lo deja en true
  });

  it('acepta el alta de una caja con la versión ANTERIOR del front (manda isActive)', async () => {
    const dto = await validar(CreateProductDto, {
      ...altaDesdePantalla,
      isActive: true,
    });
    expect(dto.isActive).toBe(true);
  });

  it('acepta el alta mínima (sin opcionales, como un producto sin existencia)', async () => {
    await expect(
      validar(CreateProductDto, {
        name: 'Gasas',
        strength: '',
        format: '',
        presentation: '',
        controlled: false,
        minStock: 0,
        price: 10,
        cost: 5,
        categories: [],
        stock: 0,
      }),
    ).resolves.toBeDefined();
  });

  it('acepta la edición tal como la manda la pantalla (con isActive)', async () => {
    const dto = await validar(UpdateProductDto, {
      name: 'Paracetamol',
      strength: '500 mg',
      format: 'Tabletas',
      presentation: 'Caja con 20',
      controlled: false,
      minStock: 5,
      price: 46,
      cost: 20,
      categories: [1],
      isActive: false,
    });
    expect(dto.isActive).toBe(false);
  });

  it('la edición sigue rechazando stock y lote (sólo se mueven por inventario)', async () => {
    await expect(
      validar(UpdateProductDto, { name: 'X', stock: 99 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      validar(UpdateProductDto, { name: 'X', lotNumber: 'L1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('un campo desconocido da un mensaje en español con el campo y el código', async () => {
    let error: unknown;
    try {
      await validar(CreateProductDto, {
        ...altaDesdePantalla,
        colorDeCaja: 'rojo',
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    const cuerpo = (error as BadRequestException).getResponse() as {
      message: string;
      codigo: string;
      campos: Array<{ campo: string; regla: string }>;
    };
    expect(cuerpo.codigo).toBe('CAMPOS_NO_RECONOCIDOS');
    expect(cuerpo.message).toContain('«colorDeCaja»');
    expect(cuerpo.message).toContain('Recarga la página');
    expect(cuerpo.message).not.toContain('should not exist');
    expect(cuerpo.campos).toContainEqual(
      expect.objectContaining({ campo: 'colorDeCaja', regla: 'no_permitido' }),
    );
  });

  it('las demás fallas conservan su mensaje (validaciones del DTO)', async () => {
    let error: unknown;
    try {
      await validar(CreateProductDto, {
        ...altaDesdePantalla,
        expiryDate: '31/12/2027',
      });
    } catch (e) {
      error = e;
    }
    const cuerpo = (error as BadRequestException).getResponse() as {
      message: string;
      codigo?: string;
    };
    expect(cuerpo.codigo).toBeUndefined();
    expect(cuerpo.message).toContain('YYYY-MM-DD');
  });
});
