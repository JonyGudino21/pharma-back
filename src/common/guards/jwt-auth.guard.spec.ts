import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * El guard se aplica GLOBALMENTE. Estas pruebas fijan la propiedad que sostiene
 * el modelo de seguridad de toda la API:
 *
 *   **protegido por defecto, público sólo si se pide a mano.**
 *
 * Antes el valor por defecto estaba invertido: un controlador nuevo sin
 * `@UseGuards(JwtAuthGuard)` quedaba público sin fallar ni avisar.
 */
describe('JwtAuthGuard — protegido por defecto', () => {
  /** Contexto mínimo: al guard sólo le importan el handler y la clase. */
  // Referencias ESTABLES: si getHandler() devolviera una función nueva en cada
  // llamada, no habría forma de comprobar con qué se consultó el reflector.
  const handler = () => undefined;
  class ControladorDePrueba {}

  const contexto = (): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => ControladorDePrueba,
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
        getResponse: () => ({}),
      }),
      getType: () => 'http',
    }) as unknown as ExecutionContext;

  /** Reflector que responde lo que la prueba decida para IS_PUBLIC_KEY. */
  const reflectorQueDice = (valor: boolean | undefined) =>
    ({
      getAllAndOverride: jest.fn().mockReturnValue(valor),
    }) as unknown as Reflector;

  /**
   * `canActivate` de passport, el que invoca `super.canActivate`.
   *
   * Se sustituye en las rutas protegidas. La primera versión de esta prueba lo
   * dejaba correr contra un request falso: sin la estrategia `jwt` registrada,
   * passport lanza "Unknown authentication strategy" DENTRO de un callback
   * asíncrono, fuera del alcance de cualquier try/catch, y el error tumbaba el
   * proceso de jest entero — ninguna suite posterior llegaba a ejecutarse.
   *
   * Lo que esta prueba necesita saber es sólo si el guard concede el paso por
   * su cuenta o delega. Eso se comprueba con el doble, sin tocar passport.
   */
  const padre = Object.getPrototypeOf(JwtAuthGuard.prototype) as {
    canActivate: (ctx: ExecutionContext) => unknown;
  };

  let delegado: jest.SpyInstance;

  beforeEach(() => {
    delegado = jest.spyOn(padre, 'canActivate').mockReturnValue(false);
  });

  afterEach(() => {
    delegado.mockRestore();
  });

  const intentar = (guard: JwtAuthGuard): unknown =>
    guard.canActivate(contexto());

  it('deja pasar sin token una ruta marcada @Public()', () => {
    const guard = new JwtAuthGuard(reflectorQueDice(true));
    expect(guard.canActivate(contexto())).toBe(true);
    // Y NO llega a passport: una ruta pública no debe intentar autenticar.
    expect(delegado).not.toHaveBeenCalled();
  });

  it('NO concede el paso a una ruta sin marcar: delega en passport', () => {
    // El caso que justifica todo el cambio. Si esta prueba empezara a devolver
    // `true`, la API entera habría quedado abierta.
    const guard = new JwtAuthGuard(reflectorQueDice(undefined));
    expect(intentar(guard)).not.toBe(true);
    expect(delegado).toHaveBeenCalledTimes(1);
  });

  it('un `false` explícito tampoco abre la puerta', () => {
    // `@Public()` siempre marca `true`. Un `false` sólo puede venir de metadata
    // mal puesta, y ante la duda la respuesta es proteger.
    const guard = new JwtAuthGuard(reflectorQueDice(false));
    expect(intentar(guard)).not.toBe(true);
  });

  it('consulta el método ANTES que la clase', () => {
    // getAllAndOverride con [handler, class]: así un controlador público puede
    // tener un método protegido y al revés, sin sorpresas de precedencia.
    // El doble se guarda aparte para no referenciar un método sin su `this`
    // (@typescript-eslint/unbound-method).
    const getAllAndOverride = jest.fn().mockReturnValue(true);
    const guard = new JwtAuthGuard({
      getAllAndOverride,
    } as unknown as Reflector);
    const ctx = contexto();

    void guard.canActivate(ctx);

    expect(getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
  });
});
