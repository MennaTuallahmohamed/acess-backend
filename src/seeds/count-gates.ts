// src/seeds/count-gates.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const count = await prisma.gate.count();

  console.log('TOTAL GATES =', count);
}

main()
  .finally(() => prisma.$disconnect());