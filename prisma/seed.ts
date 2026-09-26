import { Prisma, PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DEFAULT_RECEIPT_LAYOUT } from '../src/company/receipt-layout';

/**
 * SEMILLA MÍNIMA: lo indispensable para que el sistema sea usable.
 *
 * ─── POR QUÉ EXISTE ───
 * Sin esto, una instalación nueva es un callejón sin salida: no hay ningún
 * usuario, así que no se puede iniciar sesión; y como crear usuarios exige
 * estar autenticado, tampoco hay forma de crear el primero. La única salida
 * sería un INSERT a mano con el hash de bcrypt calculado aparte.
 *
 * ─── QUÉ CREA ───
 *   1. Un usuario ADMIN con la contraseña que indiques por variable de entorno.
 *   2. La ficha de la empresa (el ticket la necesita para imprimir).
 *
 * NO crea productos, clientes ni proveedores de ejemplo: en una farmacia real
 * ese catálogo inventado se mezcla con el de verdad y limpiarlo después es
 * peor que capturarlo bien desde el principio.
 *
 * ─── IDEMPOTENTE ───
 * Se puede ejecutar mil veces. Si el usuario ya existe NO le cambia la
 * contraseña: un seed que pisa credenciales en producción es una puerta
 * trasera esperando a que alguien lo ejecute por costumbre.
 *
 * ─── USO ───
 *   # PowerShell
 *   $env:SEED_ADMIN_PASSWORD="una-contrasena-larga-y-tuya"
 *   npx prisma db seed
 */

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@farmacia.local';
  const userName = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    throw new Error(
      'Falta SEED_ADMIN_PASSWORD.\n' +
        'No se define una contraseña por defecto a propósito: una instalación ' +
        'con "admin/admin123" es una cuenta abierta que nadie cambia nunca.\n' +
        'Ejemplo (PowerShell):\n' +
        '  $env:SEED_ADMIN_PASSWORD="elige-una-contrasena-larga"\n' +
        '  npx prisma db seed',
    );
  }

  // if (password.length < 12) {
  //   throw new Error(
  //     'SEED_ADMIN_PASSWORD debe tener al menos 12 caracteres. ' +
  //       'Esta cuenta puede anular ventas y ver el libro de controlados.',
  //   );
  // }

  // ── 1. Usuario administrador ────────────────────────────────────────────
  const existente = await prisma.user.findFirst({
    where: { OR: [{ email }, { userName }] },
    select: { id: true, email: true, userName: true },
  });

  if (existente) {
    console.log(
      `→ El usuario "${existente.userName}" ya existe (id ${existente.id}). ` +
        'No se toca su contraseña.',
    );
  } else {
    // 12 rondas: el costo recomendado hoy. Tarda ~250 ms por verificación, que
    // es imperceptible al iniciar sesión y carísimo para un atacante que
    // intente millones de combinaciones contra un volcado de la base.
    const hash = await bcrypt.hash(password, 12);

    const admin = await prisma.user.create({
      data: {
        userName,
        email,
        password: hash,
        firstName: 'Administrador',
        lastName: 'del Sistema',
        role: UserRole.ADMIN,
        isActive: true,
      },
      select: { id: true, userName: true, email: true },
    });

    console.log(`✓ Usuario ADMIN creado: ${admin.userName} <${admin.email}>`);
  }

  // ── 2. Ficha de la empresa ──────────────────────────────────────────────
  // El ticket de venta la necesita para imprimir el encabezado, y la
  // exportación del libro de controlados la usa en la cabecera del reporte.
  // `singletonKey` garantiza que sólo haya una ficha por instalación.
  const empresa = await prisma.company.upsert({
    where: { singletonKey: 'default' },
    update: {},
    create: {
      singletonKey: 'default',
      legalName:
        process.env.SEED_COMPANY_LEGAL_NAME ?? 'Razón social pendiente',
      tradeName: process.env.SEED_COMPANY_TRADE_NAME ?? 'Mi Farmacia',
      rfc: process.env.SEED_COMPANY_RFC ?? '',
      address: process.env.SEED_COMPANY_ADDRESS ?? '',
      ticketFooter: '¡Gracias por su compra!',
    },
    select: { id: true, tradeName: true },
  });

  console.log(`✓ Empresa lista: ${empresa.tradeName} (id ${empresa.id})`);

  // ── 3. Plantilla de ticket por defecto ──────────────────────────────────
  // Sin una plantilla, la primera impresión falla. 58 mm es el rollo más común
  // en las impresoras térmicas de punto de venta.
  const plantillas = await prisma.receiptTemplate.count({
    where: { companyId: empresa.id },
  });

  if (plantillas === 0) {
    await prisma.receiptTemplate.create({
      data: {
        companyId: empresa.id,
        name: 'Ticket 58 mm',
        paperWidthMm: 58,
        // Misma forma que company.service: sin layout el create falla en
        // runtime (Json requerido) y sin isDefault la impresión no sabe
        // qué plantilla usar cuando sólo existe esta.
        layout: DEFAULT_RECEIPT_LAYOUT as unknown as Prisma.InputJsonValue,
        isDefault: true,
      },
    });
    console.log('✓ Plantilla de ticket 58 mm creada');
  } else {
    console.log(`→ Ya hay ${plantillas} plantilla(s) de ticket.`);
  }

  console.log('\nListo. Inicia sesión con el usuario administrador.');
  console.log('Cambia su contraseña desde la aplicación antes de operar.\n');
}

main()
  .catch((error: unknown) => {
    console.error('\n✗ La semilla falló:\n');
    console.error(error instanceof Error ? error.message : error);
    // Código 1: que el script falle de verdad, para que un despliegue
    // automatizado se detenga en vez de continuar con la base a medias.
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
