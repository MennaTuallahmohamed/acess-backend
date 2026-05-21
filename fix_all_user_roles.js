const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function norm(value) {
  return String(value || "").trim().toUpperCase();
}

async function main() {
  const roles = await prisma.role.findMany({
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });

  console.log("Current roles:", roles);

  const adminRole = roles.find((r) => norm(r.name) === "ADMIN");
  const viewerRole = roles.find((r) => norm(r.name) === "VIEWER");
  const technicianRole = roles.find((r) => norm(r.name) === "TECHNICIAN");

  if (!adminRole || !viewerRole || !technicianRole) {
    throw new Error("Missing ADMIN / VIEWER / TECHNICIAN role");
  }

  // 1) أي يوزر jobTitle بتاعه TECHNICIAN يتحول لرول الفني الرسمي
  const techByJob = await prisma.user.updateMany({
    where: {
      OR: [
        { jobTitle: { equals: "TECHNICIAN", mode: "insensitive" } },
        { jobTitle: { equals: "فني", mode: "insensitive" } },
      ],
    },
    data: {
      roleId: technicianRole.id,
      jobTitle: "TECHNICIAN",
    },
  });

  console.log("Updated technicians by jobTitle:", techByJob.count);

  // 2) أي يوزر مربوط برول technician lowercase يتحول لـ TECHNICIAN الرسمي
  const lowerTechnicianRoles = roles.filter(
    (r) => norm(r.name) === "TECHNICIAN" && r.id !== technicianRole.id
  );

  for (const role of lowerTechnicianRoles) {
    const result = await prisma.user.updateMany({
      where: { roleId: role.id },
      data: {
        roleId: technicianRole.id,
        jobTitle: "TECHNICIAN",
      },
    });

    console.log(`Moved users from role ${role.name} (${role.id}) to TECHNICIAN:`, result.count);
  }

  // 3) أي يوزر مربوط برول viewer lowercase يتحول لـ VIEWER الرسمي
  const lowerViewerRoles = roles.filter(
    (r) => norm(r.name) === "VIEWER" && r.id !== viewerRole.id
  );

  for (const role of lowerViewerRoles) {
    const result = await prisma.user.updateMany({
      where: { roleId: role.id },
      data: {
        roleId: viewerRole.id,
      },
    });

    console.log(`Moved users from role ${role.name} (${role.id}) to VIEWER:`, result.count);
  }

  // 4) أي يوزر مربوط برول admin lowercase يتحول لـ ADMIN الرسمي
  const lowerAdminRoles = roles.filter(
    (r) => norm(r.name) === "ADMIN" && r.id !== adminRole.id
  );

  for (const role of lowerAdminRoles) {
    const result = await prisma.user.updateMany({
      where: { roleId: role.id },
      data: {
        roleId: adminRole.id,
      },
    });

    console.log(`Moved users from role ${role.name} (${role.id}) to ADMIN:`, result.count);
  }

  // 5) امسحي الرولات المكررة بعد نقل المستخدمين
  const duplicateRoleIds = [
    ...lowerTechnicianRoles.map((r) => r.id),
    ...lowerViewerRoles.map((r) => r.id),
    ...lowerAdminRoles.map((r) => r.id),
  ];

  if (duplicateRoleIds.length > 0) {
    const deleted = await prisma.role.deleteMany({
      where: { id: { in: duplicateRoleIds } },
    });

    console.log("Deleted duplicate roles:", deleted.count);
  }

  const finalRoles = await prisma.role.findMany({
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });

  const finalUsers = await prisma.user.findMany({
    select: {
      id: true,
      fullName: true,
      email: true,
      username: true,
      jobTitle: true,
      roleId: true,
      role: { select: { id: true, name: true } },
    },
    orderBy: { id: "asc" },
  });

  console.log("Final roles:", finalRoles);
  console.log("Final users:", finalUsers);
}

main()
  .catch((error) => {
    console.error("ERROR:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
