@'
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
    throw new Error("Menna technician not found in THIS production database");
  }

  console.log("Using technician:", menna);

  const users = await prisma.user.findMany({
    select: { id: true },
  });

  const userIds = users.map((u) => u.id);

  const badInspections = await prisma.inspection.findMany({
    where: {
      OR: [
        { technicianId: null },
        {
          technicianId: {
            notIn: userIds,
          },
        },
      ],
    },
    select: {
      id: true,
      technicianId: true,
      deviceId: true,
      inspectionStatus: true,
      inspectedAt: true,
    },
  });

  console.log("Bad inspections before fix:", badInspections);

  if (badInspections.length > 0) {
    const result = await prisma.inspection.updateMany({
      where: {
        id: {
          in: badInspections.map((i) => i.id),
        },
      },
      data: {
        technicianId: menna.id,
      },
    });

    console.log("Fixed inspections count:", result.count);
  }

  const check = await prisma.inspection.findMany({
    select: {
      id: true,
      technicianId: true,
      deviceId: true,
      inspectionStatus: true,
      inspectedAt: true,
    },
    orderBy: { id: "asc" },
  });

  console.log("Final inspections:", check);
}

main()
  .catch((error) => {
    console.error("ERROR:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
'@ | Set-Content -Path "C:\Users\IT\backend\force_fix_inspections_production.js" -Encoding UTF8