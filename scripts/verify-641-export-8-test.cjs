const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const IDS_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\PROTECTED_641_IDS.json";

const OUTPUT_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\TEST_8_FROM_KEEP_641.xlsx";

const EXPECTED_KEEP = 641;
const SAMPLE_COUNT = 8;

function clean(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function loadKeepIds() {
  if (!fs.existsSync(IDS_FILE)) {
    throw new Error(`KEEP IDs file not found: ${IDS_FILE}`);
  }

  const data = JSON.parse(fs.readFileSync(IDS_FILE, "utf8"));
  const ids = Array.isArray(data.protectedBackendIds)
    ? data.protectedBackendIds.map(Number).filter(Number.isFinite)
    : [];

  return [...new Set(ids)];
}

function numericCode(v) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

async function main() {
  console.log("============================================================");
  console.log(" VERIFY 641 + EXPORT 8 TEST DEVICES");
  console.log(" READ ONLY - NO DELETE / UPDATE / INSERT");
  console.log("============================================================");

  const keepIds = loadKeepIds();

  if (keepIds.length !== EXPECTED_KEEP) {
    throw new Error(
      `SAFETY STOP: protected IDs=${keepIds.length}, expected ${EXPECTED_KEEP}.`
    );
  }

  const allRows = await prisma.device.findMany({
    include: {
      location: true,
      deviceType: true,
    },
    orderBy: { id: "asc" },
  });

  const keepSet = new Set(keepIds.map(Number));
  const keepRows = allRows.filter((d) => keepSet.has(Number(d.id)));
  const outsideKeep = allRows.filter((d) => !keepSet.has(Number(d.id)));

  console.log("");
  console.log("FINAL BACKEND VERIFICATION");
  console.log("------------------------------------------------------------");
  console.log(`Device table total       : ${allRows.length}`);
  console.log(`Protected KEEP found     : ${keepRows.length} / 641`);
  console.log(`Rows outside KEEP        : ${outsideKeep.length}`);

  if (
    allRows.length !== EXPECTED_KEEP ||
    keepRows.length !== EXPECTED_KEEP ||
    outsideKeep.length !== 0
  ) {
    throw new Error(
      "SAFETY STOP: backend is not exactly the protected 641 rows."
    );
  }

  console.log("✅ EXACTLY 641 PROTECTED ROWS EXIST.");
  console.log("");

  const withSecret = keepRows
    .filter((d) => clean(d.secretCode) !== "")
    .sort((a, b) => {
      const na = numericCode(a.deviceCode);
      const nb = numericCode(b.deviceCode);
      if (na !== nb) return na - nb;
      return Number(a.id) - Number(b.id);
    });

  if (withSecret.length < SAMPLE_COUNT) {
    throw new Error(
      `Only ${withSecret.length} KEEP devices have a Secret Code; need ${SAMPLE_COUNT}.`
    );
  }

  // Prefer 8 devices from different clusters for a wider physical test.
  const selected = [];
  const usedClusters = new Set();

  for (const d of withSecret) {
    const cluster = clean(d.location?.cluster).toLowerCase() || "(no cluster)";
    if (!usedClusters.has(cluster)) {
      selected.push(d);
      usedClusters.add(cluster);
    }
    if (selected.length === SAMPLE_COUNT) break;
  }

  // If fewer than 8 unique clusters exist, fill with remaining devices.
  if (selected.length < SAMPLE_COUNT) {
    const selectedIds = new Set(selected.map((d) => Number(d.id)));
    for (const d of withSecret) {
      if (!selectedIds.has(Number(d.id))) {
        selected.push(d);
        selectedIds.add(Number(d.id));
      }
      if (selected.length === SAMPLE_COUNT) break;
    }
  }

  const rows = selected.map((d, i) => ({
    "No.": i + 1,
    "Backend ID": d.id,
    "Device Code": clean(d.deviceCode),
    "Secret Code": clean(d.secretCode),
    "IP": clean(d.ipAddress),
    "Serial": clean(d.serialNumber),
    "Device Type": clean(d.deviceType?.name),
    "Cluster": clean(d.location?.cluster),
    "Building": clean(d.location?.building),
    "Zone": clean(d.location?.zone),
    "Lane": clean(d.location?.lane),
    "Direction": clean(d.location?.direction),
  }));

  console.log("8 TEST DEVICES");
  console.log("------------------------------------------------------------");

  for (const r of rows) {
    console.log("");
    console.log(`TEST ${r["No."]} / 8`);
    console.log(`Device Code : ${r["Device Code"]}`);
    console.log(`Secret Code : ${r["Secret Code"]}`);
    console.log(`IP          : ${r["IP"] || "-"}`);
    console.log(`Serial      : ${r["Serial"] || "-"}`);
    console.log(`Cluster     : ${r["Cluster"] || "-"}`);
    console.log(`Building    : ${r["Building"] || "-"}`);
    console.log(`Zone        : ${r["Zone"] || "-"}`);
    console.log(`Lane        : ${r["Lane"] || "-"}`);
    console.log(`Direction   : ${r["Direction"] || "-"}`);
  }

  const wb = XLSX.utils.book_new();

  const dataWs = XLSX.utils.json_to_sheet(rows);
  dataWs["!cols"] = [
    { wch: 6 },
    { wch: 12 },
    { wch: 14 },
    { wch: 30 },
    { wch: 18 },
    { wch: 22 },
    { wch: 18 },
    { wch: 18 },
    { wch: 35 },
    { wch: 24 },
    { wch: 10 },
    { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, dataWs, "Test 8 Data");

  // Simple print sheet: only the fields useful on a test label.
  const labelRows = selected.map((d, i) => ({
    "Label": `TEST ${i + 1}`,
    "Device Code": clean(d.deviceCode),
    "Secret Code": clean(d.secretCode),
    "Cluster": clean(d.location?.cluster),
    "Building": clean(d.location?.building),
    "Zone": clean(d.location?.zone),
    "Lane": clean(d.location?.lane),
  }));

  const labelWs = XLSX.utils.json_to_sheet(labelRows);
  labelWs["!cols"] = [
    { wch: 12 },
    { wch: 14 },
    { wch: 32 },
    { wch: 18 },
    { wch: 35 },
    { wch: 24 },
    { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, labelWs, "Print 8");

  XLSX.writeFile(wb, OUTPUT_FILE);

  console.log("");
  console.log("============================================================");
  console.log(" SUCCESS ✅");
  console.log("============================================================");
  console.log("Backend total            : 641");
  console.log("Protected KEEP found     : 641 / 641");
  console.log("Outside KEEP             : 0");
  console.log("Test devices exported    : 8");
  console.log(`Excel                     : ${OUTPUT_FILE}`);
  console.log("");
  console.log("✅ READ ONLY: DATABASE WAS NOT CHANGED.");
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
