const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const gates = await prisma.gate.findMany({
    select: {
      building: true,
      gateNo: true,
      secretCode: true,
    },
    orderBy: {
      building: "asc",
    },
  });

  // ناخد بوابة واحدة فقط من كل وزارة
  const ministries = new Map();

  for (const gate of gates) {
    if (!ministries.has(gate.building)) {
      ministries.set(gate.building, gate);
    }

    if (ministries.size === 5) {
      break;
    }
  }

  const result = Array.from(ministries.values()).map(
    (gate, index) => ({
      Test: index + 1,
      Ministry: gate.building,
      Gate: gate.gateNo,
      SecretCode: gate.secretCode,
    })
  );

  console.log("");
  console.log("==============================================");
  console.log("        5 GATES FROM 5 MINISTRIES");
  console.log("==============================================");
  console.log("");

  console.table(result);

  console.log("");
  console.log(`Found: ${result.length} ministries`);
  console.log("");
}

main()
  .catch((error) => {
    console.error("ERROR:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });