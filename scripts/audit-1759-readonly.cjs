const fs = require("fs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const IDS_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\PROTECTED_641_IDS.json";

function loadProtectedIds() {
  if (!fs.existsSync(IDS_FILE)) {
    throw new Error(`Protected IDs file not found: ${IDS_FILE}`);
  }

  const data = JSON.parse(fs.readFileSync(IDS_FILE, "utf8"));

  const ids = Array.isArray(data.protectedBackendIds)
    ? data.protectedBackendIds.map(Number).filter(Number.isFinite)
    : [];

  return [...new Set(ids)];
}

async function main() {
  console.log("============================================================");
  console.log(" AUDIT FRONTEND 1759 VS BACKEND");
  console.log(" READ ONLY - NO DELETE / UPDATE / INSERT");
  console.log("============================================================");

  const protectedIds = loadProtectedIds();

  const totalRows = await prisma.device.count();

  const grouped = await prisma.$queryRawUnsafe(`
    SELECT
      COALESCE("assetType"::text, 'NULL') AS "assetType",
      COUNT(*)::int AS "count"
    FROM "Device"
    GROUP BY "assetType"
    ORDER BY "assetType"
  `);

  const deviceCount = await prisma.device.count({
    where: { assetType: "DEVICE" },
  });

  const gateCount = await prisma.device.count({
    where: { assetType: "GATE" },
  });

  const protectedExisting = await prisma.device.count({
    where: {
      assetType: "DEVICE",
      id: { in: protectedIds },
    },
  });

  const protectedWrongType = await prisma.device.findMany({
    where: {
      id: { in: protectedIds },
      NOT: { assetType: "DEVICE" },
    },
    select: {
      id: true,
      deviceCode: true,
      assetType: true,
    },
  });

  const unprotectedDeviceCount = Math.max(
    0,
    deviceCount - protectedExisting
  );

  console.log("");
  console.log("BACKEND COUNTS");
  console.log("------------------------------------------------------------");
  console.log(`ALL rows in Device table    : ${totalRows}`);

  grouped.forEach((row) => {
    console.log(
      `${String(row.assetType).padEnd(27)}: ${Number(row.count)}`
    );
  });

  console.log("");
  console.log("KEEP CHECK");
  console.log("------------------------------------------------------------");
  console.log(`Protected IDs file          : ${protectedIds.length}`);
  console.log(`Protected DEVICE found      : ${protectedExisting}`);
  console.log(`Protected wrong asset type  : ${protectedWrongType.length}`);
  console.log(`Unprotected DEVICE rows     : ${unprotectedDeviceCount}`);

  if (protectedWrongType.length) {
    console.log("");
    console.log("⚠️ PROTECTED IDs WITH WRONG ASSET TYPE:");
    protectedWrongType.forEach((r) => {
      console.log(
        `Backend ID ${r.id} | DeviceCode ${r.deviceCode} | assetType ${r.assetType}`
      );
    });
  }

  console.log("");
  console.log("FRONTEND 1759 CHECK");
  console.log("------------------------------------------------------------");

  if (totalRows === 1759) {
    console.log("✅ Device table total = 1759");
    console.log("✅ This strongly indicates the frontend FLEET SIZE is counting");
    console.log("   DEVICE + GATE rows together.");
  } else {
    console.log(`⚠️ Device table total is ${totalRows}, not 1759.`);
    console.log("   We need to inspect the frontend/API counting logic before deletion.");
  }

  console.log("");
  console.log("EXPECTED SAFE CLEANUP TARGET");
  console.log("------------------------------------------------------------");
  console.log(`Keep DEVICE                 : ${protectedExisting}`);
  console.log(`Delete unprotected DEVICE   : ${unprotectedDeviceCount}`);
  console.log(`Keep GATE untouched         : ${gateCount}`);
  console.log("");
  console.log(`After DEVICE cleanup, Device table total would be: ${protectedExisting + gateCount}`);
  console.log(`After DEVICE cleanup, DEVICE count would be      : ${protectedExisting}`);
  console.log(`After DEVICE cleanup, GATE count would be        : ${gateCount}`);

  console.log("");
  console.log("============================================================");
  console.log("READ ONLY ✅ NO DATABASE CHANGES WERE MADE");
  console.log("============================================================");
}

main()
  .catch((err) => {
    console.error("");
    console.error("❌ ERROR:", err.message || err);
    console.error("✅ NO DATABASE CHANGES WERE MADE.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
