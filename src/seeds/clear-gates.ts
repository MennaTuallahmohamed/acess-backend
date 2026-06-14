import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.gate.deleteMany({});

  console.log('====================');
  console.log('DELETED GATES =', result.count);
  console.log('====================');
}

main()
  .catch((error) => {
    console.error(error);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });