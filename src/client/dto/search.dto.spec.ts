import { ValidationPipe } from '@nestjs/common';
import { SearchClientDto } from './search.dto';

/**
 * El buscador de clientes (POS y directorio) manda `?page=1&limit=10&name=...`.
 * Con `pagination` declarado como objeto anidado, el pipe global respondía 400
 * ("property page should not exist") y la búsqueda nunca funcionó.
 */
describe('SearchClientDto con el ValidationPipe de la app', () => {
  // Mismas opciones que configure-http.ts.
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const validar = (query: Record<string, string>) =>
    pipe.transform(query, { type: 'query', metatype: SearchClientDto });

  it('acepta page y limit planos junto al texto', async () => {
    const dto = (await validar({
      page: '1',
      limit: '10',
      name: 'Puente',
      email: 'Puente',
      phone: 'Puente',
    })) as SearchClientDto;

    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(10);
    expect(dto.name).toBe('Puente');
  });

  it('sigue rechazando campos desconocidos', async () => {
    await expect(validar({ name: 'x', role: 'ADMIN' })).rejects.toThrow();
  });
});
