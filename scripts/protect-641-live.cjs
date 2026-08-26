const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const EXPECTED_KEEP = 641;

function clean(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function normalizeArabic(s) {
  return clean(s)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "") // Arabic diacritics + tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

function normLoose(v) {
  return normalizeArabic(v)
    .replace(/[^0-9a-z\u0600-\u06FF]+/gi, "");
}

function normIp(v) {
  return clean(v).replace(/\s+/g, "");
}

function normSerial(v) {
  return clean(v).toUpperCase().replace(/\s+/g, "");
}

function normSecret(v) {
  return clean(v).toUpperCase().replace(/\s+/g, "");
}

function findHeader(row, aliases) {
  const headers = Object.keys(row);
  for (const alias of aliases) {
    const target = normLoose(alias);
    const found = headers.find((h) => normLoose(h) === target);
    if (found) return found;
  }
  return null;
}

function getFirst(row, aliases) {
  const h = findHeader(row, aliases);
  return h ? clean(row[h]) : "";
}

function csvEscape(v) {
  const s = clean(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(filePath, rows) {
  const headers = [
    "ROW",
    "STATUS",
    "MATCH_RULE",
    "INPUT_DEVICE_CODE",
    "INPUT_IP",
    "INPUT_SERIAL",
    "INPUT_SECRET",
    "INPUT_CLUSTER",
    "INPUT_BUILDING",
    "INPUT_ZONE",
    "INPUT_LANE",
    "INPUT_DIRECTION",
    "BACKEND_ID",
    "BACKEND_DEVICE_CODE",
    "BACKEND_IP",
    "BACKEND_SERIAL",
    "BACKEND_SECRET",
    "BACKEND_CLUSTER",
    "BACKEND_BUILDING",
    "BACKEND_ZONE",
    "BACKEND_LANE",
    "BACKEND_DIRECTION",
    "CANDIDATE_COUNT",
  ];

  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape(r[h] ?? "")).join(","));
  }
  fs.writeFileSync(filePath, "\uFEFF" + lines.join("\r\n"), "utf8");
}

function addIndex(map, key, row) {
  if (!key) return;
  const arr = map.get(key) || [];
  arr.push(row);
  map.set(key, arr);
}

function oneUnique(map, key) {
  if (!key) return [];
  return map.get(key) || [];
}

