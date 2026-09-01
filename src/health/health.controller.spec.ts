import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { HealthController } from './health.controller';

describe('HealthController — live no depende de la base', () => {
  const prisma = {
    $queryRawUnsafe: jest.fn(),
  };
  const controller = new HealthController(prisma as unknown as PrismaService);

  beforeEach(() => {
    prisma.$queryRawUnsafe.mockReset();
  });

  it('live responde ok sin consultar Postgres', () => {
    const result = controller.live();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('pharma-back');
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('ready confirma la BD con SELECT 1', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([{ '?column?': 1 }]);

    await expect(controller.ready()).resolves.toEqual({
      status: 'ok',
      info: { database: { status: 'up' } },
    });
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith('SELECT 1');
  });

  it('ready responde 503 si Postgres no contesta', async () => {
    prisma.$queryRawUnsafe.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
