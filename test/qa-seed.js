/**
 * Siembra de datos para revision manual de la pantalla de historial (P1-2).
 *
 * NO forma parte del pipeline: es una utilidad para levantar la UI contra la
 * base de pruebas y recorrerla a mano sin tocar la base de desarrollo.
 *
 *   $env:DATABASE_URL="postgresql://postgres:123456@localhost:5432/pharma_test"
 *   node test/qa-seed.js
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  // GUARDA DE ENTORNO. Esta semilla crea un ADMIN con una contraseña FIJA y
  // conocida ('Qa12345!'). Ejecutada por error contra la base de la farmacia,
  // dejaría una puerta abierta que cualquiera que lea este repo puede usar.
  const url = process.env.DATABASE_URL || '';
  if (process.env.NODE_ENV === 'production' || !/test/i.test(url)) {
    throw new Error(
      'qa-seed.js sólo corre contra una base de PRUEBAS (DATABASE_URL debe contener "test") ' +
        'y nunca con NODE_ENV=production. Base actual: ' + url.replace(/\/\/[^@]*@/, '//***@'),
    );
  }

  const password = await bcrypt.hash('Qa12345!', 10);

  const usuarios = [
    { userName: 'qa_admin', role: 'ADMIN', firstName: 'Ana', lastName: 'Gerente' },
    { userName: 'qa_cajero', role: 'CASHIER', firstName: 'Beto', lastName: 'Cajero' },
  ];

  for (const u of usuarios) {
    await prisma.user.upsert({
      where: { userName: u.userName },
      update: { password, isActive: true },
      create: { ...u, password, email: `${u.userName}@qa.local` },
    });
  }

  const admin = await prisma.user.findUniqueOrThrow({
    where: { userName: 'qa_admin' },
  });
  const cajero = await prisma.user.findUniqueOrThrow({
    where: { userName: 'qa_cajero' },
  });

  // Turno abierto para ambos: vender y reembolsar en efectivo lo exigen.
  for (const userId of [admin.id, cajero.id]) {
    const abierto = await prisma.cashShift.findFirst({
      where: { userId, status: 'OPEN' },
    });
    if (!abierto) {
      await prisma.cashShift.create({ data: { userId, initialAmount: 3000 } });
    }
  }

  const productos = [];
  for (const [i, nombre] of [
    'Paracetamol 500mg',
    'Ibuprofeno 400mg',
    'Amoxicilina 500mg',
    'Omeprazol 20mg',
  ].entries()) {
    const sku = `QA-DEMO-${i + 1}`;
    productos.push(
      await prisma.product.upsert({
        where: { sku },
        update: { stock: 200 },
        create: {
          name: nombre,
          sku,
          stock: 200,
          minStock: 10,
          price: 45 + i * 30,
          cost: 20 + i * 15,
        },
      }),
    );
  }

  const cliente = await prisma.client.upsert({
    where: { id: 1 },
    update: {},
    create: { name: 'Farmacia del Valle S.A.', hasCredit: true, creditLimit: 20000 },
  });

  console.log('Usuarios: qa_admin / qa_cajero  ·  contrasena: Qa12345!');
  console.log(`Productos: ${productos.map((p) => p.sku).join(', ')}`);
  console.log(`Cliente: ${cliente.name} (id ${cliente.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
