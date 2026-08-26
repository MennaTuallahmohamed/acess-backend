const fs = require("fs");
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const INPUT_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\ALL_827_NO_DUP_WITH_IP_ (1).xlsx";

const KEEP_IDS_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\PROTECTED_641_IDS.json";

const OUTPUT_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\AUDIT_827_VS_KEEP_641_V2.xlsx";

const EXPECTED_INPUT = 827;
const EXPECTED_KEEP = 641;

function clean(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function norm(v) {
  return clean(v).toLowerCase().replace(/\s+/g, " ");
}

function normLoose(v) {
  return norm(v).replace(/[^a-z0-9\u0600-\u06ff]+/g, "");
}

function first(...vals) {
  for (const v of vals) {
    const s = clean(v);
    if (s) return s;
  }
  return "";
}

function get(row, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) {
      const v = clean(row[name]);
      if (v) return v;
    }
  }
  return "";
}

function loadKeepIds() {
  const data = JSON.parse(fs.readFileSync(KEEP_IDS_FILE, "utf8"));
  const ids = Array.isArray(data.protectedBackendIds)
    ? data.protectedBackendIds.map(Number).filter(Number.isFinite)
    : [];
  return [...new Set(ids)];
}

function isIPv4(v) {
  const s = clean(v);
  if (!s) return false;
  const p = s.split(".");
  if (p.length !== 4) return false;
  return p.every(x => /^\d{1,3}$/.test(x) && Number(x) >= 0 && Number(x) <= 255);
}

function isSerial(v) {
  const s = clean(v);
  if (!s) return false;
  return /^[A-Za-z0-9._-]{5,}$/.test(s);
}

function duplicateGroups(rows, label, getter) {
  const map = new Map();
  rows.forEach((r, idx) => {
    const raw = clean(getter(r));
    if (!raw) return;
    const key = norm(raw);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ idx, raw });
  });

  const groups = [];
  for (const items of map.values()) {
    if (items.length > 1) {
      groups.push({
        Field: label,
        Value: items[0].raw,
        Count: items.length,
        Rows: items.map(x => rows[x.idx].excelRow).join(", "),
        "Device IDs": items.map(x => rows[x.idx].deviceCode).join(", "),
      });
    }
  }
  return groups;
}

function locationScore(db, r) {
  let score = 0;
  if (normLoose(db.location?.cluster) && normLoose(db.location?.cluster) === normLoose(r.cluster)) score += 4;
  if (normLoose(db.location?.building) && normLoose(db.location?.building) === normLoose(r.building)) score += 4;
  if (normLoose(db.location?.zone) && normLoose(db.location?.zone) === normLoose(r.zone)) score += 3;
  if (normLoose(db.location?.lane) && normLoose(db.location?.lane) === normLoose(r.lane)) score += 2;
  if (normLoose(db.location?.direction) && normLoose(db.location?.direction) === normLoose(r.direction)) score += 2;
  return score;
}

function candidateScore(db, r) {
  let score = 0;
  const reasons = [];

  if (norm(db.deviceCode) && norm(db.deviceCode) === norm(r.deviceCode)) {
    score += 100;
    reasons.push("DEVICE_CODE");
  }

  if (norm(db.secretCode) && norm(db.secretCode) === norm(r.secret)) {
    score += 95;
    reasons.push("SECRET");
  }

  const dbSerial = norm(db.serialNumber);
  const rowSerials = [r.serialOld, r.serialNew, r.serialGeneric]
    .map(norm).filter(Boolean);

  if (dbSerial && rowSerials.includes(dbSerial)) {
    score += 70;
    reasons.push("SERIAL_OLD_OR_NEW");
  }

  const dbIp = norm(db.ipAddress);
  const rowIps = [r.ipOld, r.ipNew, r.ipGeneric]
    .map(norm).filter(Boolean);

  if (dbIp && rowIps.includes(dbIp)) {
    score += 55;
    reasons.push("IP_OLD_OR_NEW");
  }

  const loc = locationScore(db, r);
  score += loc;
  if (loc >= 8) reasons.push("LOCATION");

  return { score, reasons };
}

