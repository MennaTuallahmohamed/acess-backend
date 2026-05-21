const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  console.log("DATABASE_URL exists:", !!process.env.DATABASE_URL);

  const menna = await prisma.user.findFirst({
    where: {
      OR: [
        { email: "menna15mohamed@gmail.com" },
        { username: "menna15" },
      ],
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      username: true,
      role: { select: { id: true, name: true } },
    },
  });

  if (!menna) {
    throw new Error("Menna technician not found");
  }

  console.log("Using technician:", menna);

  const before = await prisma.$queryRawUnsafe(`
    SELECT 
      i."id",
      i."deviceId",
      i."technicianId",
      i."inspectionStatus",
      i."inspectedAt",
      u."id" AS "userExists",
      u."fullName" AS "technicianName"
    FROM "Inspection" i
    LEFT JOIN "User" u ON u."id" = i."technicianId"
    ORDER BY i."id";
  `);

  console.log("Before check:", before);

  const badBefore = await prisma.$queryRawUnsafe(`
    SELECT 
      i."id",
      i."deviceId",
      i."technicianId",
      i."inspectionStatus",
      i."inspectedAt"
    FROM "Inspection" i
    LEFT JOIN "User" u ON u."id" = i."technicianId"
    WHERE u."id" IS NULL;
  `);

  console.log("Bad inspections before fix:", badBefore);

  const fixed = await prisma.$executeRawUnsafe(`
    UPDATE "Inspection" i
    SET "technicianId" = ${menna.id}
    WHERE NOT EXISTS (
      SELECT 1
      FROM "User" u
      WHERE u."id" = i."technicianId"
    );
  `);

  console.log("Fixed inspections count:", fixed);

  const after = await prisma.$queryRawUnsafe(`
    SELECT 
      i."id",
      i."deviceId",
      i."technicianId",
      i."inspectionStatus",
      i."inspectedAt",
      u."id" AS "userExists",
      u."fullName" AS "technicianName"
    FROM "Inspection" i
    LEFT JOIN "User" u ON u."id" = i."technicianId"
    ORDER BY i."id";
  `);

  console.log("After check:", after);
}

main()
  .catch((error) => {
    console.error("ERROR:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
