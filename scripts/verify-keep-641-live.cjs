const fs = require("fs");
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const REPORT_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\PROTECTED_641_DRY_RUN.csv";

const EXPECTED_KEEP = 641;

function clean(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function upper(v) {
  return clean(v).toUpperCase();
}

function loadReport() {
  if (!fs.existsSync(REPORT_FILE)) {
    throw new Error(`Report file not found: ${REPORT_FILE}`);
  }

  const wb = XLSX.readFile(REPORT_FILE, { raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
}

async function main() {
  console.log("============================================================");
  console.log(" VERIFY KEEP 641 - LIVE");
  console.log(" READ ONLY - NO UPDATE / DELETE / INSERT");
  console.log("============================================================");

  const reportRows = loadReport();

  if (reportRows.length !== EXPECTED_KEEP) {
    throw new Error(
      `Expected ${EXPECTED_KEEP} KEEP rows, but report contains ${reportRows.length}.`
    );
  }

  const protectedIds = reportRows
    .filter((r) => upper(r.STATUS) === "PROTECTED")
    .map((r) => Number(r.BACKEND_ID))
    .filter(Number.isFinite);

  const dbRows = await prisma.$queryRawUnsafe(`
    SELECT
      d."id",
      d."deviceCode",
      d."serialNumber",
      d."ipAddress",
      d."secretCode",
      d."assetType"::text AS "assetType"
    FROM "Device" d
    WHERE d."assetType"::text = 'DEVICE'
      AND d."id" = ANY($1::int[])
    ORDER BY d."id"
  `, protectedIds);

  const byId = new Map(dbRows.map((r) => [Number(r.id), r]));

  let foundInBackend = 0;
  let reserved = 0;
  let missingProtected = 0;
  let invalid = 0;

  console.log("");

  for (let i = 0; i < reportRows.length; i++) {
    const r = reportRows[i];
    const status = upper(r.STATUS);
    const keepNo = i + 1;

    if (status === "PROTECTED") {
      const backendId = Number(r.BACKEND_ID);
      const db = byId.get(backendId);

      if (db) {
        foundInBackend++;
        console.log(
          `KEEP ${String(keepNo).padStart(3, " ")} / 641  → FOUND ✅` +
          `   Backend ID: ${db.id}` +
          `   DeviceCode: ${db.deviceCode ?? "-"}` +
          `   IP: ${db.ipAddress ?? "-"}` +
          `   Serial: ${db.serialNumber ?? "-"}`
        );
      } else {
        missingProtected++;
        console.log(
          `KEEP ${String(keepNo).padStart(3, " ")} / 641  → MISSING FROM BACKEND ❌` +
          `   Expected Backend ID: ${r.BACKEND_ID}`
        );
      }

      continue;
    }

    if (status === "NOT_FOUND") {
      reserved++;
      console.log(
        `KEEP ${String(keepNo).padStart(3, " ")} / 641  → RESERVED ✅` +
        `   DeviceCode: ${r.INPUT_DEVICE_CODE || "-"}` +
        `   IP: ${r.INPUT_IP || "-"}` +
        `   Secret: ${r.INPUT_SECRET || "-"}`
      );
      continue;
    }

    invalid++;
    console.log(
      `KEEP ${String(keepNo).padStart(3, " ")} / 641  → UNRESOLVED ⚠️` +
      `   STATUS: ${r.STATUS || "-"}`
    );
  }

  const keepVerified = foundInBackend + reserved;

  console.log("");
  console.log("============================================================");
  console.log(" FINAL KEEP SUMMARY");
  console.log("============================================================");
  console.log(`KEEP LIST TOTAL           : ${reportRows.length}`);
  console.log(`FOUND IN BACKEND          : ${foundInBackend}`);
  console.log(`RESERVED KEEP             : ${reserved}`);
  console.log(`MISSING PROTECTED IDs     : ${missingProtected}`);
  console.log(`UNRESOLVED                : ${invalid}`);
  console.log(`KEEP VERIFIED             : ${keepVerified} / ${EXPECTED_KEEP}`);
  console.log("");

  if (
    keepVerified === EXPECTED_KEEP &&
    foundInBackend === 640 &&
    reserved === 1 &&
    missingProtected === 0 &&
    invalid === 0
  ) {
    console.log("✅ KEEP VERIFIED: 641 / 641");
    console.log("✅ 640 FOUND IN BACKEND + 1 RESERVED KEEP");
    console.log("✅ NO DATABASE CHANGES WERE MADE.");
  } else {
    console.log("❌ KEEP VERIFICATION FAILED.");
    console.log("❌ DO NOT DELETE OR UPDATE ANYTHING.");
    console.log("✅ NO DATABASE CHANGES WERE MADE.");
    process.exitCode = 3;
  }
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
