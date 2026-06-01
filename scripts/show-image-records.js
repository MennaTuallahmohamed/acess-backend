const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.inspectionImage.findMany({
    take: 5,
    orderBy: { id: 'asc' },
  });

  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });