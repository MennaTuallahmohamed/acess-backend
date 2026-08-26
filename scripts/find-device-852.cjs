const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const TARGET_IP = "10.254.214.117";
const TARGET_DEVICE_CODE = "852";
const TARGET_SECRETS = [
  "DSC-AEF0-98B7-B963-5922",
  "ACD-V1-1AA3-68D5-CDB4-19F8",
];

async function main() {
  console.log("============================================================");
  console.log(" SEARCH BACKEND FOR MISSING DEVICE 852");
  console.log(" READ ONLY - NO UPDATE / DELETE / INSERT");
  console.log("============================================================");
  console.log(`IP         : ${TARGET_IP}`);
  console.log(`DeviceCode : ${TARGET_DEVICE_CODE}`);
  console.log(`Secrets    : ${TARGET_SECRETS.join(" , ")}`);
  console.log("");

  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      d."id",
      d."deviceCode",
      d."serialNumber",
      d."ipAddress",
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
      OR d."secretCode" = ANY($3::text[])
    ORDER BY d."id" ASC
  `, TARGET_IP, TARGET_DEVICE_CODE, TARGET_SECRETS);

  if (!rows.length) {
    console.log("❌ NO MATCHES FOUND IN BACKEND.");
    console.log("");
    console.log("This means no row was found by:");
    console.log("- IP");
    console.log("- Device Code 852");
    console.log("- either Secret Code");
    return;
  }

  console.log(`✅ FOUND ${rows.length} MATCHING ROW(S)`);
  console.log("");

  rows.forEach((r, i) => {
    console.log("------------------------------------------------------------");
    console.log(`MATCH ${i + 1}`);
    console.log("------------------------------------------------------------");
    console.log(`Backend ID  : ${r.id}`);
    console.log(`Asset Type  : ${r.assetType}`);
    console.log(`Device Code : ${r.deviceCode ?? ""}`);
    console.log(`IP          : ${r.ipAddress ?? ""}`);
    console.log(`Serial      : ${r.serialNumber ?? ""}`);
    console.log(`Secret Code : ${r.secretCode ?? ""}`);
    console.log(`Location ID : ${r.locationId ?? ""}`);
    console.log(`Cluster     : ${r.cluster ?? ""}`);
    console.log(`Building    : ${r.building ?? ""}`);
    console.log(`Zone        : ${r.zone ?? ""}`);
    console.log(`Lane        : ${r.lane ?? ""}`);
    console.log(`Direction   : ${r.direction ?? ""}`);
  });

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