function writeReport({ summary, headers, dupGroups, matches, unmatched, ambiguous, rows }) {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(summary),
    "Summary"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([headers]),
    "Headers Found"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      dupGroups.length ? dupGroups : [{ Result: "No duplicates in final target fields" }]
    ),
    "Final Duplicates"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(matches),
    "641 Matches"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      unmatched.length ? unmatched : [{ Result: "No unmatched KEEP rows" }]
    ),
    "Unmatched KEEP"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      ambiguous.length ? ambiguous : [{ Result: "No ambiguous KEEP rows" }]
    ),
    "Ambiguous KEEP"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(rows.map(r => ({
      "Excel Row": r.excelRow,
      "Device ID": r.deviceCode,
      "IP OLD": r.ipOld,
      "IP NEW": r.ipNew,
      "IP generic": r.ipGeneric,
      "Final IP": r.finalIp,
      "Serial OLD": r.serialOld,
      "Serial NEW": r.serialNew,
      "Serial generic": r.serialGeneric,
      "Final Serial": r.finalSerial,
      "Secret": r.secret,
      Cluster: r.cluster,
      Ministry: r.building,
      Zone: r.zone,
      Lane: r.lane,
      Direction: r.direction,
    }))),
    "827 Parsed"
  );

  XLSX.writeFile(wb, OUTPUT_FILE);
}

