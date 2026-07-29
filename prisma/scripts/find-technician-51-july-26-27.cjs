const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const TECHNICIAN_ID = 51;
const DATE_FROM = "2026-07-26";
const DATE_TO = "2026-07-27";

function jsonSafe(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? item.toString() : item
    )
  );
}

async function main() {
  console.log("====================================================");
  console.log("SMART IT — TECHNICIAN 51 INVESTIGATION");
  console.log("DATES: 26 AND 27 JULY 2026 ONLY");
  console.log("READ ONLY — NO INSERT / UPDATE / DELETE");
  console.log("====================================================\n");

  const technicianRows = await prisma.$queryRawUnsafe(
    `SELECT *
     FROM "User"
     WHERE "id" = $1
     LIMIT 1`,
    TECHNICIAN_ID
  );

  const technician = technicianRows?.[0] || null;

  if (!technician) {
    console.log(`No user was found with ID ${TECHNICIAN_ID}.`);
    return;
  }

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
       i."latitude",
       i."longitude",

       d."id" AS "deviceId",
       d."deviceCode",
       d."deviceName",
       d."serialNumber",
       d."barcode",
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
       g."lane" AS "gateLane",
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
     LEFT JOIN "Device" d
       ON d."id" = i."deviceId"
     LEFT JOIN "Gate" g
       ON g."id" = i."gateId"
     LEFT JOIN "Location" l
       ON l."id" = COALESCE(d."locationId", g."locationId")
     WHERE i."technicianId" = $1
       AND COALESCE(i."inspectedAt", i."createdAt") >= $2::date
       AND COALESCE(i."inspectedAt", i."createdAt") < ($3::date + INTERVAL '1 day')
     ORDER BY COALESCE(i."inspectedAt", i."createdAt") ASC`,
    TECHNICIAN_ID,
    DATE_FROM,
    DATE_TO
  );

  const dailySummary = await prisma.$queryRawUnsafe(
    `SELECT
       TO_CHAR(DATE(COALESCE(i."inspectedAt", i."createdAt")), 'YYYY-MM-DD') AS "date",
       COUNT(*)::int AS "totalInspections",
       COUNT(*) FILTER (
         WHERE i."inspectionStatus"::text = 'OK'
       )::int AS "ok",
       COUNT(*) FILTER (
         WHERE i."inspectionStatus"::text <> 'OK'
       )::int AS "notOk",
       MIN(COALESCE(i."inspectedAt", i."createdAt")) AS "firstInspection",
       MAX(COALESCE(i."inspectedAt", i."createdAt")) AS "lastInspection"
     FROM "Inspection" i
     WHERE i."technicianId" = $1
       AND COALESCE(i."inspectedAt", i."createdAt") >= $2::date
       AND COALESCE(i."inspectedAt", i."createdAt") < ($3::date + INTERVAL '1 day')
     GROUP BY DATE(COALESCE(i."inspectedAt", i."createdAt"))
     ORDER BY DATE(COALESCE(i."inspectedAt", i."createdAt"))`,
    TECHNICIAN_ID,
    DATE_FROM,
    DATE_TO
  );

  const day26 = inspections.filter((row) => {
    const value = row.inspectedAt || row.createdAt;
    return value && new Date(value).toISOString().slice(0, 10) === "2026-07-26";
  });

  const day27 = inspections.filter((row) => {
    const value = row.inspectedAt || row.createdAt;
    return value && new Date(value).toISOString().slice(0, 10) === "2026-07-27";
  });

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    requestedTechnicianId: TECHNICIAN_ID,
    requestedDates: [DATE_FROM, DATE_TO],
    technician: jsonSafe(technician),
    summary: {
      totalInspections: inspections.length,
      dailySummary: jsonSafe(dailySummary),
    },
    inspectionsByDay: {
      "2026-07-26": jsonSafe(day26),
      "2026-07-27": jsonSafe(day27),
    },
    allMatchingInspections: jsonSafe(inspections),
  };

  console.log("TECHNICIAN:");
  console.log(
    JSON.stringify(
      {
        id: technician.id,
        fullName:
          technician.fullName ||
          technician.name ||
          technician.username ||
          technician.email ||
          null,
      },
      null,
      2
    )
  );

  console.log("\nDAILY SUMMARY:");
  console.log(JSON.stringify(jsonSafe(dailySummary), null, 2));

  console.log(`\n26 July records: ${day26.length}`);
  console.log(`27 July records: ${day27.length}`);
  console.log(`Total records: ${inspections.length}`);

  const fs = require("fs");
  const path = require("path");

  const outputPath = path.join(
    process.cwd(),
    "technician-51-26-27-july-2026-report.json"
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