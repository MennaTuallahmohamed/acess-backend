const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const fallbackTechnician = await prisma.user.findFirst({
    where: {
      role: {
        name: "TECHNICIAN",
      },
    },
    orderBy: {
      id: "asc",
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!fallbackTechnician) {
    throw new Error("No TECHNICIAN user found to use as fallback");
  }

  console.log("Fallback technician:", fallbackTechnician);

  const inspections = await prisma.inspection.findMany({
    select: {
      id: true,
      deviceId: true,
      technicianId: true,
      inspectionStatus: true,
      inspectedAt: true,
    },
    orderBy: {
      id: "asc",
    },
  });

  const users = await prisma.user.findMany({
    select: {
      id: true,
    },
  });

  const userIds = new Set(users.map((u) => u.id));

  const badInspections = inspections.filter((inspection) => {
    return (
      inspection.technicianId == null ||
      !userIds.has(inspection.technicianId)
    );
  });

  console.log("Bad inspections:", badInspections);

  for (const inspection of badInspections) {
    await prisma.inspection.update({
      where: {
        id: inspection.id,
      },
      data: {
        technicianId: fallbackTechnician.id,
      },
    });

    console.log(
      `Fixed inspection ${inspection.id}: technicianId -> ${fallbackTechnician.id}`
    );
  }

  console.log("Done. Fixed count:", badInspections.length);
}

main()
  .catch((error) => {
    console.error("ERROR:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
