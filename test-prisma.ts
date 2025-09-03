import { PrismaClient } from '@prisma/client';

async function testPrisma() {
  try {
    const prisma = new PrismaClient();
    await prisma.$connect();
    console.log('✅ Prisma conectado correctamente');
    await prisma.$disconnect();
  } catch (error) {
    console.error('❌ Error de Prisma:', error);
  }
}

testPrisma();