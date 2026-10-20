/**
 * RFC mexicano: una sola regla para la API y para la semilla.
 *
 * La semilla escribía `SEED_COMPANY_RFC` tal cual venía en el `.env`
 * ("xaxx-010101 000"). La API sí lo normalizaba, así que la ficha quedaba con
 * un valor que la pantalla de Configuración marcaba como inválido y el botón
 * de guardar se deshabilitaba sin que el usuario hubiera tocado el RFC.
 *
 * Persona moral: 3 letras + 6 dígitos (fecha) + 3 de homoclave = 12.
 * Persona física: 4 letras + 6 dígitos + 3 = 13.
 */
export const RFC_REGEX = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i;

/**
 * Deja el RFC como lo guarda el sistema: sin espacios ni guiones y en
 * mayúsculas. Los guiones y espacios son la forma habitual de escribirlo a
 * mano ("XAXX-010101-000"), pero no forman parte del RFC.
 */
export function normalizarRfc(valor: string): string {
  return valor.replace(/[\s-]+/g, '').toUpperCase();
}

/** ¿Es un RFC con formato válido? Vacío NO es válido aquí: decide quien llama. */
export function esRfcValido(valor: string): boolean {
  return RFC_REGEX.test(valor);
}

/**
 * RFC para la semilla: normalizado, o `undefined` si no se configuró.
 * Si viene pero no tiene formato válido, lanza: es preferible detener la
 * instalación con un mensaje claro que dejar una ficha que no se puede guardar.
 */
export function rfcDeSemilla(valor: string | undefined): string | undefined {
  if (valor === undefined || valor.trim() === '') return undefined;
  const rfc = normalizarRfc(valor);
  if (!esRfcValido(rfc)) {
    throw new Error(
      `SEED_COMPANY_RFC="${valor}" no es un RFC válido. Debe tener 12 caracteres ` +
        '(empresa) o 13 (persona física): letras, fecha AAMMDD y homoclave, ' +
        'por ejemplo XAXX010101000. Corrígelo en el .env o déjalo vacío.',
    );
  }
  return rfc;
}
