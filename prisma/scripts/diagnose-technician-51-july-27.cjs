const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();

const TECHNICIAN_ID = 51;
const TARGET_DATE = "2026-07-27";

function jsonSafe(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? item.toString() : item
    )
  );
}

function csvEscape(value) {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

  return `"${text.replace(/"/g, '""')}"`;
}

function firstLine(value) {
  return String(value || "")
    .split(/\r?\n/)[0]
    .trim()
    .slice(0, 180);
}

function sourceType(row) {
  const text = `${row.notes || ""} ${row.issueReason || ""} ${row.deviceCode || ""}`.toUpperCase();

  if (text.includes("APRIL_IMPORT")) return "APRIL_IMPORT";
  if (text.includes("EXCEL") || text.includes("IMPORT")) return "EXCEL_OR_IMPORT";
  if (text.includes("FULLQR")) return "FULLQR";
  if (row.taskId) return "TASK_LINKED";
  return "UNCLASSIFIED";
}

async function tableColumns(tableName) {
  return prisma.$queryRawUnsafe(
    `SELECT "column_name", "data_type", "udt_name"
     FROM information_schema.columns
     WHERE "table_schema" = 'public'
       AND "table_name" = $1
     ORDER BY "ordinal_position"`,
    tableName
  );
}

async function main() {
  console.log("====================================================");
  console.log("SMART IT — 27 JULY COUNT DIAGNOSIS");
  console.log("READ ONLY — NO INSERT / UPDATE / DELETE");
  console.log(`Technician ID: ${TECHNICIAN_ID}`);
  console.log(`Date: ${TARGET_DATE}`);
  console.log("====================================================\n");

  const technicianRows = await prisma.$queryRawUnsafe(
    `SELECT *
     FROM "User"
     WHERE "id" = $1
     LIMIT 1`,
    TECHNICIAN_ID
  );

  const technician = technicianRows?.[0] || null;

  const inspections = await prisma.$queryRawUnsafe(
    `SELECT
       i.*,
       d."deviceCode",
       d."deviceName",
       d."serialNumber",
       d."ipAddress",
       d."gateCluster",
       d."gateBuilding",
       d."gateZone",
       d."gateDirection",
       g."gateNo",
       g."cluster" AS "gateCluster2",
       g."building" AS "gateBuilding2",
       g."zone" AS "gateZone2",
       g."direction" AS "gateDirection2"
     FROM "Inspection" i
     LEFT JOIN "Device" d ON d."id" = i."deviceId"
     LEFT JOIN "Gate" g ON g."id" = i."gateId"
     WHERE i."technicianId" = $1
       AND DATE(COALESCE(i."inspectedAt", i."createdAt")) = $2::date
     ORDER BY COALESCE(i."inspectedAt", i."createdAt") ASC`,
    TECHNICIAN_ID,
    TARGET_DATE
  );

  const uniqueDevices = new Set(
    inspections.map((r) => r.deviceId).filter((v) => v !== null && v !== undefined)
  );
  const uniqueGates = new Set(
    inspections.map((r) => r.gateId).filter((v) => v !== null && v !== undefined)
  );
  const uniqueAssets = new Set(
    inspections.map((r) =>
      r.deviceId
        ? `D:${r.deviceId}`
        : r.gateId
        ? `G:${r.gateId}`
        : `I:${r.id}`
    )
  );
  const uniqueTasks = new Set(
    inspections.map((r) => r.taskId).filter((v) => v !== null && v !== undefined)
  );

  const byStatus = {};
  const bySource = {};
  const byHour = {};
  const byAsset = new Map();
  const exactDuplicateMap = new Map();

  for (const row of inspections) {
    const status = String(row.inspectionStatus || "UNKNOWN");
    byStatus[status] = (byStatus[status] || 0) + 1;

    const src = sourceType(row);
    bySource[src] = (bySource[src] || 0) + 1;

    const dt = new Date(row.inspectedAt || row.createdAt);
    const hour = Number.isNaN(dt.getTime())
      ? "UNKNOWN"
      : String(dt.getUTCHours()).padStart(2, "0");
    byHour[hour] = (byHour[hour] || 0) + 1;

    const assetKey = row.deviceId
      ? `DEVICE:${row.deviceId}`
      : row.gateId
      ? `GATE:${row.gateId}`
      : `NO_ASSET:${row.id}`;

    if (!byAsset.has(assetKey)) byAsset.set(assetKey, []);
    byAsset.get(assetKey).push(row);

    const exactKey = [
      row.deviceId || "",
      row.gateId || "",
      new Date(row.inspectedAt || row.createdAt).toISOString(),
      status,
    ].join("|");

    if (!exactDuplicateMap.has(exactKey)) exactDuplicateMap.set(exactKey, []);
    exactDuplicateMap.get(exactKey).push(row);
  }

  const repeatedAssets = Array.from(byAsset.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([asset, rows]) => ({
      asset,
      count: rows.length,
      inspectionIds: rows.map((r) => r.id),
      first: rows[0].inspectedAt || rows[0].createdAt,
      last: rows[rows.length - 1].inspectedAt || rows[rows.length - 1].createdAt,
      deviceCode: rows[0].deviceCode || null,
      ipAddress: rows[0].ipAddress || null,
    }))
    .sort((a, b) => b.count - a.count);

  const exactDuplicateGroups = Array.from(exactDuplicateMap.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({
      key,
      count: rows.length,
      inspectionIds: rows.map((r) => r.id),
    }))
    .sort((a, b) => b.count - a.count);

  const taskLinked = inspections.filter((r) => r.taskId !== null && r.taskId !== undefined);
  const withoutTask = inspections.filter((r) => r.taskId === null || r.taskId === undefined);
  const importLike = inspections.filter((r) =>
    /APRIL_IMPORT|EXCEL|IMPORT/i.test(`${r.notes || ""} ${r.issueReason || ""}`)
  );

  // Discover how InspectionTaskItem identifies technician/user and completion date.
  const taskItemColumns = await tableColumns("InspectionTaskItem");
  const taskItemColumnNames = new Set(taskItemColumns.map((c) => c.column_name));

  const possibleUserColumns = [
    "technicianId",
    "completedById",
    "userId",
    "assignedToId",
    "createdById",
  ].filter((name) => taskItemColumnNames.has(name));

  const possibleDateColumns = [
    "inspectedAt",
    "completedAt",
    "updatedAt",
    "createdAt",
    "startedAt",
  ].filter((name) => taskItemColumnNames.has(name));

  let matchingTaskItems = [];
  let taskItemQuery = null;

  if (possibleUserColumns.length && possibleDateColumns.length) {
    const userWhere = possibleUserColumns
      .map((name) => `"${name}" = $1`)
      .join(" OR ");

    const dateWhere = possibleDateColumns
      .map((name) => `DATE("${name}") = $2::date`)
      .join(" OR ");

    taskItemQuery = `SELECT *
                     FROM "InspectionTaskItem"
                     WHERE (${userWhere})
                       AND (${dateWhere})
                     ORDER BY COALESCE(${possibleDateColumns
                       .map((name) => `"${name}"`)
                       .join(", ")}) ASC`;

    matchingTaskItems = await prisma.$queryRawUnsafe(
      taskItemQuery,
      TECHNICIAN_ID,
      TARGET_DATE
    );
  }

  const summary = {
    technicianId: TECHNICIAN_ID,
    technicianName:
      technician?.fullName ||
      technician?.name ||
      technician?.username ||
      technician?.email ||
      null,
    targetDate: TARGET_DATE,

    rawInspectionRows: inspections.length,
    uniqueDeviceIds: uniqueDevices.size,
    uniqueGateIds: uniqueGates.size,
    uniqueAssets: uniqueAssets.size,
    uniqueTaskIds: uniqueTasks.size,

    taskLinkedInspectionRows: taskLinked.length,
    inspectionRowsWithoutTask: withoutTask.length,
    importLikeInspectionRows: importLike.length,

    repeatedAssetCount: repeatedAssets.length,
    exactDuplicateGroupCount: exactDuplicateGroups.length,

    matchingInspectionTaskItems: matchingTaskItems.length,
    taskItemUserColumnsFound: possibleUserColumns,
    taskItemDateColumnsFound: possibleDateColumns,

    byStatus,
    bySource,
    byUtcHour: byHour,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    technician: jsonSafe(technician),
    summary,
    repeatedAssets,
    exactDuplicateGroups,
    taskItemSchema: jsonSafe(taskItemColumns),
    matchingTaskItems: jsonSafe(matchingTaskItems),
    inspectionRows: jsonSafe(inspections),
    suspiciousRows: jsonSafe(
      inspections
        .filter(
          (r) =>
            !r.taskId ||
            /APRIL_IMPORT|EXCEL|IMPORT/i.test(`${r.notes || ""} ${r.issueReason || ""}`)
        )
        .map((r) => ({
          inspectionId: r.id,
          inspectedAt: r.inspectedAt,
          createdAt: r.createdAt,
          deviceId: r.deviceId,
          gateId: r.gateId,
          taskId: r.taskId,
          deviceCode: r.deviceCode,
          ipAddress: r.ipAddress,
          status: r.inspectionStatus,
          source: sourceType(r),
          noteFirstLine: firstLine(r.notes),
        }))
    ),
  };

  const outputJson = path.join(
    process.cwd(),
    "technician-51-july-27-count-diagnosis.json"
  );
  fs.writeFileSync(outputJson, JSON.stringify(report, null, 2), "utf8");

  const csvHeaders = [
    "id",
    "technicianId",
    "inspectedAt",
    "createdAt",
    "deviceId",
    "gateId",
    "taskId",
    "inspectionStatus",
    "deviceCode",
    "deviceName",
    "serialNumber",
    "ipAddress",
    "gateCluster",
    "gateBuilding",
    "gateZone",
    "gateDirection",
    "issueReason",
    "notes",
  ];

  const csv = [
    csvHeaders.map(csvEscape).join(","),
    ...inspections.map((row) =>
      csvHeaders.map((key) => csvEscape(row[key])).join(",")
    ),
  ].join("\n");

  const outputCsv = path.join(
    process.cwd(),
    "technician-51-july-27-all-259-rows.csv"
  );
  fs.writeFileSync(outputCsv, "\uFEFF" + csv, "utf8");

  console.log("SUMMARY:");
  console.log(JSON.stringify(summary, null, 2));

  console.log("\nTOP REPEATED ASSETS:");
  console.log(JSON.stringify(repeatedAssets.slice(0, 20), null, 2));

  console.log("\n====================================================");
  console.log(`JSON report: ${outputJson}`);
  console.log(`CSV rows:    ${outputCsv}`);
  console.log("Nothing was inserted, updated, or deleted.");
  console.log("====================================================");
}

main()
  .catch((error) => {
    console.error("\nDiagnosis failed:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });