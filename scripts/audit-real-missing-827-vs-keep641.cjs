const fs = require("fs");
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const INPUT_827 =
  "C:\\Users\\Mena\\Desktop\\Devices\\ALL_827_NO_DUP_WITH_IP_ (1).xlsx";

const KEEP_641 =
  "C:\\Users\\Mena\\Desktop\\Devices\\CORRECT_REMAINING_641_ (2).xlsx";

const KEEP_IDS =
  "C:\\Users\\Mena\\Desktop\\Devices\\PROTECTED_641_IDS.json";

const REPORT =
  "C:\\Users\\Mena\\Desktop\\Devices\\AUDIT_REAL_186_FROM_827.xlsx";

function clean(v) {
  return v == null ? "" : String(v).trim();
}

function norm(v) {
  return clean(v).toLowerCase().replace(/\s+/g, " ");
}

function normLoose(v) {
  return norm(v).replace(/[^a-z0-9\u0600-\u06ff]+/g, "");
}

function normalizeObjectKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[norm(k)] = v;
  }
  return out;
}

function get(row, names) {
  for (const name of names) {
    const key = norm(name);
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const v = clean(row[key]);
      if (v) return v;
    }
  }
  return "";
}

function first(...vals) {
  for (const v of vals) {
    const s = clean(v);
    if (s) return s;
  }
  return "";
}

function lane(v) {
  const s = clean(v);
  if (/^-?\d+\.0+$/.test(s)) return String(parseInt(s, 10));
  return s;
}

function direction(v) {
  return clean(v).toUpperCase();
}

function isIp(v) {
  const s = clean(v);
  if (!s) return "";
  const p = s.split(".");
  if (p.length !== 4) return "";
  return p.every(x => /^\d{1,3}$/.test(x) && Number(x) <= 255) ? s : "";
}

function isSerial(v) {
  const s = clean(v);
  return /^[A-Za-z0-9._-]{5,}$/.test(s) ? s : "";
}

function loadSheet(file, preferred) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`);
  const wb = XLSX.readFile(file, { raw: false, cellDates: false });
  const sheetName =
    preferred && wb.SheetNames.includes(preferred)
      ? preferred
      : wb.SheetNames[0];

  const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    defval: "",
    raw: false,
  });

  return {
    sheetName,
    headers: Object.keys(raw[0] || {}),
    raw,
  };
}

function parse827(rawRows) {
  return rawRows.map((raw, i) => {
    const r = normalizeObjectKeys(raw);

    const ipOld = get(r, ["IP OLD", "OLD IP"]);
    const ipNew = get(r, ["IP NEW", "NEW IP"]);
    const serialOld = get(r, ["Serial OLD", "OLD Serial"]);
    const serialNew = get(r, ["Serial NEW", "NEW Serial"]);

    return {
      idx: i,
      excelRow: i + 2,
      deviceCode: get(r, ["Device ID", "Device Code"]),
      secret: get(r, ["Secret Code"]),
      ipOld,
      ipNew,
      finalIp: isIp(first(ipNew, ipOld)),
      serialOld,
      serialNew,
      finalSerial: isSerial(first(serialNew, serialOld)),
      clusterOld: get(r, ["Cluster OLD"]),
      clusterNew: get(r, ["Cluster NEW"]),
      finalCluster: first(get(r, ["Cluster NEW"]), get(r, ["Cluster OLD"]), get(r, ["Cluster"])),
      zoneOld: get(r, ["Zone OLD"]),
      zoneNew: get(r, ["Zone NEW"]),
      finalZone: first(get(r, ["Zone NEW"]), get(r, ["Zone OLD"]), get(r, ["Zone"])),
      laneOld: lane(get(r, ["Lane OLD"])),
      laneNew: lane(get(r, ["Lane NEW"])),
      finalLane: lane(first(get(r, ["Lane NEW"]), get(r, ["Lane OLD"]), get(r, ["Lane"]))),
      direction: direction(get(r, ["Direction"])),
      building: get(r, ["اسم الوزارة / الجهة", "Building"]),
    };
  }).filter(r => [
    r.deviceCode, r.ipOld, r.ipNew, r.serialOld, r.serialNew,
    r.finalCluster, r.finalZone, r.building
  ].some(Boolean));
}

function parseKeep(rawRows) {
  return rawRows.map((raw, i) => {
    const r = normalizeObjectKeys(raw);

    return {
      idx: i,
      excelRow: i + 2,
      deviceCode: get(r, ["Device ID", "Device Code"]),
      secret: get(r, ["Secret Code"]),
      ip: first(
        get(r, ["IP"]),
        get(r, ["IP Address"]),
        get(r, ["IP OLD"]),
        get(r, ["IP NEW"])
      ),
      serial: first(
        get(r, ["Serial"]),
        get(r, ["Serial Number"]),
        get(r, ["Serial OLD"]),
        get(r, ["Serial NEW"])
      ),
      cluster: first(get(r, ["Cluster"]), get(r, ["Cluster OLD"]), get(r, ["Cluster NEW"])),
      zone: first(get(r, ["Zone"]), get(r, ["Zone OLD"]), get(r, ["Zone NEW"])),
      lane: lane(first(get(r, ["Lane"]), get(r, ["Lane OLD"]), get(r, ["Lane NEW"]))),
      direction: direction(get(r, ["Direction"])),
      building: get(r, ["اسم الوزارة / الجهة", "Building"]),
    };
  }).filter(r => [
    r.deviceCode, r.ip, r.serial, r.secret, r.cluster, r.zone, r.building
  ].some(Boolean));
}

function scoreKeepTo827(k, r) {
  let score = 0;
  const reasons = [];

  if (norm(k.deviceCode) && norm(k.deviceCode) === norm(r.deviceCode)) {
    score += 100;
    reasons.push("DEVICE_ID");
  }

  if (norm(k.secret) && norm(k.secret) === norm(r.secret)) {
    score += 95;
    reasons.push("SECRET");
  }

  const ks = norm(k.serial);
  if (ks && [r.serialOld, r.serialNew].map(norm).includes(ks)) {
    score += 80;
    reasons.push("SERIAL_OLD/NEW");
  }

  const kip = norm(k.ip);
  if (kip && [r.ipOld, r.ipNew].map(norm).includes(kip)) {
    score += 70;
    reasons.push("IP_OLD/NEW");
  }

  if (normLoose(k.building) && normLoose(k.building) === normLoose(r.building)) {
    score += 6;
  }

  if (normLoose(k.cluster) &&
      [r.clusterOld, r.clusterNew, r.finalCluster].map(normLoose).includes(normLoose(k.cluster))) {
    score += 5;
  }

  if (normLoose(k.zone) &&
      [r.zoneOld, r.zoneNew, r.finalZone].map(normLoose).includes(normLoose(k.zone))) {
    score += 4;
  }

  if (normLoose(k.lane) &&
      [r.laneOld, r.laneNew, r.finalLane].map(normLoose).includes(normLoose(k.lane))) {
    score += 2;
  }

  if (normLoose(k.direction) && normLoose(k.direction) === normLoose(r.direction)) {
    score += 2;
  }

  return { score, reasons };
}

function duplicateGroups(rows, field, getter) {
  const map = new Map();

  rows.forEach(r => {
    const value = clean(getter(r));
    if (!value) return;
    const key = norm(value);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  });

  const out = [];
  for (const items of map.values()) {
    if (items.length <= 1) continue;
    out.push({
      Field: field,
      Value: clean(getter(items[0])),
      Count: items.length,
      "Excel Rows": items.map(x => x.excelRow).join(", "),
      "Device IDs": items.map(x => x.deviceCode).join(", "),
    });
  }
  return out;
}

function loadProtectedIds() {
  const j = JSON.parse(fs.readFileSync(KEEP_IDS, "utf8"));
  return [...new Set((j.protectedBackendIds || []).map(Number).filter(Number.isFinite))];
}

async function main() {
  console.log("============================================================");
  console.log(" FIND THE REAL MISSING ROWS: 827 vs KEEP 641");
  console.log(" READ ONLY - NO DATABASE CHANGES");
  console.log("============================================================");

  const protectedIds = loadProtectedIds();
  if (protectedIds.length !== 641) {
    throw new Error(`Protected IDs=${protectedIds.length}, expected 641.`);
  }

  const inputFile = loadSheet(INPUT_827, "كل الأجهزة");
  const keepFile = loadSheet(KEEP_641);

  const rows827 = parse827(inputFile.raw);
  const rows641 = parseKeep(keepFile.raw);

  console.log(`827 sheet            : ${inputFile.sheetName}`);
  console.log(`827 parsed rows      : ${rows827.length}`);
  console.log(`KEEP sheet           : ${keepFile.sheetName}`);
  console.log(`KEEP parsed rows     : ${rows641.length}`);

  if (rows827.length !== 827) {
    throw new Error(`Expected 827 source rows, got ${rows827.length}.`);
  }

  if (rows641.length !== 641) {
    throw new Error(`Expected 641 KEEP Excel rows, got ${rows641.length}.`);
  }

  const backend = await prisma.device.findMany({
    include: { location: true },
    orderBy: { id: "asc" },
  });

  const protectedSet = new Set(protectedIds.map(Number));
  const protectedRows = backend.filter(d => protectedSet.has(Number(d.id)));
  const outsideProtected = backend.filter(d => !protectedSet.has(Number(d.id)));

  if (backend.length !== 641 || protectedRows.length !== 641 || outsideProtected.length !== 0) {
    throw new Error(
      `Backend safety stop: total=${backend.length}, protected=${protectedRows.length}, outside=${outsideProtected.length}.`
    );
  }

  // Match 641 KEEP Excel rows to 827 rows.
  const used827 = new Set();
  const matches = [];
  const unmatchedKeep = [];
  const ambiguousKeep = [];

  for (const k of rows641) {
    const scored = rows827
      .map((r, idx) => {
        const x = scoreKeepTo827(k, r);
        return { idx, r, score: x.score, reasons: x.reasons };
      })
      .filter(x => x.score >= 70)
      .sort((a, b) => b.score - a.score);

    if (!scored.length) {
      unmatchedKeep.push({
        "KEEP Excel Row": k.excelRow,
        "Device ID": k.deviceCode,
        IP: k.ip,
        Serial: k.serial,
        Secret: k.secret,
        Cluster: k.cluster,
        Ministry: k.building,
        Zone: k.zone,
        Lane: k.lane,
        Direction: k.direction,
      });
      continue;
    }

    const bestScore = scored[0].score;
    const bestAvailable = scored.filter(
      x => x.score === bestScore && !used827.has(x.idx)
    );

    if (bestAvailable.length !== 1) {
      ambiguousKeep.push({
        "KEEP Excel Row": k.excelRow,
        "Device ID": k.deviceCode,
        IP: k.ip,
        Serial: k.serial,
        "Best Score": bestScore,
        Candidates: bestAvailable
          .map(x => `${x.r.deviceCode}@row${x.r.excelRow}`)
          .join(" | "),
      });
      continue;
    }

    const chosen = bestAvailable[0];
    used827.add(chosen.idx);

    matches.push({
      "KEEP Excel Row": k.excelRow,
      "827 Excel Row": chosen.r.excelRow,
      "KEEP Device ID": k.deviceCode,
      "827 Device ID": chosen.r.deviceCode,
      "KEEP IP": k.ip,
      "827 IP OLD": chosen.r.ipOld,
      "827 IP NEW": chosen.r.ipNew,
      "KEEP Serial": k.serial,
      "827 Serial OLD": chosen.r.serialOld,
      "827 Serial NEW": chosen.r.serialNew,
      Score: chosen.score,
      Reasons: chosen.reasons.join("+"),
    });
  }

  const remaining = rows827.filter((_, idx) => !used827.has(idx));

  const duplicatesRemaining = [
    ...duplicateGroups(remaining, "Device ID", r => r.deviceCode),
    ...duplicateGroups(remaining, "Final IP", r => r.finalIp),
    ...duplicateGroups(remaining, "Final Serial", r => r.finalSerial),
  ];

  const duplicateParticipantRows = new Set();

  for (const d of duplicatesRemaining) {
    const rowNumbers = String(d["Excel Rows"])
      .split(",")
      .map(x => Number(x.trim()))
      .filter(Number.isFinite);

    rowNumbers.forEach(n => duplicateParticipantRows.add(n));
  }

  const safeNew = remaining.filter(
    r => !duplicateParticipantRows.has(r.excelRow)
  );

  // Conflicts with current protected backend final IP/Serial.
  const backendIp = new Map();
  const backendSerial = new Map();

  protectedRows.forEach(d => {
    if (clean(d.ipAddress)) backendIp.set(norm(d.ipAddress), d);
    if (clean(d.serialNumber)) backendSerial.set(norm(d.serialNumber), d);
  });

  const conflicts = [];
  const safeAfterBackend = [];

  for (const r of safeNew) {
    const reasons = [];

    if (r.finalIp && backendIp.has(norm(r.finalIp))) {
      reasons.push(
        `IP already belongs to protected Device ID ${clean(backendIp.get(norm(r.finalIp)).deviceCode)}`
      );
    }

    if (r.finalSerial && backendSerial.has(norm(r.finalSerial))) {
      reasons.push(
        `Serial already belongs to protected Device ID ${clean(backendSerial.get(norm(r.finalSerial)).deviceCode)}`
      );
    }

    if (reasons.length) {
      conflicts.push({
        "Excel Row": r.excelRow,
        "Device ID": r.deviceCode,
        IP: r.finalIp,
        Serial: r.finalSerial,
        Reason: reasons.join(" | "),
      });
    } else {
      safeAfterBackend.push(r);
    }
  }

  const summary = [
    { Metric: "827 source rows", Value: rows827.length },
    { Metric: "KEEP Excel rows", Value: rows641.length },
    { Metric: "Backend protected rows", Value: protectedRows.length },
    { Metric: "KEEP matched into 827", Value: matches.length },
    { Metric: "KEEP unmatched", Value: unmatchedKeep.length },
    { Metric: "KEEP ambiguous", Value: ambiguousKeep.length },
    { Metric: "Rows remaining after removing KEEP", Value: remaining.length },
    { Metric: "Duplicate groups among remaining", Value: duplicatesRemaining.length },
    { Metric: "Rows in duplicate groups", Value: duplicateParticipantRows.size },
    { Metric: "Backend conflicts among remaining", Value: conflicts.length },
    { Metric: "SAFE NEW rows", Value: safeAfterBackend.length },
    { Metric: "Expected final backend if safe new inserted", Value: 641 + safeAfterBackend.length },
  ];

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(summary),
    "Summary"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(matches),
    "641 MATCHED"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      remaining.map(r => ({
        "Excel Row": r.excelRow,
        "Device ID": r.deviceCode,
        "Final IP": r.finalIp,
        "Final Serial": r.finalSerial,
        Cluster: r.finalCluster,
        Ministry: r.building,
        Zone: r.finalZone,
        Lane: r.finalLane,
        Direction: r.direction,
      }))
    ),
    "REMAINING FROM 827"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      duplicatesRemaining.length
        ? duplicatesRemaining
        : [{ Result: "No duplicate groups" }]
    ),
    "DUPLICATES REMAINING"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      conflicts.length ? conflicts : [{ Result: "No backend conflicts" }]
    ),
    "BACKEND CONFLICTS"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      safeAfterBackend.map(r => ({
        "Excel Row": r.excelRow,
        "Device ID": r.deviceCode,
        "Final IP": r.finalIp,
        "Final Serial": r.finalSerial,
        Cluster: r.finalCluster,
        "الوزارة / الجهة": r.building,
        Zone: r.finalZone,
        Lane: r.finalLane,
        Direction: r.direction,
      }))
    ),
    "SAFE NEW"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      unmatchedKeep.length ? unmatchedKeep : [{ Result: "No unmatched KEEP rows" }]
    ),
    "UNMATCHED KEEP"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      ambiguousKeep.length ? ambiguousKeep : [{ Result: "No ambiguous KEEP rows" }]
    ),
    "AMBIGUOUS KEEP"
  );

  XLSX.writeFile(wb, REPORT);

  console.log("");
  console.log("RESULT");
  console.log("------------------------------------------------------------");
  console.log(`KEEP matched into 827         : ${matches.length} / 641`);
  console.log(`KEEP unmatched                : ${unmatchedKeep.length}`);
  console.log(`KEEP ambiguous                : ${ambiguousKeep.length}`);
  console.log(`Rows remaining from 827       : ${remaining.length}`);
  console.log(`Duplicate groups remaining    : ${duplicatesRemaining.length}`);
  console.log(`Rows in duplicate groups      : ${duplicateParticipantRows.size}`);
  console.log(`Backend conflicts remaining   : ${conflicts.length}`);
  console.log(`SAFE NEW rows                 : ${safeAfterBackend.length}`);
  console.log(`Expected final backend        : ${641 + safeAfterBackend.length}`);
  console.log(`Report                        : ${REPORT}`);
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
