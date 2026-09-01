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

  TOLERANCE_THRESHOLD: Joi.number().default(20),

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
