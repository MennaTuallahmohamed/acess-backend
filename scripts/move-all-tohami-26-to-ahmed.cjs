const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();

/*
  SMART IT — MOVE ALL TOHAMI INSPECTIONS TO AHMED HOSNY
  ------------------------------------------------------
  Date in Cairo local time: 2026-07-26
  From: Tohami ID 46
  To: Ahmed Hosny ID 51
  Expected source rows: exactly 42

  Preview only:
    node scripts/move-all-tohami-26-to-ahmed.cjs

  Apply:
    node scripts/move-all-tohami-26-to-ahmed.cjs --apply

  The script:
  - creates JSON and CSV backups before changing anything
  - refuses to run if Tohami does not have exactly 42 inspections
  - updates all 42 inspections inside one transaction
  - updates linked task-item completedById only when it is 46
  - does not touch ProblemTicket or IssueSolution
  - verifies Tohami becomes 0 and Ahmed increases by exactly 42
*/

const FROM_TECHNICIAN_ID = 46; // Mohamed Tohami
const TO_TECHNICIAN_ID = 51;   // Ahmed Hosny
const TARGET_DATE = "2026-07-26";
const EXPECTED_TOHAMI_COUNT = 42;
const TIME_ZONE = "Africa/Cairo";
const APPLY = process.argv.includes("--apply");

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

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function tableExists(client, tableName) {
  const rows = await client.$queryRawUnsafe(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = $1
     ) AS "exists"`,
    tableName
  );

  return Boolean(rows[0]?.exists);
}

async function tableColumns(client, tableName) {
  const rows = await client.$queryRawUnsafe(
    `SELECT "column_name"
       FROM information_schema.columns
      WHERE "table_schema" = 'public'
        AND "table_name" = $1`,
    tableName
  );

  return new Set(rows.map((row) => row.column_name));
}

async function getUsers(client) {
  return client.$queryRawUnsafe(
    `SELECT "id",
            COALESCE("fullName", "username", "email", "id"::text) AS "displayName",
            "username",
            "email"
       FROM "User"
      WHERE "id" IN ($1, $2)
      ORDER BY "id"`,
    FROM_TECHNICIAN_ID,
    TO_TECHNICIAN_ID
  );
}

async function getDailyCounts(client) {
  return client.$queryRawUnsafe(
    `SELECT i."technicianId",
            COALESCE(u."fullName", u."username", u."email", u."id"::text) AS "technicianName",
            COUNT(*)::int AS "count",
            MIN(COALESCE(i."inspectedAt", i."createdAt")) AS "firstInspection",
            MAX(COALESCE(i."inspectedAt", i."createdAt")) AS "lastInspection"
       FROM "Inspection" i
       JOIN "User" u ON u."id" = i."technicianId"
      WHERE i."technicianId" IN ($1, $2)
        AND DATE(COALESCE(i."inspectedAt", i."createdAt") AT TIME ZONE $4) = $3::date
      GROUP BY i."technicianId", u."id", u."fullName", u."username", u."email"
      ORDER BY i."technicianId"`,
    FROM_TECHNICIAN_ID,
    TO_TECHNICIAN_ID,
    TARGET_DATE,
    TIME_ZONE
  );
}

async function getTohamiRows(client, lockRows = false) {
  const lockClause = lockRows ? `FOR UPDATE OF i` : ``;

  return client.$queryRawUnsafe(
    `SELECT
        i."id" AS "inspectionId",
        i."technicianId",
        i."deviceId",
        i."gateId",
        i."glassId",
        i."taskId",
        i."inspectionStatus"::text AS "inspectionStatus",
        i."inspectedAt",
        i."createdAt",
        i."updatedAt",
        i."issueReason",
        i."notes",
        i."locationText",

        d."deviceCode",
        d."deviceName",
        d."serialNumber",
        d."barcode",
        d."ipAddress",

        g."gateNo",
        g."secretCode" AS "gateSecretCode",

        t."assignedToId" AS "taskAssignedToId",

        ti."id" AS "taskItemId",
        ti."assignedToId" AS "taskItemAssignedToId",
        ti."completedById" AS "taskItemCompletedById",
        ti."inspectionId" AS "taskItemInspectionId",
        ti."status"::text AS "taskItemStatus",
        ti."inspectedAt" AS "taskItemInspectedAt"

      FROM "Inspection" i

      LEFT JOIN "Device" d
        ON d."id" = i."deviceId"

      LEFT JOIN "Gate" g
        ON g."id" = i."gateId"

      LEFT JOIN "InspectionTask" t
        ON t."id" = i."taskId"

      LEFT JOIN LATERAL (
        SELECT x.*
          FROM "InspectionTaskItem" x
         WHERE
           x."inspectionId" = i."id"
           OR (
             x."taskId" = i."taskId"
             AND (
               (i."deviceId" IS NOT NULL AND x."deviceId" = i."deviceId")
               OR (i."gateId" IS NOT NULL AND x."gateId" = i."gateId")
               OR (i."glassId" IS NOT NULL AND x."glassId" = i."glassId")
             )
           )
         ORDER BY
           CASE WHEN x."inspectionId" = i."id" THEN 0 ELSE 1 END,
           x."id"
         LIMIT 1
      ) ti ON TRUE

      WHERE i."technicianId" = $1
        AND DATE(COALESCE(i."inspectedAt", i."createdAt") AT TIME ZONE $3) = $2::date

      ORDER BY COALESCE(i."inspectedAt", i."createdAt"), i."id"
      ${lockClause}`,
    FROM_TECHNICIAN_ID,
    TARGET_DATE,
    TIME_ZONE
  );
}

async function updateLinkedTaskItems(tx, idListSql) {
  if (!(await tableExists(tx, "InspectionTaskItem"))) {
    return 0;
  }

  const cols = await tableColumns(tx, "InspectionTaskItem");

  if (!cols.has("inspectionId") || !cols.has("completedById")) {
    return 0;
  }

  const updatedAtSql = cols.has("updatedAt")
    ? `, "updatedAt" = NOW()`
    : ``;

  const count = await tx.$executeRawUnsafe(
    `UPDATE "InspectionTaskItem"
        SET "completedById" = ${TO_TECHNICIAN_ID}
            ${updatedAtSql}
      WHERE "inspectionId" IN (${idListSql})
        AND "completedById" = ${FROM_TECHNICIAN_ID}`
  );

  return Number(count);
}

async function updateLinkedActivityLogs(tx, idListSql) {
  if (!(await tableExists(tx, "TechnicianActivityLog"))) {
    return 0;
  }

  const cols = await tableColumns(tx, "TechnicianActivityLog");

  if (!cols.has("inspectionId") || !cols.has("userId")) {
    return 0;
  }

  const count = await tx.$executeRawUnsafe(
    `UPDATE "TechnicianActivityLog"
        SET "userId" = ${TO_TECHNICIAN_ID}
      WHERE "inspectionId" IN (${idListSql})
        AND "userId" = ${FROM_TECHNICIAN_ID}`
  );

  return Number(count);
}

async function main() {
  console.log("============================================================");
  console.log("MOVE ALL TOHAMI INSPECTIONS TO AHMED HOSNY");
  console.log(`Cairo date: ${TARGET_DATE}`);
  console.log(`From technician ID: ${FROM_TECHNICIAN_ID}`);
  console.log(`To technician ID:   ${TO_TECHNICIAN_ID}`);
  console.log(`Expected rows:       ${EXPECTED_TOHAMI_COUNT}`);
  console.log(`Mode: ${APPLY ? "APPLY" : "READ-ONLY PREVIEW"}`);
  console.log("============================================================\n");

  const users = await getUsers(prisma);

  if (users.length !== 2) {
    throw new Error(
      `Expected users 46 and 51, but found ${users.length}. No changes were made.`
    );
  }

  const beforeCounts = await getDailyCounts(prisma);
  const rows = await getTohamiRows(prisma, false);

  const ahmedBefore =
    beforeCounts.find((row) => Number(row.technicianId) === TO_TECHNICIAN_ID)?.count || 0;

  const tohamiBefore =
    beforeCounts.find((row) => Number(row.technicianId) === FROM_TECHNICIAN_ID)?.count || 0;

  const predictedAhmedAfter = ahmedBefore + rows.length;
  const predictedTohamiAfter = tohamiBefore - rows.length;

  const summary = {
    targetDate: TARGET_DATE,
    timeZone: TIME_ZONE,
    mode: APPLY ? "APPLY" : "READ_ONLY",
    fromTechnicianId: FROM_TECHNICIAN_ID,
    toTechnicianId: TO_TECHNICIAN_ID,
    ahmedBefore,
    tohamiBefore,
    rowsSelectedForMove: rows.length,
    predictedAhmedAfter,
    predictedTohamiAfter,
  };

  const stamp = safeTimestamp();

  const backupJsonPath = path.join(
    process.cwd(),
    `tohami-26-to-ahmed-backup-${stamp}.json`
  );

  const backupCsvPath = path.join(
    process.cwd(),
    `tohami-26-to-ahmed-backup-${stamp}.csv`
  );

  fs.writeFileSync(
    backupJsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        users: jsonSafe(users),
        summary,
        beforeCounts: jsonSafe(beforeCounts),
        inspectionsBeforeUpdate: jsonSafe(rows),
      },
      null,
      2
    ),
    "utf8"
  );

  const headers = [
    "inspectionId",
    "technicianId",
    "deviceId",
    "deviceCode",
    "deviceName",
    "serialNumber",
    "barcode",
    "gateId",
    "gateNo",
    "glassId",
    "taskId",
    "taskAssignedToId",
    "taskItemId",
    "taskItemAssignedToId",
    "taskItemCompletedById",
    "inspectionStatus",
    "inspectedAt",
    "createdAt",
    "updatedAt",
    "locationText",
    "issueReason",
    "notes",
  ];

  const csv = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) =>
      headers.map((key) => csvEscape(row[key])).join(",")
    ),
  ].join("\n");

  fs.writeFileSync(backupCsvPath, "\uFEFF" + csv, "utf8");

  console.log("USERS:");
  console.log(JSON.stringify(jsonSafe(users), null, 2));

  console.log("\nSUMMARY:");
  console.log(JSON.stringify(summary, null, 2));

  console.log("\nBACKUPS:");
  console.log(`JSON: ${backupJsonPath}`);
  console.log(`CSV:  ${backupCsvPath}`);

  if (rows.length !== EXPECTED_TOHAMI_COUNT || tohamiBefore !== EXPECTED_TOHAMI_COUNT) {
    throw new Error(
      [
        "SAFETY ABORT.",
        `The script expected exactly ${EXPECTED_TOHAMI_COUNT} Tohami inspections,`,
        `but the daily count is ${tohamiBefore} and selected rows are ${rows.length}.`,
        "Nothing was changed. Check the date/time zone and run preview again.",
      ].join("\n")
    );
  }

  if (!APPLY) {
    console.log("\nPREVIEW COMPLETED.");
    console.log("Nothing was inserted, updated, or deleted.");
    console.log(`Ahmed will change from ${ahmedBefore} to ${predictedAhmedAfter}.`);
    console.log(`Tohami will change from ${tohamiBefore} to ${predictedTohamiAfter}.`);
    console.log("\nAfter checking the CSV backup, run:");
    console.log("node scripts/move-all-tohami-26-to-ahmed.cjs --apply");
    return;
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const lockedRows = await getTohamiRows(tx, true);
      const lockedCounts = await getDailyCounts(tx);

      const lockedAhmedBefore =
        lockedCounts.find(
          (row) => Number(row.technicianId) === TO_TECHNICIAN_ID
        )?.count || 0;

      const lockedTohamiBefore =
        lockedCounts.find(
          (row) => Number(row.technicianId) === FROM_TECHNICIAN_ID
        )?.count || 0;

      if (
        lockedRows.length !== EXPECTED_TOHAMI_COUNT ||
        lockedTohamiBefore !== EXPECTED_TOHAMI_COUNT
      ) {
        throw new Error(
          "Database data changed after preview. Transaction cancelled."
        );
      }

      const ids = lockedRows.map((row) => Number(row.inspectionId));

      if (
        ids.length !== EXPECTED_TOHAMI_COUNT ||
        ids.some((id) => !Number.isInteger(id) || id <= 0)
      ) {
        throw new Error("Invalid inspection IDs. Transaction cancelled.");
      }

      const idListSql = ids.join(",");

      const updatedInspections = Number(
        await tx.$executeRawUnsafe(
          `UPDATE "Inspection"
              SET "technicianId" = ${TO_TECHNICIAN_ID},
                  "updatedAt" = NOW()
            WHERE "id" IN (${idListSql})
              AND "technicianId" = ${FROM_TECHNICIAN_ID}`
        )
      );

      if (updatedInspections !== EXPECTED_TOHAMI_COUNT) {
        throw new Error(
          `Expected to update ${EXPECTED_TOHAMI_COUNT} inspections, but updated ${updatedInspections}.`
        );
      }

      const updatedTaskItems = await updateLinkedTaskItems(tx, idListSql);
      const updatedActivityLogs = await updateLinkedActivityLogs(tx, idListSql);

      const afterCounts = await getDailyCounts(tx);

      const ahmedAfter =
        afterCounts.find(
          (row) => Number(row.technicianId) === TO_TECHNICIAN_ID
        )?.count || 0;

      const tohamiAfter =
        afterCounts.find(
          (row) => Number(row.technicianId) === FROM_TECHNICIAN_ID
        )?.count || 0;

      if (ahmedAfter !== lockedAhmedBefore + EXPECTED_TOHAMI_COUNT) {
        throw new Error(
          `Ahmed final verification failed. Expected ${
            lockedAhmedBefore + EXPECTED_TOHAMI_COUNT
          }, found ${ahmedAfter}.`
        );
      }

      if (tohamiAfter !== 0) {
        throw new Error(
          `Tohami final verification failed. Expected 0, found ${tohamiAfter}.`
        );
      }

      return {
        movedInspectionIds: ids,
        updatedInspections,
        updatedTaskItems,
        updatedActivityLogs,
        before: {
          ahmed: lockedAhmedBefore,
          tohami: lockedTohamiBefore,
        },
        after: {
          ahmed: ahmedAfter,
          tohami: tohamiAfter,
        },
      };
    },
    {
      maxWait: 10000,
      timeout: 60000,
    }
  );

  const resultPath = path.join(
    process.cwd(),
    `tohami-26-to-ahmed-APPLIED-${safeTimestamp()}.json`
  );

  fs.writeFileSync(
    resultPath,
    JSON.stringify(
      {
        appliedAt: new Date().toISOString(),
        backupJsonPath,
        backupCsvPath,
        result: jsonSafe(result),
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("\n============================================================");
  console.log("SUCCESS: ALL 42 INSPECTIONS MOVED TO AHMED HOSNY");
  console.log(JSON.stringify(jsonSafe(result), null, 2));
  console.log(`Result file: ${resultPath}`);
  console.log("============================================================");
}

main()
  .catch((error) => {
    console.error("\nFAILED:");
    console.error(error?.stack || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });