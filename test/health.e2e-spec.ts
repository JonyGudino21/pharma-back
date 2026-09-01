/**
 * CONTRATO DE OBSERVABILIDAD (P1-4) — arranca la app HTTP real.
 *
 * Las sondas viven FUERA de /api y SIN JWT: un orquestador que reciba 401
 * marca el pod como muerto. live no toca la BD; ready sí.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'ci_throwaway_secret_used_only_inside_the_runner';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ||
  'ci_throwaway_refresh_secret_used_only_inside_the_runner';
process.env.PORT = process.env.PORT || '3005';

import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Server } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureHttp } from '../src/configure-http';

jest.setTimeout(60_000);

type HealthLiveBody = { status: string; service: string };
type HealthReadyBody = {
  status: string;
  info: { database: { status: string } };
};
type ErrorBody = { error: { requestId: string } };

describe('Health y trazabilidad HTTP (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, {
      bufferLogs: true,
      logger: false,
    });
    configureHttp(app, app.get(ConfigService));
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live no exige auth y no consulta la base', async () => {
    const res = await request(server).get('/health/live').expect(200);
    const body = res.body as HealthLiveBody;
    expect(body.status).toBe('ok');
    expect(body.service).toBe('pharma-back');
  });

  it('GET /health/ready confirma Postgres', async () => {
    const res = await request(server).get('/health/ready').expect(200);
    const body = res.body as HealthReadyBody;
    expect(body.status).toBe('ok');
    expect(body.info.database.status).toBe('up');
  });

  it('GET /health es el alias de ready que usan los balanceadores', async () => {
    const res = await request(server).get('/health').expect(200);
    const body = res.body as HealthReadyBody;
    expect(body.status).toBe('ok');
  });

  it('las sondas no viven bajo /api', async () => {
    await request(server).get('/api/health/live').expect(404);
  });

  it('devuelve el mismo x-request-id que envió el cliente', async () => {
    const res = await request(server)
      .get('/health/live')
      .set('x-request-id', 'caja-norte-7')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('caja-norte-7');
  });

  it('genera un request id si el cliente no manda uno', async () => {
    const res = await request(server).get('/health/live').expect(200);
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('un 401 incluye requestId para que soporte pueda cruzar el log', async () => {
    const res = await request(server)
      .get('/api/sales')
      .set('x-request-id', 'cobro-fallido-1')
      .expect(401);
    expect(res.headers['x-request-id']).toBe('cobro-fallido-1');
    const body = res.body as ErrorBody;
    expect(body.error.requestId).toBe('cobro-fallido-1');
  });
});
