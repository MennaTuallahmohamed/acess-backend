const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const TECHNICIAN_ID = 51;

function jsonSafe(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? item.toString() : item
    )
  );
}

async function main() {
  console.log("====================================================");
  console.log("SMART IT — TECHNICIAN INVESTIGATION");
  console.log("READ ONLY — NO INSERT / UPDATE / DELETE");
  console.log(`Target technician ID: ${TECHNICIAN_ID}`);
  console.log("====================================================\n");

  const technicianRows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "User" WHERE "id" = $1 LIMIT 1`,
    TECHNICIAN_ID
  );

  const technician = technicianRows?.[0] || null;

  if (!technician) {
    console.log(`No user was found with ID ${TECHNICIAN_ID}.`);
    return;
  }

  const statusCounts = await prisma.$queryRawUnsafe(
    `SELECT
       COALESCE("inspectionStatus"::text, 'UNKNOWN') AS "status",
       COUNT(*)::int AS "count"
     FROM "Inspection"
     WHERE "technicianId" = $1
     GROUP BY "inspectionStatus"
     ORDER BY COUNT(*) DESC`,
    TECHNICIAN_ID
  );

  const inspections = await prisma.$queryRawUnsafe(
    `SELECT
       i."id" AS "inspectionId",
       i."technicianId",
       i."inspectionStatus"::text AS "inspectionStatus",
       i."inspectedAt",
       i."createdAt",
       i."updatedAt",
       i."issueReason",
       i."notes" AS "inspectionNotes",
       i."locationText" AS "inspectionLocationText",

       d."id" AS "deviceId",
       d."deviceCode",
       d."deviceName",
       d."serialNumber",
       d."ipAddress",
       d."currentStatus"::text AS "deviceCurrentStatus",
       d."gateCluster" AS "deviceCluster",
       d."gateBuilding" AS "deviceBuilding",
       d."gateZone" AS "deviceZone",
       d."gateDirection" AS "deviceDirection",
       d."locationId" AS "deviceLocationId",

       g."id" AS "gateId",
       g."gateNo",
       g."secretCode" AS "gateSecretCode",
       g."cluster" AS "gateCluster",
       g."building" AS "gateBuilding",
       g."zone" AS "gateZone",
       g."direction" AS "gateDirection",
       g."locationId" AS "gateLocationId",

       l."id" AS "locationId",
       l."cluster" AS "locationCluster",
       l."building" AS "locationBuilding",
       l."zone" AS "locationZone",
       l."lane" AS "locationLane",
       l."direction" AS "locationDirection",
       l."type"::text AS "locationType"

     FROM "Inspection" i
     LEFT JOIN "Device" d ON d."id" = i."deviceId"
     LEFT JOIN "Gate" g ON g."id" = i."gateId"
     LEFT JOIN "Location" l
       ON l."id" = COALESCE(d."locationId", g."locationId")
     WHERE i."technicianId" = $1
     ORDER BY COALESCE(i."inspectedAt", i."createdAt") DESC`,
    TECHNICIAN_ID
  );

  const summary = {
    technicianId: TECHNICIAN_ID,
    technicianName:
      technician.fullName ||
      technician.name ||
      technician.username ||
      technician.email ||
      null,
    totalInspections: inspections.length,
    statusCounts: jsonSafe(statusCounts),
    firstInspection:
      inspections.length
        ? inspections[inspections.length - 1].inspectedAt ||
          inspections[inspections.length - 1].createdAt
        : null,
    latestInspection:
      inspections.length
        ? inspections[0].inspectedAt || inspections[0].createdAt
        : null,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    summary,
    technician: jsonSafe(technician),
    inspections: jsonSafe(inspections),
  };

  console.log("TECHNICIAN:");
  console.log(JSON.stringify(jsonSafe(technician), null, 2));

  console.log("\nSUMMARY:");
  console.log(JSON.stringify(summary, null, 2));

  const fs = require("fs");
  const path = require("path");
  const outputPath = path.join(
    process.cwd(),
    `technician-${TECHNICIAN_ID}-report.json`
  );

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

  console.log("\n====================================================");
  console.log(`Report saved to: ${outputPath}`);
  console.log("Nothing was inserted, updated, or deleted.");
  console.log("====================================================");
}

main()
  .catch((error) => {
    console.error("\nInvestigation failed:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });