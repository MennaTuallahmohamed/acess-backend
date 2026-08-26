const fs = require("fs");
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");
const readline = require("readline");

const prisma = new PrismaClient();

const IDS_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\PROTECTED_641_IDS.json";
const REPORT_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\PROTECTED_641_DRY_RUN.csv";

function clean(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function norm(v) {
  return clean(v).toLowerCase();
}

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

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

function loadReservedRows() {
  if (!fs.existsSync(REPORT_FILE)) {
    throw new Error(`Protection report not found: ${REPORT_FILE}`);
  }

  const wb = XLSX.readFile(REPORT_FILE, { raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });

  return rows.filter((r) => norm(r.STATUS) === "not_found");
}

function rowMatches(row, q) {
  const fields = Object.values(row);
  return fields.some((v) => norm(v).includes(q));
}

async function main() {
  const protectedIds = loadProtectedIds();     // currently 640 in DB
  const reservedRows = loadReservedRows();     // currently 1 reserved = Device 852

  const dbRows = await prisma.$queryRawUnsafe(`
    SELECT
      d."id",
      d."deviceCode",
      d."serialNumber",
      d."ipAddress",
      d."secretCode",
      d."assetType"::text AS "assetType",
      l."cluster",
      l."building",
      l."zone",
      l."lane",
      l."direction"
    FROM "Device" d
    LEFT JOIN "Location" l ON l."id" = d."locationId"
    WHERE d."assetType"::text = 'DEVICE'
      AND d."id" = ANY($1::int[])
    ORDER BY d."id"
  `, protectedIds);

  console.log("============================================================");
  console.log(" SEARCH KEEP 641");
  console.log(" READ ONLY - NO UPDATE / DELETE / INSERT");
  console.log("============================================================");
  console.log(`KEEP total                : ${protectedIds.length + reservedRows.length}`);
  console.log(`Present in backend        : ${dbRows.length}`);
  console.log(`Reserved / missing        : ${reservedRows.length}`);
  console.log("");

  let term = process.argv.slice(2).join(" ").trim();

  if (!term) {
    term = await ask(
      "Search IP / Serial / Device Code / Secret / Backend ID / Location: "
    );
  }

  const q = norm(term);

  const dbMatches = dbRows.filter((r) =>
    [
      r.id,
      r.deviceCode,
      r.serialNumber,
      r.ipAddress,
      r.secretCode,
      r.cluster,
      r.building,
      r.zone,
      r.lane,
      r.direction,
    ].some((v) => norm(v).includes(q))
  );

  const reservedMatches = reservedRows.filter((r) =>
    rowMatches(r, q)
  );

  const totalMatches = dbMatches.length + reservedMatches.length;

  console.log("");
  console.log("============================================================");
  console.log(`SEARCH: ${term}`);
  console.log(`MATCHES: ${totalMatches}`);
  console.log("============================================================");

  dbMatches.forEach((r, i) => {
    console.log("");
    console.log(`MATCH ${i + 1} ✅ KEEP / PRESENT IN BACKEND`);
    console.log("------------------------------------------------------------");
    console.log(`Backend ID  : ${r.id}`);
    console.log(`Device Code : ${r.deviceCode ?? ""}`);
    console.log(`IP          : ${r.ipAddress ?? ""}`);
    console.log(`Serial      : ${r.serialNumber ?? ""}`);
    console.log(`Secret Code : ${r.secretCode ?? ""}`);
    console.log(`Cluster     : ${r.cluster ?? ""}`);
    console.log(`Building    : ${r.building ?? ""}`);
    console.log(`Zone        : ${r.zone ?? ""}`);
    console.log(`Lane        : ${r.lane ?? ""}`);
    console.log(`Direction   : ${r.direction ?? ""}`);
  });

  reservedMatches.forEach((r, i) => {
    console.log("");
    console.log(`MATCH ${dbMatches.length + i + 1} 🔒 KEEP / RESERVED`);
    console.log("------------------------------------------------------------");
    console.log(`Backend ID  : NOT CREATED AS DEVICE YET`);
    console.log(`Device Code : ${r.INPUT_DEVICE_CODE ?? ""}`);
    console.log(`IP          : ${r.INPUT_IP ?? ""}`);
    console.log(`Serial      : ${r.INPUT_SERIAL || ""}`);
    console.log(`Secret Code : ${r.INPUT_SECRET ?? ""}`);
    console.log(`Cluster     : ${r.INPUT_CLUSTER ?? ""}`);
    console.log(`Building    : ${r.INPUT_BUILDING ?? ""}`);
    console.log(`Zone        : ${r.INPUT_ZONE ?? ""}`);
    console.log(`Lane        : ${r.INPUT_LANE ?? ""}`);
    console.log(`Direction   : ${r.INPUT_DIRECTION ?? ""}`);
    console.log(`Status      : RESERVED - DO NOT DELETE`);
  });

  if (!totalMatches) {
    console.log("");
    console.log("❌ No match found inside KEEP 641.");
  }

  console.log("");
  console.log("============================================================");
  console.log("READ ONLY ✅  NO DATABASE CHANGES");
  console.log("============================================================");
}

main()
  .catch((err) => {
    console.error("");
    console.error("❌ ERROR:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