async function main() {
  console.log("============================================================");
  console.log(" AUDIT 827 VS CURRENT KEEP 641 - V2");
  console.log(" READ ONLY - NO DATABASE CHANGES");
  console.log("============================================================");

  if (!fs.existsSync(INPUT_FILE)) throw new Error(`Missing Excel: ${INPUT_FILE}`);
  if (!fs.existsSync(KEEP_IDS_FILE)) throw new Error(`Missing KEEP file: ${KEEP_IDS_FILE}`);

  const keepIds = loadKeepIds();
  if (keepIds.length !== EXPECTED_KEEP) {
    throw new Error(`KEEP IDs=${keepIds.length}, expected 641.`);
  }

  const wb = XLSX.readFile(INPUT_FILE, { raw: false, cellDates: false });
  const sheetName = wb.SheetNames.includes("كل الأجهزة") ? "كل الأجهزة" : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
  const headers = Object.keys(rawRows[0] || {});

  const rows = rawRows.map((r, i) => {
    const ipOld = get(r, ["IP OLD", "OLD IP", "Old IP", "IP Old", "IP القديم"]);
    const ipNew = get(r, ["IP NEW", "NEW IP", "New IP", "IP New", "IP الجديد"]);
    const ipGeneric = get(r, ["IP", "IP Address", "ipAddress"]);

    const serialOld = get(r, ["Serial OLD", "OLD Serial", "Old Serial", "Serial Old", "Serial القديم"]);
    const serialNew = get(r, ["Serial NEW", "NEW Serial", "New Serial", "Serial New", "Serial الجديد"]);
    const serialGeneric = get(r, ["Serial", "Serial Number", "serialNumber"]);

    const finalIpRaw = first(ipNew, ipGeneric, ipOld);
    const finalSerialRaw = first(serialNew, serialGeneric, serialOld);

    return {
      excelRow: i + 2,
      deviceCode: get(r, ["Device ID", "Device Code", "deviceCode"]),
      ipOld,
      ipNew,
      ipGeneric,
      finalIp: isIPv4(finalIpRaw) ? finalIpRaw : "",
      finalIpRaw,
      serialOld,
      serialNew,
      serialGeneric,
      finalSerial: isSerial(finalSerialRaw) ? finalSerialRaw : "",
      finalSerialRaw,
      secret: get(r, ["Secret Code", "secretCode", "Secret"]),
      cluster: first(
        get(r, ["Cluster NEW"]),
        get(r, ["Cluster"]),
        get(r, ["Cluster OLD"])
      ),
      building: first(
        get(r, ["اسم الوزارة / الجهة"]),
        get(r, ["Building"]),
        get(r, ["Ministry"])
      ),
      zone: first(
        get(r, ["Zone NEW"]),
        get(r, ["Zone"]),
        get(r, ["Zone OLD"])
      ),
      lane: first(
        get(r, ["Lane NEW"]),
        get(r, ["Lane"]),
        get(r, ["Lane OLD"])
      ),
      direction: get(r, ["Direction", "direction"]),
    };
  }).filter(r => [
    r.deviceCode, r.ipOld, r.ipNew, r.ipGeneric,
    r.serialOld, r.serialNew, r.serialGeneric,
    r.cluster, r.building, r.zone, r.secret
  ].some(Boolean));

  console.log(`Sheet                     : ${sheetName}`);
  console.log(`Rows                      : ${rows.length}`);
  console.log(`Headers                   : ${headers.join(" | ")}`);

  if (rows.length !== EXPECTED_INPUT) {
    throw new Error(`Expected 827 rows, found ${rows.length}.`);
  }

  const dupGroups = [
    ...duplicateGroups(rows, "Device ID", r => r.deviceCode),
    ...duplicateGroups(rows, "Final IP", r => r.finalIp),
    ...duplicateGroups(rows, "Final Serial", r => r.finalSerial),
    ...duplicateGroups(rows, "Excel Secret", r => r.secret),
  ];

  const current = await prisma.device.findMany({
    include: { location: true },
    orderBy: { id: "asc" },
  });

  const keepSet = new Set(keepIds.map(Number));
  const keepRows = current.filter(r => keepSet.has(Number(r.id)));
  const outsideKeep = current.filter(r => !keepSet.has(Number(r.id)));

  if (current.length !== 641 || keepRows.length !== 641 || outsideKeep.length !== 0) {
    throw new Error(
      `Backend safety stop: total=${current.length}, KEEP=${keepRows.length}, outside=${outsideKeep.length}.`
    );
  }

  const matches = [];
  const unmatched = [];
  const ambiguous = [];
  const usedInput = new Set();

  for (const db of keepRows) {
    const scored = rows
      .map((r, idx) => {
        const x = candidateScore(db, r);
        return { idx, row: r, score: x.score, reasons: x.reasons };
      })
      .filter(x => x.score >= 55)
      .sort((a, b) => b.score - a.score);

    if (!scored.length) {
      unmatched.push({
        "Backend ID": db.id,
        "Device Code": clean(db.deviceCode),
        IP: clean(db.ipAddress),
        Serial: clean(db.serialNumber),
        Secret: clean(db.secretCode),
        Cluster: clean(db.location?.cluster),
        Building: clean(db.location?.building),
        Zone: clean(db.location?.zone),
        Lane: clean(db.location?.lane),
        Direction: clean(db.location?.direction),
      });
      continue;
    }

    const bestScore = scored[0].score;
    const best = scored.filter(x => x.score === bestScore && !usedInput.has(x.idx));

    if (best.length !== 1) {
      ambiguous.push({
        "Backend ID": db.id,
        "Device Code": clean(db.deviceCode),
        IP: clean(db.ipAddress),
        Serial: clean(db.serialNumber),
        "Best Score": bestScore,
        Candidates: best.map(x => `${x.row.deviceCode}@row${x.row.excelRow}`).join(" | "),
      });
      continue;
    }

    const chosen = best[0];
    usedInput.add(chosen.idx);

    matches.push({
      "Backend ID": db.id,
      "Current Device Code": clean(db.deviceCode),
      "Current IP": clean(db.ipAddress),
      "Current Serial": clean(db.serialNumber),
      "Excel Row": chosen.row.excelRow,
      "Excel Device ID": chosen.row.deviceCode,
      "IP OLD": chosen.row.ipOld,
      "IP NEW": chosen.row.ipNew,
      "Final IP": chosen.row.finalIp,
      "Serial OLD": chosen.row.serialOld,
      "Serial NEW": chosen.row.serialNew,
      "Final Serial": chosen.row.finalSerial,
      Score: chosen.score,
      Reasons: chosen.reasons.join("+"),
    });
  }

  const newCount = rows.length - usedInput.size;

  const invalidFinalIp = rows.filter(r => r.finalIpRaw && !r.finalIp).length;
  const invalidFinalSerial = rows.filter(r => r.finalSerialRaw && !r.finalSerial).length;

  const summary = [
    { Metric: "Input rows", Value: rows.length },
    { Metric: "Backend total", Value: current.length },
    { Metric: "KEEP found", Value: keepRows.length },
    { Metric: "Rows outside KEEP", Value: outsideKeep.length },
    { Metric: "KEEP matched", Value: matches.length },
    { Metric: "KEEP unmatched", Value: unmatched.length },
    { Metric: "KEEP ambiguous", Value: ambiguous.length },
    { Metric: "Rows left as new", Value: newCount },
    { Metric: "Final duplicate groups", Value: dupGroups.length },
    { Metric: "Invalid final IP values", Value: invalidFinalIp },
    { Metric: "Invalid final Serial values", Value: invalidFinalSerial },
  ];

  writeReport({
    summary,
    headers,
    dupGroups,
    matches,
    unmatched,
    ambiguous,
    rows
  });

  console.log("");
  console.log("RESULT");
  console.log("------------------------------------------------------------");
  console.log(`KEEP matched             : ${matches.length} / 641`);
  console.log(`KEEP unmatched           : ${unmatched.length}`);
  console.log(`KEEP ambiguous           : ${ambiguous.length}`);
  console.log(`Rows left as new         : ${newCount}`);
  console.log(`Duplicate groups final   : ${dupGroups.length}`);
  console.log(`Invalid final IP         : ${invalidFinalIp}`);
  console.log(`Invalid final Serial     : ${invalidFinalSerial}`);
  console.log(`Report                   : ${OUTPUT_FILE}`);
  console.log("");
  console.log("✅ READ ONLY. NO DATABASE CHANGES WERE MADE.");
}

main()
  .catch(err => {
    console.error("");
    console.error("❌ ERROR:", err.message || err);
    console.error("✅ NO DATABASE CHANGES WERE MADE.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