async function main() {
  const inputFile = process.argv[2];

  if (!inputFile) {
    console.log("");
    console.log("Usage:");
    console.log('  node scripts/protect-641.cjs "C:\\path\\KEEP_641.xlsx"');
    console.log("");
    process.exitCode = 1;
    return;
  }

  const resolved = path.resolve(inputFile);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  console.log("============================================================");
  console.log(" SMART IT - PROTECT 641 - DRY RUN ONLY");
  console.log(" NO INSERT / UPDATE / DELETE WILL HAPPEN");
  console.log("============================================================");
  console.log(`Input: ${resolved}`);
  console.log("");

  // ---------- Read Excel ----------
  const workbook = XLSX.readFile(resolved, { cellDates: false, raw: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const excelRows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });

  console.log(`Excel sheet: ${sheetName}`);
  console.log(`Excel rows : ${excelRows.length}`);

  if (excelRows.length !== EXPECTED_KEEP) {
    console.log("");
    console.log("STOPPED.");
    console.log(`Expected exactly ${EXPECTED_KEEP} rows, but file has ${excelRows.length}.`);
    console.log("Database was NOT changed.");
    process.exitCode = 2;
    return;
  }

  // ---------- Read live backend ----------
  // We use raw SQL so the script stays compatible with the current Prisma schema.
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
    ORDER BY d."id" ASC
  `);

  console.log(`Backend DEVICE rows: ${dbRows.length}`);
  console.log("");

  // ---------- Build indexes ----------
  const byDeviceCode = new Map();
  const byIpSerial = new Map();
  const bySecret = new Map();
  const byIp = new Map();
  const bySerial = new Map();
  const byLocation = new Map();

  for (const d of dbRows) {
    const deviceCode = normLoose(d.deviceCode);
    const ip = normIp(d.ipAddress);
    const serial = normSerial(d.serialNumber);
    const secret = normSecret(d.secretCode);
    const locationKey = [
      normLoose(d.cluster),
      normLoose(d.building),
      normLoose(d.zone),
      normLoose(d.lane),
      normLoose(d.direction),
    ].join("|");

    addIndex(byDeviceCode, deviceCode, d);
    addIndex(byIpSerial, ip && serial ? `${ip}|${serial}` : "", d);
    addIndex(bySecret, secret, d);
    addIndex(byIp, ip, d);
    addIndex(bySerial, serial, d);
    addIndex(byLocation, locationKey, d);
  }

  const report = [];
  const protectedIds = [];
  const usedBackendIds = new Set();

  for (let i = 0; i < excelRows.length; i++) {
    const row = excelRows[i];

    const input = {
      deviceCode: getFirst(row, [
        "Device ID", "DeviceID", "Device Code", "deviceCode", "ID", "New Device ID"
      ]),
      ip: getFirst(row, [
        "IP", "IP Address", "ipAddress", "NEW IP", "New IP"
      ]),
      serial: getFirst(row, [
        "Serial", "Serial Number", "serialNumber", "NEW Serial", "New Serial"
      ]),
      secret: getFirst(row, [
        "Secret Code", "secretCode", "Secret", "secrt", "SecretCode"
      ]),
      cluster: getFirst(row, ["Cluster", "NEW Cluster", "New Cluster"]),
      building: getFirst(row, ["Building", "Ministry", "NEW Building", "New Building"]),
      zone: getFirst(row, ["Zone", "NEW Zone", "New Zone"]),
      lane: getFirst(row, ["Lane", "Gate Number", "Gate No", "NEW Lane", "New Lane"]),
      direction: getFirst(row, ["Direction", "NEW Direction", "New Direction"]),
    };

    const deviceCodeKey = normLoose(input.deviceCode);
    const ipKey = normIp(input.ip);
    const serialKey = normSerial(input.serial);
    const secretKey = normSecret(input.secret);
    const locationKey = [
      normLoose(input.cluster),
      normLoose(input.building),
      normLoose(input.zone),
      normLoose(input.lane),
      normLoose(input.direction),
    ].join("|");

    let candidates = [];
    let rule = "";

    const tryRule = (name, rows) => {
      if (candidates.length === 0 && rows.length === 1) {
        candidates = rows;
        rule = name;
        return true;
      }
      return false;
    };

    // Strongest / safest matching first.
    if (!tryRule("DEVICE_CODE", oneUnique(byDeviceCode, deviceCodeKey))) {
      if (!tryRule("IP+SERIAL", oneUnique(byIpSerial, ipKey && serialKey ? `${ipKey}|${serialKey}` : ""))) {
        if (!tryRule("SECRET_CODE", oneUnique(bySecret, secretKey))) {
          if (!tryRule("IP_UNIQUE", oneUnique(byIp, ipKey))) {
            if (!tryRule("SERIAL_UNIQUE", oneUnique(bySerial, serialKey))) {
              tryRule("LOCATION_EXACT", oneUnique(byLocation, locationKey));
            }
          }
        }
      }
    }

    // If nothing uniquely matched, collect possible candidates for diagnostics.
    if (candidates.length === 0) {
      const pool = new Map();
      const collect = (arr) => {
        for (const d of arr) pool.set(String(d.id), d);
      };

      collect(oneUnique(byDeviceCode, deviceCodeKey));
      collect(oneUnique(byIpSerial, ipKey && serialKey ? `${ipKey}|${serialKey}` : ""));
      collect(oneUnique(bySecret, secretKey));
      collect(oneUnique(byIp, ipKey));
      collect(oneUnique(bySerial, serialKey));
      collect(oneUnique(byLocation, locationKey));

      candidates = [...pool.values()];
    }

    let status = "NOT_FOUND";
    let chosen = null;

    if (candidates.length === 1) {
      chosen = candidates[0];

      if (usedBackendIds.has(Number(chosen.id))) {
        status = "DUPLICATE_MATCH";
      } else {
        status = "PROTECTED";
        usedBackendIds.add(Number(chosen.id));
        protectedIds.push(Number(chosen.id));
      }
    } else if (candidates.length > 1) {
      status = "AMBIGUOUS";
    }

    // Live terminal output for every row
    const deviceNo = i + 1;
    const backendIdText = chosen?.id ?? "-";
    const backendCodeText = chosen?.deviceCode ?? "-";
    const ipText = input.ip || "-";
    const serialText = input.serial || "-";

    if (status === "PROTECTED") {
      console.log(
        `DEVICE ${String(deviceNo).padStart(3, " ")} / ${EXPECTED_KEEP}  → FOUND ✅   Backend ID: ${backendIdText}   DeviceCode: ${backendCodeText}   IP: ${ipText}   Serial: ${serialText}   [${rule}]`
      );
    } else if (status === "NOT_FOUND") {
      console.log(
        `DEVICE ${String(deviceNo).padStart(3, " ")} / ${EXPECTED_KEEP}  → NOT FOUND ❌   IP: ${ipText}   Serial: ${serialText}`
      );
    } else if (status === "AMBIGUOUS") {
      console.log(
        `DEVICE ${String(deviceNo).padStart(3, " ")} / ${EXPECTED_KEEP}  → AMBIGUOUS ⚠️   Candidates: ${candidates.length}   IP: ${ipText}   Serial: ${serialText}`
      );
    } else if (status === "DUPLICATE_MATCH") {
      console.log(
        `DEVICE ${String(deviceNo).padStart(3, " ")} / ${EXPECTED_KEEP}  → DUPLICATE MATCH ⚠️   Backend ID: ${backendIdText}   IP: ${ipText}   Serial: ${serialText}`
      );
    }

    report.push({
      ROW: i + 2,
      STATUS: status,
      MATCH_RULE: rule,
      INPUT_DEVICE_CODE: input.deviceCode,
      INPUT_IP: input.ip,
      INPUT_SERIAL: input.serial,
      INPUT_SECRET: input.secret,
      INPUT_CLUSTER: input.cluster,
      INPUT_BUILDING: input.building,
      INPUT_ZONE: input.zone,
      INPUT_LANE: input.lane,
      INPUT_DIRECTION: input.direction,
      BACKEND_ID: chosen?.id ?? "",
      BACKEND_DEVICE_CODE: chosen?.deviceCode ?? "",
      BACKEND_IP: chosen?.ipAddress ?? "",
      BACKEND_SERIAL: chosen?.serialNumber ?? "",
      BACKEND_SECRET: chosen?.secretCode ?? "",
      BACKEND_CLUSTER: chosen?.cluster ?? "",
      BACKEND_BUILDING: chosen?.building ?? "",
      BACKEND_ZONE: chosen?.zone ?? "",
      BACKEND_LANE: chosen?.lane ?? "",
      BACKEND_DIRECTION: chosen?.direction ?? "",
      CANDIDATE_COUNT: candidates.length,
    });
  }

  const outDir = path.dirname(resolved);
  const csvPath = path.join(outDir, "PROTECTED_641_DRY_RUN.csv");
  const jsonPath = path.join(outDir, "PROTECTED_641_IDS.json");

  writeCsv(csvPath, report);

  const summary = {
    expected: EXPECTED_KEEP,
    inputRows: excelRows.length,
    backendDeviceRows: dbRows.length,
    protected: report.filter((r) => r.STATUS === "PROTECTED").length,
    notFound: report.filter((r) => r.STATUS === "NOT_FOUND").length,
    ambiguous: report.filter((r) => r.STATUS === "AMBIGUOUS").length,
    duplicateMatch: report.filter((r) => r.STATUS === "DUPLICATE_MATCH").length,
    uniqueProtectedBackendIds: protectedIds.length,
    protectedBackendIds: protectedIds.sort((a, b) => a - b),
    generatedAt: new Date().toISOString(),
    dryRunOnly: true,
  };

  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), "utf8");

  console.log("");
  console.log("============================================================");
  console.log(" FINAL SUMMARY");
  console.log("============================================================");
  console.log(`Expected KEEP             : ${EXPECTED_KEEP}`);
  console.log(`Input rows                : ${summary.inputRows}`);
  console.log(`PROTECTED                 : ${summary.protected}`);
  console.log(`NOT_FOUND                 : ${summary.notFound}`);
  console.log(`AMBIGUOUS                 : ${summary.ambiguous}`);
  console.log(`DUPLICATE_MATCH           : ${summary.duplicateMatch}`);
  console.log(`Unique protected DB IDs   : ${summary.uniqueProtectedBackendIds}`);
  console.log("");
  console.log(`Report: ${csvPath}`);
  console.log(`IDs   : ${jsonPath}`);
  console.log("");

  if (
    summary.protected === EXPECTED_KEEP &&
    summary.notFound === 0 &&
    summary.ambiguous === 0 &&
    summary.duplicateMatch === 0 &&
    summary.uniqueProtectedBackendIds === EXPECTED_KEEP
  ) {
    console.log("✅ READY: 641 / 641 are uniquely protected.");
    console.log("✅ NO DATABASE CHANGES WERE MADE.");
  } else {
    console.log("❌ NOT READY.");
    console.log("❌ Do NOT delete anything yet.");
    console.log("✅ NO DATABASE CHANGES WERE MADE.");
    process.exitCode = 3;
  }
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
