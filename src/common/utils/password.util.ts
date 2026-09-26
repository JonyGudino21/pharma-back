/**
 * Costo de bcrypt para TODAS las contraseñas del sistema.
 *
 * 12 rondas: ~250 ms por verificación, imperceptible al iniciar sesión y muy
 * caro para quien intente millones de combinaciones contra un volcado de la
 * base. Vive aquí, en un solo sitio: antes se usaban 10 al crear usuarios y 12
 * en la semilla, así que la fortaleza del hash dependía de por dónde se había
 * creado la cuenta.
 */
export const BCRYPT_ROUNDS = 12;
