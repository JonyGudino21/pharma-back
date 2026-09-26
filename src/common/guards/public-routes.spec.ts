import 'reflect-metadata';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppController } from '../../app.controller';
import { AuthController } from '../../auth/auth.controller';
import { HealthController } from '../../health/health.controller';
import { SalesController } from '../../sales/sales.controller';
import { PurchaseController } from '../../purchase/purchase.controller';
import { ClientController } from '../../client/client.controller';
import { ProductController } from '../../product/product.controller';
import { SuppliersController } from '../../suppliers/suppliers.controller';
import { CategoryController } from '../../category/category.controller';
import { UserController } from '../../user/user.controller';
import { InventoryController } from '../../inventory/inventory.controller';
import { CashShiftController } from '../../cash-shift/cash-shift.controller';
import { CompanyController } from '../../company/company.controller';
import { AnalyticsController } from '../../analytics/analytics.controller';

/**
 * INVENTARIO DE RUTAS PÚBLICAS.
 *
 * ─── QUÉ PROTEGE ───
 * Con el guard aplicado globalmente, lo público es lo que alguien marca a mano
 * con `@Public()`. Eso invierte el riesgo respecto a antes —ya no se publica
 * nada por olvido— pero abre uno nuevo: que alguien añada `@Public()` "para que
 * funcione mientras pruebo" y ese decorador se quede ahí para siempre.
 *
 * Esta prueba fija la lista EXACTA de rutas anónimas. Añadir o quitar una
 * rompe la suite y obliga a actualizar esta lista en el mismo commit, donde se
 * ve en la revisión. Es la diferencia entre una decisión y un descuido.
 *
 * ─── SI ESTA PRUEBA FALLA ───
 * No la "arregles" añadiendo el nombre a la lista sin más. Pregúntate primero:
 * ¿esta ruta debe responder a alguien que NO ha iniciado sesión? Si la respuesta
 * no es un sí rotundo, quita el `@Public()`.
 */

/** Rutas que deben ser anónimas, con el motivo por el que lo son. */
const PUBLICAS_ESPERADAS: Record<string, string> = {
  'AppController.getHello':
    'raíz de la API: confirma que el servicio responde, sin datos de negocio',
  'AuthController.login': 'no se puede exigir sesión para iniciar sesión',
  'AuthController.refresh': 'se llama justo cuando el access token caducó',
  'AuthController.logout':
    'cerrar sesión con el token ya caducado debe funcionar',
  'HealthController.*':
    'las sondas de orquestación no llevan credenciales; un 401 tumbaría el pod',
};

/** Todos los controladores de la API. */
const CONTROLADORES = [
  AppController,
  AuthController,
  HealthController,
  SalesController,
  PurchaseController,
  ClientController,
  ProductController,
  SuppliersController,
  CategoryController,
  UserController,
  InventoryController,
  CashShiftController,
  CompanyController,
  AnalyticsController,
];

type Constructor = new (...args: never[]) => object;

/** Métodos propios del controlador (excluye el constructor y lo heredado). */
const metodosDe = (controlador: Constructor): string[] =>
  Object.getOwnPropertyNames(controlador.prototype).filter(
    (nombre) => nombre !== 'constructor',
  );

/** Rutas marcadas `@Public()`, ya sea en la clase entera o método a método. */
const publicasDe = (controlador: Constructor): string[] => {
  const nombre = controlador.name;

  // Marcada a nivel de CLASE: todos sus métodos quedan públicos de golpe.
  if (Reflect.getMetadata(IS_PUBLIC_KEY, controlador) === true) {
    return [`${nombre}.*`];
  }

  return metodosDe(controlador)
    .filter((metodo) => {
      const handler = (controlador.prototype as Record<string, unknown>)[
        metodo
      ];
      return Reflect.getMetadata(IS_PUBLIC_KEY, handler as object) === true;
    })
    .map((metodo) => `${nombre}.${metodo}`);
};

describe('Inventario de rutas públicas', () => {
  const publicasReales = CONTROLADORES.flatMap(publicasDe).sort();
  const esperadas = Object.keys(PUBLICAS_ESPERADAS).sort();

  it('la lista de rutas anónimas es EXACTAMENTE la esperada', () => {
    expect(publicasReales).toEqual(esperadas);
  });

  it('cada ruta pública tiene un motivo escrito', () => {
    for (const ruta of publicasReales) {
      expect(PUBLICAS_ESPERADAS[ruta]?.length).toBeGreaterThan(20);
    }
  });

  it('ningún controlador de negocio es público', () => {
    // Los cuatro que manejan dinero, inventario y datos de pacientes NUNCA
    // deben aparecer aquí, ni siquiera con un método suelto.
    const criticos = [
      'SalesController',
      'PurchaseController',
      'ClientController',
      'InventoryController',
      'CashShiftController',
      'UserController',
      'AnalyticsController',
    ];

    for (const critico of criticos) {
      expect(publicasReales.some((r) => r.startsWith(`${critico}.`))).toBe(
        false,
      );
    }
  });
});
