// scripts/check-13-updated.cjs
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// هذه هي الـ IDs الـ 13 التي ظهرت في تقرير التحديث
const updatedIds = [313, 500, 299, 863, 864, 865, 866, 867, 868, 869, 870, 1100, 846];

async function main() {
  const devices = await prisma.device.findMany({
    where: { id: { in: updatedIds } },
    orderBy: { id: 'asc' }
  });

  console.log("==========================================================================================");
  console.log(`تفاصيل الـ 13 جهازاً التي تم تحديثها (للتأكد من التشابه)`);
  console.log("==========================================================================================");
  console.log("DB ID | Code  | Serial Number        | IP Address       | Status");
  console.log("------------------------------------------------------------------------------------------");
  
  devices.forEach(d => {
    console.log(
      `${String(d.id).padEnd(5)} | ` +
      `${String(d.deviceCode).padEnd(5)} | ` +
      `${String(d.serialNumber || 'N/A').padEnd(20)} | ` +
      `${String(d.ipAddress || 'N/A').padEnd(16)} | ` +
      `${d.lifecycleStatus}`
    );
  });
  console.log("==========================================================================================");
}

main().catch(console.error).finally(() => prisma.$disconnect());