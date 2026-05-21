const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  console.log("Checking inspections...");

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

  console.log("Inspections:", inspections);

  const users = await prisma.user.findMany({
    select: {
      id: true,
      fullName: true,
      email: true,
      jobTitle: true,
      roleId: true,
      role: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  const devices = await prisma.device.findMany({
    select: {
      id: true,
      deviceCode: true,
      serialNumber: true,
    },
  });

  const userIds = new Set(users.map((u) => u.id));
  const deviceIds = new Set(devices.map((d) => d.id));

  const badTechnicians = inspections.filter(
    (i) => i.technicianId != null && !userIds.has(i.technicianId)
  );

  const badDevices = inspections.filter(
    (i) => i.deviceId != null && !deviceIds.has(i.deviceId)
  );

  console.log("Bad inspection technicians:", badTechnicians);
  console.log("Bad inspection devices:", badDevices);

  console.log("Total inspections:", inspections.length);
  console.log("Total users:", users.length);
  console.log("Total devices:", devices.length);
}

main()
  .catch((error) => {
    console.error("ERROR:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
