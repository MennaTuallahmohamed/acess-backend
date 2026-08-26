const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("============================================================");
  console.log(" CHECK 852 RESTORE REQUIREMENTS");
  console.log(" READ ONLY - NO INSERT / UPDATE / DELETE");
  console.log("============================================================");

  console.log("\n1) Device column requirements");
  console.log("------------------------------------------------------------");

  const columns = await prisma.$queryRawUnsafe(`
    SELECT
      column_name,
      is_nullable,
      data_type,
      column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Device'
      AND column_name IN (
        'deviceCode',
        'serialNumber',
        'ipAddress',
        'secretCode',
        'assetType',
        'locationId',
        'deviceTypeId',
        'deviceName',
        'currentStatus',
        'lifecycleStatus'
      )
    ORDER BY ordinal_position
  `);

  console.table(columns);

  console.log("\n2) Location candidates for Cluster 13A/14A + Zone 11 right + Lane 2 + IN");
  console.log("------------------------------------------------------------");

  const locations = await prisma.$queryRawUnsafe(`
    SELECT
      l."id",
      l."cluster",
      l."building",
      l."zone",
      l."lane",
      l."direction"
    FROM "Location" l
    WHERE
      regexp_replace(lower(coalesce(l."cluster", '')), '[^a-z0-9]+', '', 'g')
        IN ('13a14a')
      AND regexp_replace(lower(coalesce(l."zone", '')), '[^a-z0-9]+', '', 'g')
        = 'zone11right'
      AND regexp_replace(lower(coalesce(l."lane", '')), '[^a-z0-9]+', '', 'g')
        = '2'
      AND upper(trim(coalesce(l."direction", ''))) = 'IN'
    ORDER BY l."id"
  `);

  if (!locations.length) {
    console.log("❌ No exact Location found.");
  } else {
    console.log(`✅ Found ${locations.length} exact location candidate(s):`);
    console.table(locations);
  }

  console.log("\n3) Any DEVICE row with blank/null serial");
  console.log("------------------------------------------------------------");

  const blankSerial = await prisma.$queryRawUnsafe(`
    SELECT
      d."id",
      d."deviceCode",
      d."serialNumber",
      d."ipAddress",
      d."secretCode",
      d."assetType"::text AS "assetType"
    FROM "Device" d
    WHERE d."assetType"::text = 'DEVICE'
      AND (d."serialNumber" IS NULL OR trim(d."serialNumber") = '')
    ORDER BY d."id"
    LIMIT 20
  `);

  if (!blankSerial.length) {
    console.log("No DEVICE rows currently have NULL/blank serial.");
  } else {
    console.log(`Found ${blankSerial.length} sample DEVICE row(s) with NULL/blank serial:`);
    console.table(blankSerial);
  }

  console.log("\n============================================================");
  console.log(" DONE - NO DATABASE CHANGES WERE MADE");
  console.log("============================================================");
}

main()
  .catch((err) => {
    console.error("\nERROR:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
