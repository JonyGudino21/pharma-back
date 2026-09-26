import * as Joi from 'joi';

/**
 * Contrato de configuración de la aplicación.
 *
 * Se valida al ARRANQUE, no en tiempo de ejecución: si falta una variable o tiene
 * un valor inválido, el proceso no levanta. Es preferible un fallo ruidoso en el
 * despliegue que descubrir a media jornada que `TOLERANCE_THRESHOLD` era `NaN` y
 * que la auditoría de caja nunca se disparó.
 *
 * Los secretos exigen 32 caracteres como mínimo: por debajo de eso un JWT es
 * viable de atacar por fuerza bruta fuera de línea.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3005),

  DATABASE_URL: Joi.string().required(),

  // Access y refresh DEBEN tener secretos distintos: con un solo secreto, un
  // refresh token robado sirve directamente como token de acceso.
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string()
    .min(32)
    .required()
    .invalid(Joi.ref('JWT_SECRET'))
    .messages({
      'any.invalid':
        'JWT_REFRESH_SECRET no puede ser igual a JWT_SECRET: anularia la separacion entre access y refresh.',
    }),

  JWT_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  JWT_REFRESH_DAYS_REMEMBER: Joi.number().integer().positive().default(7),
  JWT_REFRESH_DAYS_DEFAULT: Joi.number().integer().positive().default(1),

  // Lista blanca separada por comas. Sin comodines: CORS con "*" y credenciales
  // es una combinacion invalida que los navegadores rechazan.
  FRONTEND_URL: Joi.string().required(),

  // ── Cookies de sesión (Fase 4) ────────────────────────────────────────────
  // Los tokens viajan en cookies httpOnly: JavaScript ya no puede leerlos, así
  // que un XSS no puede exfiltrar la sesión.
  //
  // COOKIE_SECURE obliga a HTTPS. En desarrollo va en 'false' porque la terminal
  // corre sobre http://localhost y el navegador DESCARTA una cookie `secure`
  // servida por http: la sesión simplemente no funcionaría, con un síntoma
  // (401 en bucle) que no apunta a la causa.
  //
  // EN PRODUCCIÓN DEBE SER 'true'. La validación de abajo lo exige.
  COOKIE_SECURE: Joi.string()
    .valid('true', 'false')
    .default('false')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.valid('true').messages({
        'any.only':
          'COOKIE_SECURE debe ser "true" en produccion: sin HTTPS la cookie de sesion viaja en claro.',
      }),
    }),

  // 'lax' sirve cuando el front y el API comparten sitio (mismo dominio, o
  // distinto puerto de localhost). Si se despliegan en dominios distintos hace
  // falta 'none', que a su vez EXIGE secure: el navegador rechaza
  // SameSite=None sin Secure.
  COOKIE_SAME_SITE: Joi.string()
    .valid('lax', 'strict', 'none')
    .default('lax')
    .when('COOKIE_SECURE', {
      is: 'false',
      then: Joi.invalid('none').messages({
        'any.invalid':
          'SameSite=None exige Secure: el navegador descartaria la cookie en silencio.',
      }),
    }),

  // Dominio de la cookie. Vacío = sólo el host que la emitió, que es lo más
  // restrictivo y lo correcto salvo que front y API vivan en subdominios
  // distintos del mismo dominio.
  COOKIE_DOMAIN: Joi.string().allow('').optional(),

  // 'true' SÓLO si hay un proxy inverso delante (Nginx, un balanceador, Cloud
  // Run). Sin proxy, confiar en X-Forwarded-For deja que cualquiera falsifique
  // su IP y esquive el límite de intentos de login.
  TRUST_PROXY: Joi.string().valid('true', 'false').default('false'),

  TOLERANCE_THRESHOLD: Joi.number().default(20),

  // Regla sanitaria, no decisión de implementación: ¿un lote cuya caducidad es
  // HOY sigue siendo vendible? Por defecto sí (la fecha impresa es el último día
  // de validez, criterio habitual en farmacia). Ponerlo en 'false' sólo si el
  // PNO o el responsable sanitario define que esa fecha es el primer día NO
  // válido. Ver src/inventory/fefo.ts → isExpiryInclusive().
  EXPIRY_INCLUSIVE: Joi.boolean().truthy('true').falsy('false').default(true),

  // Rate limiting. El limite global protege contra abuso sin estorbar al POS:
  // un cajero genera una peticion por producto escaneado y varias cajas suelen
  // compartir la misma IP publica.
  THROTTLE_TTL_MS: Joi.number().integer().positive().default(60000),
  THROTTLE_LIMIT: Joi.number().integer().positive().default(600),

  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .optional(),
})
  // Reporta TODOS los problemas de configuracion de una vez, en lugar de obligar
  // a corregirlos uno por uno reiniciando entre cada intento.
  .options({ abortEarly: false });
