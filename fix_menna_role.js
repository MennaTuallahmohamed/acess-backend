const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const roles = await prisma.role.findMany({
    select: {
      id: true,
      name: true,
    },
  });

  console.log("Roles:", roles);

  const technicianRole = roles.find(
    (role) => role.name.toUpperCase() === "TECHNICIAN"
  );

  if (!technicianRole) {
    throw new Error("TECHNICIAN role not found");
  }

  const user = await prisma.user.update({
    where: {
      email: "menna15mohamed@gmail.com",
    },
    data: {
      roleId: technicianRole.id,
      jobTitle: "TECHNICIAN",
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      username: true,
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

  console.log("Updated user:", user);
}

main()
  .catch((error) => {
    console.error("ERROR:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
