const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const IP = "10.254.214.117";
  const DEVICE_CODE = "852";
  const SECRET = "DSC-AEF0-98B7-B963-5922";

  console.log("============================================================");
  console.log(" CHECK DEVICE 852 BEFORE RESTORE");
  console.log(" READ ONLY - NO DATABASE CHANGES");
  console.log("============================================================");
  console.log(`Target DeviceCode : ${DEVICE_CODE}`);
  console.log(`Target IP         : ${IP}`);
  console.log(`Target Secret     : ${SECRET}`);
  console.log("");

  const conflicts = await prisma.$queryRawUnsafe(`
    SELECT
      d."id",
      d."deviceCode",
      d."ipAddress",
      d."serialNumber",
      d."secretCode",
      d."assetType"::text AS "assetType",
      d."locationId",
      l."cluster",
      l."building",
      l."zone",
      l."lane",
      l."direction"
    FROM "Device" d
    LEFT JOIN "Location" l ON l."id" = d."locationId"
    WHERE
      d."ipAddress" = $1
      OR d."deviceCode" = $2
      OR d."secretCode" = $3
    ORDER BY d."id"
  `, IP, DEVICE_CODE, SECRET);

  console.log("CURRENT MATCHES / CONFLICTS");
  console.log("------------------------------------------------------------");
  if (!conflicts.length) {
    console.log("No existing rows match IP / DeviceCode / Secret.");
  } else {
    conflicts.forEach((r, i) => {
      console.log(`MATCH ${i + 1}`);
      console.log(`  Backend ID  : ${r.id}`);
      console.log(`  Asset Type  : ${r.assetType}`);
      console.log(`  Device Code : ${r.deviceCode ?? ""}`);
      console.log(`  IP          : ${r.ipAddress ?? ""}`);
      console.log(`  Serial      : ${r.serialNumber ?? ""}`);
      console.log(`  Secret Code : ${r.secretCode ?? ""}`);
      console.log(`  Cluster     : ${r.cluster ?? ""}`);
      console.log(`  Building    : ${r.building ?? ""}`);
      console.log(`  Zone        : ${r.zone ?? ""}`);
      console.log(`  Lane        : ${r.lane ?? ""}`);
      console.log(`  Direction   : ${r.direction ?? ""}`);
      console.log("");
    });
  }

  console.log("UNIQUE INDEXES / CONSTRAINTS ON Device");
  console.log("------------------------------------------------------------");

  const indexes = await prisma.$queryRawUnsafe(`
    SELECT
      indexname,
      indexdef
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'Device'
    ORDER BY indexname
  `);

  if (!indexes.length) {
    console.log("No indexes returned.");
  } else {
    indexes.forEach((idx) => {
      console.log(`${idx.indexname}`);
      console.log(`  ${idx.indexdef}`);
    });
  }

  console.log("");
  console.log("============================================================");
  console.log(" DONE - NO DATABASE CHANGES WERE MADE");
  console.log("============================================================");
}

main()
  .catch((err) => {
    console.error("");
    console.error("ERROR:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
