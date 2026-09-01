import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';

type ErrorBody = {
  success: boolean;
  error: { requestId: string };
};

describe('AllExceptionsFilter — trazabilidad', () => {
  it('pone requestId en el JSON y en x-request-id para cruzar con el log', () => {
    const filter = new AllExceptionsFilter();
    const headers: Record<string, string> = {};
    const json = jest.fn();
    const response = {
      headersSent: false,
      setHeader: (key: string, value: string) => {
        headers[key] = value;
      },
      status: jest.fn().mockReturnValue({ json }),
    };
    const request = {
      id: 'caja-norte-7',
      header: () => undefined,
      method: 'GET',
      url: '/api/sales',
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;

    filter.catch(
      new HttpException('boom', HttpStatus.INTERNAL_SERVER_ERROR),
      host,
    );

    const calls = json.mock.calls as unknown as Array<[ErrorBody]>;
    const payload = calls[0][0];
    expect(headers['x-request-id']).toBe('caja-norte-7');
    expect(payload.error.requestId).toBe('caja-norte-7');
    expect(payload.success).toBe(false);
  });
});
