import {
  Controller,
  Get,
  Header,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';
import { withTimeout } from './with-timeout';

const DATABASE_PING_MS = 1500;

/**
 * Sondas de orquestación. Van SIN JWT y SIN rate limit: un probe que reciba
 * 401 o 429 tumba el pod o saca la instancia del balanceador.
 *
 * live  = el proceso responde. No toca Postgres: si la BD está lenta, Kubernetes
 *         no debe matar el proceso en bucle (eso empeora la caída).
 * ready = la BD responde. Si falla, el balanceador deja de mandar tráfico.
 *
 * No usamos @nestjs/terminus: v12 es ESM puro (rompe Jest) y arrastra indicadores
 * que no usamos. El contrato HTTP es el mismo: 200 vs 503.
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  live() {
    return {
      status: 'ok',
      service: 'pharma-back',
      ts: new Date().toISOString(),
    };
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready() {
    try {
      await withTimeout(
        this.prisma.$queryRawUnsafe('SELECT 1'),
        DATABASE_PING_MS,
        'database ping',
      );
      return {
        status: 'ok',
        info: { database: { status: 'up' } },
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        error: { database: { status: 'down' } },
      });
    }
  }

  /** Alias para balanceadores que solo pegan a /health. Equivale a ready. */
  @Get()
  @Header('Cache-Control', 'no-store')
  check() {
    return this.ready();
  }
}
