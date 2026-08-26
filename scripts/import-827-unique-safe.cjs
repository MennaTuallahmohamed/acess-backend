const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const INPUT_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\ALL_827_NO_DUP_WITH_IP_ (1).xlsx";

const KEEP_IDS_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\PROTECTED_641_IDS.json";

const PRECHECK_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\IMPORT_827_PRECHECK.xlsx";

const FINAL_EXPORT_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\ALL_827_IMPORTED_FINAL_FROM_BACKEND.xlsx";

const EXPECTED_INPUT = 827;
const EXPECTED_KEEP = 641;
const EXPECTED_NEW = 186;

function clean(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function norm(v) {
  return clean(v).toLowerCase().replace(/\s+/g, " ");
}

function compact(v) {
  return norm(v).replace(/[^a-z0-9\u0600-\u06ff]+/g, "");
}

function first(...values) {
  for (const v of values) {
    const s = clean(v);
    if (s !== "") return s;
  }
  return "";
}

function normalizeLane(v) {
  const s = clean(v);
  if (!s) return "";
  if (/^-?\d+\.0+$/.test(s)) return String(parseInt(s, 10));
  return s;
}

function normalizeDirection(v) {
  const s = clean(v).toUpperCase();
  if (s === "IN" || s === "OUT") return s;
  return s;
}

function validIPv4(v) {
  const s = clean(v);
  if (!s) return "";
  const parts = s.split(".");
  if (parts.length !== 4) return "";
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return "";
    const n = Number(p);
    if (n < 0 || n > 255) return "";
  }
  return s;
}

function validSerial(v) {
  const s = clean(v);
  if (!s) return "";
  // Real device serials in this project are alphanumeric codes.
  // Arabic status words such as "مهنجة" are treated as missing, not as serial numbers.
  if (!/^[A-Za-z0-9._-]{5,}$/.test(s)) return "";
  return s;
}

function dupGroups(rows, field, getter, caseInsensitive = true) {
  const map = new Map();

  rows.forEach((row, index) => {
    const raw = getter(row);
    const value = clean(raw);
    if (!value) return;

    const key = caseInsensitive ? value.toLowerCase() : value;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ row: index + 2, value, item: row });
  });

  const out = [];
  for (const items of map.values()) {
    if (items.length > 1) {
      for (const x of items) {
        out.push({
          Field: field,
          Value: x.value,
          "Excel Row": x.row,
          "Device ID": clean(x.item.deviceCode),
          IP: clean(x.item.ip),
          Serial: clean(x.item.serial),
          Ministry: clean(x.item.building),
          Cluster: clean(x.item.cluster),
          Zone: clean(x.item.zone),
          Lane: clean(x.item.lane),
          Direction: clean(x.item.direction),
        });
      }
    }
  }
  return out;
}

function loadKeepIds() {
  if (!fs.existsSync(KEEP_IDS_FILE)) {
    throw new Error(`KEEP IDs file not found: ${KEEP_IDS_FILE}`);
  }

  const data = JSON.parse(fs.readFileSync(KEEP_IDS_FILE, "utf8"));
  const ids = Array.isArray(data.protectedBackendIds)
    ? data.protectedBackendIds.map(Number).filter(Number.isFinite)
    : [];

  return [...new Set(ids)];
}

function readInput() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Excel file not found: ${INPUT_FILE}`);
  }

  const wb = XLSX.readFile(INPUT_FILE, { raw: false, cellDates: false });
  const sheetName = wb.SheetNames.includes("كل الأجهزة")
    ? "كل الأجهزة"
    : wb.SheetNames[0];

  const ws = wb.Sheets[sheetName];
  const source = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });

  const rows = source
    .map((r, index) => {
      const deviceCode = clean(
        first(r["Device ID"], r["Device Code"], r.deviceCode)
      );

      const rawIp = first(r["IP NEW"], r["IP"], r["IP Address"]);
      const rawSerial = first(
        r["Serial NEW"],
        r["Serial"],
        r["Serial Number"]
      );

      return {
        excelRow: index + 2,
        deviceCode,
        building: first(r["اسم الوزارة / الجهة"], r["Building"]),
        cluster: first(r["Cluster NEW"], r["Cluster"], r["Cluster OLD"]),
        zone: first(r["Zone NEW"], r["Zone"], r["Zone OLD"]),
        lane: normalizeLane(
          first(r["Lane NEW"], r["Lane"], r["Lane OLD"])
        ),
        direction: normalizeDirection(r["Direction"]),
        ip: validIPv4(rawIp),
        rawIp: clean(rawIp),
        serial: validSerial(rawSerial),
        rawSerial: clean(rawSerial),
        excelSecret: clean(first(r["Secret Code"], r["secretCode"])),
      };
    })
    .filter((r) =>
      [
        r.deviceCode,
        r.building,
        r.cluster,
        r.zone,
        r.ip,
        r.serial,
        r.excelSecret,
      ].some((v) => clean(v) !== "")
    );

  return { rows, sheetName };
}

function buildIndexes(rows) {
  const indexes = {
    deviceCode: new Map(),
    secret: new Map(),
    ipSerial: new Map(),
    serial: new Map(),
    ip: new Map(),
  };

  const put = (map, key, index) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(index);
  };

  rows.forEach((r, index) => {
    put(indexes.deviceCode, norm(r.deviceCode), index);
    put(indexes.secret, norm(r.excelSecret), index);
    if (r.ip && r.serial) {
      put(indexes.ipSerial, `${norm(r.ip)}|${norm(r.serial)}`, index);
    }
    put(indexes.serial, norm(r.serial), index);
    put(indexes.ip, norm(r.ip), index);
  });

  return indexes;
}

function one(indexMap, key) {
  if (!key) return null;
  const arr = indexMap.get(key) || [];
  return arr.length === 1 ? arr[0] : null;
}

function generateSecret(used) {
  while (true) {
    const hex = crypto.randomBytes(8).toString("hex").toUpperCase();
    const code =
      `DSC-${hex.slice(0, 4)}-${hex.slice(4, 8)}-` +
      `${hex.slice(8, 12)}-${hex.slice(12, 16)}`;

    if (!used.has(norm(code))) {
      used.add(norm(code));
      return code;
    }
  }
}

function makeBarcode(deviceCode, ip, serial, used) {
  let base =
    `DEV827-${clean(deviceCode)}-` +
    crypto
      .createHash("sha1")
      .update(`${deviceCode}|${ip}|${serial}`)
      .digest("hex")
      .slice(0, 8)
      .toUpperCase();

  let value = base;
  let n = 1;
  while (used.has(norm(value))) {
    value = `${base}-${n++}`;
  }
  used.add(norm(value));
  return value;
}

function locationKey(r) {
  return [
    compact(r.cluster),
    compact(r.building),
    compact(r.zone),
    compact(r.lane),
    compact(r.direction),
  ].join("|");
}

function locationExcelId(r) {
  const hash = crypto
    .createHash("sha1")
    .update(locationKey(r))
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();

  return `IMP827-${hash}`;
}

function writePrecheck({
  summary,
  duplicateRows,
  matchRows,
  missingKeepRows,
  inputRows,
}) {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(summary),
    "Summary"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      duplicateRows.length ? duplicateRows : [{ Result: "No duplicates" }]
    ),
    "Duplicates"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      missingKeepRows.length
        ? missingKeepRows
        : [{ Result: "All 641 KEEP rows matched" }]
    ),
    "KEEP Match"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(matchRows),
    "Import Plan"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      inputRows.map((r) => ({
        "Excel Row": r.excelRow,
        "Device ID": r.deviceCode,
        IP: r.ip,
        "Raw IP": r.rawIp,
        Serial: r.serial,
        "Raw Serial": r.rawSerial,
        Cluster: r.cluster,
        Ministry: r.building,
        Zone: r.zone,
        Lane: r.lane,
        Direction: r.direction,
        "Excel Secret": r.excelSecret,
      }))
    ),
    "Input 827"
  );

  XLSX.writeFile(wb, PRECHECK_FILE);
}

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || "").trim());
    });
  });
}

async function buildPlan(inputRows, keepIds) {
  const current = await prisma.device.findMany({
    include: {
      location: true,
      deviceType: true,
    },
    orderBy: { id: "asc" },
  });

  const keepSet = new Set(keepIds.map(Number));
  const currentKeep = current.filter((d) => keepSet.has(Number(d.id)));
  const outsideKeep = current.filter((d) => !keepSet.has(Number(d.id)));

  if (current.length !== EXPECTED_KEEP) {
    throw new Error(
      `SAFETY STOP: backend Device table must currently contain exactly 641 rows; found ${current.length}.`
    );
  }

  if (currentKeep.length !== EXPECTED_KEEP || outsideKeep.length !== 0) {
    throw new Error(
      `SAFETY STOP: backend is not exactly the protected 641 KEEP rows.`
    );
  }

  const indexes = buildIndexes(inputRows);
  const usedInputIndexes = new Set();
  const matchForDbId = new Map();
  const missingKeep = [];
  const ambiguousKeep = [];

  for (const db of currentKeep) {
    const candidates = new Map();

    const addCandidate = (idx, reason) => {
      if (idx === null || idx === undefined) return;
      if (!candidates.has(idx)) candidates.set(idx, []);
      candidates.get(idx).push(reason);
    };

    addCandidate(
      one(indexes.deviceCode, norm(db.deviceCode)),
      "DEVICE_CODE"
    );

    addCandidate(
      one(indexes.secret, norm(db.secretCode)),
      "SECRET_CODE"
    );

    if (db.ipAddress && db.serialNumber) {
      addCandidate(
        one(
          indexes.ipSerial,
          `${norm(db.ipAddress)}|${norm(db.serialNumber)}`
        ),
        "IP+SERIAL"
      );
    }

    addCandidate(
      one(indexes.serial, norm(db.serialNumber)),
      "SERIAL"
    );

    addCandidate(one(indexes.ip, norm(db.ipAddress)), "IP");

    const available = [...candidates.entries()].filter(
      ([idx]) => !usedInputIndexes.has(idx)
    );

    if (available.length === 0) {
      missingKeep.push({
        "Backend ID": db.id,
        "Current Device Code": clean(db.deviceCode),
        "Current IP": clean(db.ipAddress),
        "Current Serial": clean(db.serialNumber),
        "Current Secret": clean(db.secretCode),
        Cluster: clean(db.location?.cluster),
        Building: clean(db.location?.building),
        Zone: clean(db.location?.zone),
        Lane: clean(db.location?.lane),
        Direction: clean(db.location?.direction),
        Status: "NOT MATCHED TO 827 FILE",
      });
      continue;
    }

    // If several methods point to different rows, stop instead of guessing.
    const uniqueIndexes = [...new Set(available.map(([idx]) => idx))];

    if (uniqueIndexes.length !== 1) {
      ambiguousKeep.push({
        "Backend ID": db.id,
        "Current Device Code": clean(db.deviceCode),
        "Current IP": clean(db.ipAddress),
        "Current Serial": clean(db.serialNumber),
        Candidates: uniqueIndexes
          .map((idx) => `${inputRows[idx].deviceCode}@row${inputRows[idx].excelRow}`)
          .join(" | "),
        Status: "AMBIGUOUS",
      });
      continue;
    }

    const idx = uniqueIndexes[0];
    usedInputIndexes.add(idx);
    matchForDbId.set(Number(db.id), {
      inputIndex: idx,
      reasons: candidates.get(idx),
    });
  }

  const matchedExisting = matchForDbId.size;
  const newInputIndexes = inputRows
    .map((_, idx) => idx)
    .filter((idx) => !usedInputIndexes.has(idx));

  if (ambiguousKeep.length) {
    return {
      current,
      currentKeep,
      matchForDbId,
      matchedExisting,
      newInputIndexes,
      missingKeep,
      ambiguousKeep,
      plan: [],
      secretRegenerated: 0,
    };
  }

  if (
    matchedExisting !== EXPECTED_KEEP ||
    newInputIndexes.length !== EXPECTED_NEW
  ) {
    return {
      current,
      currentKeep,
      matchForDbId,
      matchedExisting,
      newInputIndexes,
      missingKeep,
      ambiguousKeep,
      plan: [],
      secretRegenerated: 0,
    };
  }

  const deviceTypeIds = [
    ...new Set(
      currentKeep
        .map((d) => Number(d.deviceTypeId))
        .filter(Number.isFinite)
    ),
  ];

  if (deviceTypeIds.length !== 1) {
    throw new Error(
      `SAFETY STOP: current 641 use ${deviceTypeIds.length} device types. Cannot safely choose one type for the 186 new devices.`
    );
  }

  const defaultDeviceTypeId = deviceTypeIds[0];

  const usedSecrets = new Set();
  const usedBarcodes = new Set();

  currentKeep.forEach((d) => {
    if (clean(d.secretCode)) usedSecrets.add(norm(d.secretCode));
    if (clean(d.barcode)) usedBarcodes.add(norm(d.barcode));
  });

  const plan = [];
  let secretRegenerated = 0;

  // Existing 641: preserve their backend secret code.
  for (const db of currentKeep) {
    const match = matchForDbId.get(Number(db.id));
    const r = inputRows[match.inputIndex];

    let finalSecret = clean(db.secretCode);
    if (!finalSecret) {
      const excelSecret = clean(r.excelSecret);
      if (excelSecret && !usedSecrets.has(norm(excelSecret))) {
        finalSecret = excelSecret;
        usedSecrets.add(norm(finalSecret));
      } else {
        finalSecret = generateSecret(usedSecrets);
        secretRegenerated++;
      }
    }

    plan.push({
      action: "UPDATE_KEEP",
      backendId: Number(db.id),
      inputIndex: match.inputIndex,
      matchReason: match.reasons.join("+"),
      row: r,
      finalSecret,
      deviceTypeId: Number(db.deviceTypeId),
      barcode: clean(db.barcode),
      deviceName: clean(db.deviceName) || `Device ${r.deviceCode}`,
    });
  }

  // New 186: use Excel secret if unique; otherwise generate a brand-new one.
  for (const idx of newInputIndexes) {
    const r = inputRows[idx];
    let finalSecret = clean(r.excelSecret);

    if (!finalSecret || usedSecrets.has(norm(finalSecret))) {
      finalSecret = generateSecret(usedSecrets);
      secretRegenerated++;
    } else {
      usedSecrets.add(norm(finalSecret));
    }

    const barcode = makeBarcode(
      r.deviceCode,
      r.ip,
      r.serial,
      usedBarcodes
    );

    plan.push({
      action: "INSERT_NEW",
      backendId: null,
      inputIndex: idx,
      matchReason: "NEW",
      row: r,
      finalSecret,
      deviceTypeId: defaultDeviceTypeId,
      barcode,
      deviceName: `Device ${r.deviceCode}`,
    });
  }

  // Final uniqueness check after secret assignment.
  const secretDup = dupGroups(
    plan.map((p) => ({
      deviceCode: p.row.deviceCode,
      ip: p.row.ip,
      serial: p.row.serial,
      building: p.row.building,
      cluster: p.row.cluster,
      zone: p.row.zone,
      lane: p.row.lane,
      direction: p.row.direction,
      secret: p.finalSecret,
    })),
    "Secret Code",
    (r) => r.secret
  );

  if (secretDup.length) {
    throw new Error(
      `INTERNAL SAFETY STOP: final secret codes are not unique.`
    );
  }

  return {
    current,
    currentKeep,
    matchForDbId,
    matchedExisting,
    newInputIndexes,
    missingKeep,
    ambiguousKeep,
    plan,
    secretRegenerated,
  };
}

async function exportFinalBackend() {
  const rows = await prisma.device.findMany({
    include: {
      location: true,
      deviceType: true,
    },
    orderBy: { id: "asc" },
  });

  const data = rows.map((d) => ({
    "Backend ID": d.id,
    "Device ID": clean(d.deviceCode),
    "Secret Code": clean(d.secretCode),
    IP: clean(d.ipAddress),
    Serial: clean(d.serialNumber),
    Cluster: clean(d.location?.cluster),
    "الوزارة / الجهة": clean(d.location?.building),
    Zone: clean(d.location?.zone),
    Lane: clean(d.location?.lane),
    Direction: clean(d.location?.direction),
    "Device Type": clean(d.deviceType?.name),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(data),
    "ALL 827"
  );
  XLSX.writeFile(wb, FINAL_EXPORT_FILE);
}

async function main() {
  const apply = process.argv.includes("--apply");

  console.log("============================================================");
  console.log(" IMPORT 827 DEVICES - UNIQUE SAFE IMPORT");
  console.log("============================================================");
  console.log(`Excel: ${INPUT_FILE}`);
  console.log(apply ? "MODE : APPLY" : "MODE : DRY RUN / VALIDATION");
  console.log("");

  const keepIds = loadKeepIds();

  if (keepIds.length !== EXPECTED_KEEP) {
    throw new Error(
      `SAFETY STOP: KEEP IDs=${keepIds.length}, expected ${EXPECTED_KEEP}.`
    );
  }

  const { rows: inputRows, sheetName } = readInput();

  console.log(`Sheet                    : ${sheetName}`);
  console.log(`Input rows               : ${inputRows.length}`);

  if (inputRows.length !== EXPECTED_INPUT) {
    throw new Error(
      `SAFETY STOP: expected exactly ${EXPECTED_INPUT} input rows, found ${inputRows.length}.`
    );
  }

  const blankDeviceCodes = inputRows
    .filter((r) => !r.deviceCode)
    .map((r) => ({
      Field: "Device ID",
      Value: "",
      "Excel Row": r.excelRow,
      Status: "BLANK DEVICE ID",
    }));

  const duplicateRows = [
    ...blankDeviceCodes,
    ...dupGroups(inputRows, "Device ID", (r) => r.deviceCode),
    ...dupGroups(inputRows, "IP", (r) => r.ip),
    ...dupGroups(inputRows, "Serial", (r) => r.serial),
  ];

  const invalidIpRows = inputRows
    .filter((r) => r.rawIp && !r.ip)
    .map((r) => ({
      Field: "Invalid IP -> stored NULL",
      Value: r.rawIp,
      "Excel Row": r.excelRow,
      "Device ID": r.deviceCode,
      Status: "NOT A VALID IPv4",
    }));

  const invalidSerialRows = inputRows
    .filter((r) => r.rawSerial && !r.serial)
    .map((r) => ({
      Field: "Invalid Serial -> stored NULL",
      Value: r.rawSerial,
      "Excel Row": r.excelRow,
      "Device ID": r.deviceCode,
      Status: "NOT A VALID SERIAL",
    }));

  const planInfo = await buildPlan(inputRows, keepIds);

  const matchRows = planInfo.plan.length
    ? planInfo.plan
        .sort((a, b) => a.inputIndex - b.inputIndex)
        .map((p) => ({
          Action: p.action,
          "Excel Row": p.row.excelRow,
          "Backend ID": p.backendId || "",
          "Device ID": p.row.deviceCode,
          IP: p.row.ip,
          Serial: p.row.serial,
          "Secret Code": p.finalSecret,
          Cluster: p.row.cluster,
          Ministry: p.row.building,
          Zone: p.row.zone,
          Lane: p.row.lane,
          Direction: p.row.direction,
          Match: p.matchReason,
        }))
    : [];

  const summary = [
    { Metric: "Input rows", Value: inputRows.length },
    { Metric: "Duplicate Device/IP/Serial rows", Value: duplicateRows.length },
    { Metric: "Invalid IP values -> NULL", Value: invalidIpRows.length },
    { Metric: "Invalid Serial values -> NULL", Value: invalidSerialRows.length },
    { Metric: "Existing KEEP matched", Value: planInfo.matchedExisting },
    { Metric: "New devices", Value: planInfo.newInputIndexes.length },
    { Metric: "KEEP not matched", Value: planInfo.missingKeep.length },
    { Metric: "KEEP ambiguous", Value: planInfo.ambiguousKeep.length },
    { Metric: "Secret codes regenerated", Value: planInfo.secretRegenerated },
  ];

  writePrecheck({
    summary,
    duplicateRows: [
      ...duplicateRows,
      ...invalidIpRows,
      ...invalidSerialRows,
      ...planInfo.ambiguousKeep,
    ],
    matchRows,
    missingKeepRows: planInfo.missingKeep,
    inputRows,
  });

  console.log("");
  console.log("VALIDATION");
  console.log("------------------------------------------------------------");
  console.log(`Duplicate Device/IP/Serial: ${duplicateRows.length}`);
  console.log(`Invalid IP -> NULL         : ${invalidIpRows.length}`);
  console.log(`Invalid Serial -> NULL     : ${invalidSerialRows.length}`);
  console.log(`Existing KEEP matched      : ${planInfo.matchedExisting} / 641`);
  console.log(`New devices                : ${planInfo.newInputIndexes.length} / 186`);
  console.log(`KEEP not matched           : ${planInfo.missingKeep.length}`);
  console.log(`KEEP ambiguous             : ${planInfo.ambiguousKeep.length}`);
  console.log(`Secret regenerated         : ${planInfo.secretRegenerated}`);
  console.log(`Precheck Excel             : ${PRECHECK_FILE}`);

  if (
    duplicateRows.length ||
    planInfo.missingKeep.length ||
    planInfo.ambiguousKeep.length ||
    planInfo.matchedExisting !== EXPECTED_KEEP ||
    planInfo.newInputIndexes.length !== EXPECTED_NEW ||
    planInfo.plan.length !== EXPECTED_INPUT
  ) {
    console.log("");
    console.log("❌ NOT READY TO IMPORT.");
    console.log("❌ NO DATABASE CHANGES WERE MADE.");
    console.log("Open IMPORT_827_PRECHECK.xlsx to see the exact problem rows.");
    process.exitCode = 3;
    return;
  }

  console.log("");
  console.log("✅ PRECHECK PASSED");
  console.log("✅ 827 Device IDs are unique.");
  console.log("✅ All valid IP values are unique.");
  console.log("✅ All valid Serial values are unique.");
  console.log("✅ Final Secret Codes are unique and non-empty.");
  console.log("✅ 641 existing KEEP devices are matched.");
  console.log("✅ 186 devices will be inserted.");
  console.log("✅ Final backend Device count will be 827.");

  if (!apply) {
    console.log("");
    console.log("============================================================");
    console.log(" DRY RUN ONLY ✅");
    console.log("============================================================");
    console.log("NO DATABASE CHANGES WERE MADE.");
    console.log("");
    console.log("To apply:");
    console.log("node scripts\\import-827-unique-safe.cjs --apply");
    return;
  }

  const confirm = await ask(
    "Type IMPORT-827-UNIQUE to continue: "
  );

  if (confirm !== "IMPORT-827-UNIQUE") {
    console.log("❌ Cancelled. NO DATABASE CHANGES WERE MADE.");
    return;
  }

  const backupDir = path.join(process.cwd(), "backup");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const backupPath = path.join(
    backupDir,
    `before-import-827-${stamp}.json`
  );

  fs.writeFileSync(
    backupPath,
    JSON.stringify(planInfo.current, (k, v) =>
      typeof v === "bigint" ? v.toString() : v
    , 2),
    "utf8"
  );

  console.log(`Backup: ${backupPath}`);

  const sortedPlan = [...planInfo.plan].sort(
    (a, b) => a.inputIndex - b.inputIndex
  );

  const existingPlan = sortedPlan.filter(
    (p) => p.action === "UPDATE_KEEP"
  );
  const newPlan = sortedPlan.filter(
    (p) => p.action === "INSERT_NEW"
  );

  const locationCache = new Map();

  const result = await prisma.$transaction(
    async (tx) => {
      const dbBefore = await tx.device.findMany({
        select: { id: true },
        orderBy: { id: "asc" },
      });

      const beforeIds = new Set(dbBefore.map((d) => Number(d.id)));

      if (
        dbBefore.length !== EXPECTED_KEEP ||
        keepIds.some((id) => !beforeIds.has(Number(id)))
      ) {
        throw new Error(
          "ROLLBACK: backend changed after dry-run; expected exactly the protected 641."
        );
      }

      // Phase 1: free unique DeviceCode/Serial values so swaps/renumbering cannot collide.
      for (const p of existingPlan) {
        await tx.device.update({
          where: { id: p.backendId },
          data: {
            deviceCode: `TMP827-${p.backendId}-${Date.now()}`,
            serialNumber: null,
          },
        });
      }

      async function getLocationId(r) {
        const key = locationKey(r);
        if (locationCache.has(key)) return locationCache.get(key);

        let loc = await tx.location.findFirst({
          where: {
            cluster: r.cluster,
            building: r.building,
            zone: r.zone,
            lane: r.lane,
            direction: r.direction,
          },
        });

        if (!loc) {
          let excelId = locationExcelId(r);
          const sameExcelId = await tx.location.findFirst({
            where: { excelId },
          });

          if (sameExcelId) {
            excelId = `${excelId}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
          }

          loc = await tx.location.create({
            data: {
              cluster: r.cluster,
              building: r.building,
              zone: r.zone,
              lane: r.lane,
              direction: r.direction,
              excelId,
              type: "DEVICE",
            },
          });
        }

        locationCache.set(key, Number(loc.id));
        return Number(loc.id);
      }

      let updated = 0;
      let inserted = 0;

      for (const p of existingPlan) {
        const locationId = await getLocationId(p.row);

        await tx.device.update({
          where: { id: p.backendId },
          data: {
            deviceCode: p.row.deviceCode,
            deviceName: p.deviceName,
            ipAddress: p.row.ip || null,
            serialNumber: p.row.serial || null,
            secretCode: p.finalSecret,
            assetType: "DEVICE",
            locationId,
          },
        });

        updated++;
      }

      for (const p of newPlan) {
        const locationId = await getLocationId(p.row);

        await tx.device.create({
          data: {
            deviceCode: p.row.deviceCode,
            deviceName: p.deviceName,
            barcode: p.barcode,
            ipAddress: p.row.ip || null,
            serialNumber: p.row.serial || null,
            secretCode: p.finalSecret,
            assetType: "DEVICE",
            currentStatus: "OK",
            lifecycleStatus: "ACTIVE",
            deviceTypeId: p.deviceTypeId,
            locationId,
            notes: "Imported from ALL_827_NO_DUP_WITH_IP_ (1).xlsx",
          },
        });

        inserted++;
      }

      const finalRows = await tx.device.findMany({
        select: {
          id: true,
          deviceCode: true,
          ipAddress: true,
          serialNumber: true,
          secretCode: true,
        },
      });

      if (finalRows.length !== EXPECTED_INPUT) {
        throw new Error(
          `ROLLBACK: final Device count=${finalRows.length}, expected 827.`
        );
      }

      const countUnique = (values) =>
        new Set(
          values
            .map((v) => norm(v))
            .filter(Boolean)
        ).size;

      const codes = finalRows.map((r) => r.deviceCode);
      const ips = finalRows.map((r) => r.ipAddress).filter(Boolean);
      const serials = finalRows
        .map((r) => r.serialNumber)
        .filter(Boolean);
      const secrets = finalRows.map((r) => r.secretCode).filter(Boolean);

      if (countUnique(codes) !== EXPECTED_INPUT) {
        throw new Error("ROLLBACK: final Device Codes are not unique.");
      }

      if (countUnique(ips) !== ips.length) {
        throw new Error("ROLLBACK: final IP values are not unique.");
      }

      if (countUnique(serials) !== serials.length) {
        throw new Error("ROLLBACK: final Serial values are not unique.");
      }

      if (
        secrets.length !== EXPECTED_INPUT ||
        countUnique(secrets) !== EXPECTED_INPUT
      ) {
        throw new Error(
          "ROLLBACK: every device must have one unique Secret Code."
        );
      }

      const keepAfter = await tx.device.count({
        where: {
          id: { in: keepIds },
        },
      });

      if (keepAfter !== EXPECTED_KEEP) {
        throw new Error(
          `ROLLBACK: protected KEEP IDs after import=${keepAfter}/641.`
        );
      }

      return {
        updated,
        inserted,
        total: finalRows.length,
        uniqueCodes: countUnique(codes),
        uniqueIps: countUnique(ips),
        ipCount: ips.length,
        uniqueSerials: countUnique(serials),
        serialCount: serials.length,
        uniqueSecrets: countUnique(secrets),
        keepAfter,
      };
    },
    {
      maxWait: 10000,
      timeout: 180000,
    }
  );

  await exportFinalBackend();

  console.log("");
  console.log("============================================================");
  console.log(" IMPORT SUCCESS ✅");
  console.log("============================================================");
  console.log(`Updated existing KEEP     : ${result.updated}`);
  console.log(`Inserted new devices      : ${result.inserted}`);
  console.log(`Final Device count        : ${result.total}`);
  console.log(`Protected KEEP IDs        : ${result.keepAfter} / 641`);
  console.log(`Unique Device Codes       : ${result.uniqueCodes} / 827`);
  console.log(`Unique IPs                : ${result.uniqueIps} / ${result.ipCount}`);
  console.log(`Unique Serials            : ${result.uniqueSerials} / ${result.serialCount}`);
  console.log(`Unique Secret Codes       : ${result.uniqueSecrets} / 827`);
  console.log(`Final Excel export        : ${FINAL_EXPORT_FILE}`);
  console.log("");
  console.log("✅ EXACTLY 827 DEVICES IN BACKEND.");
  console.log("✅ ALL 641 KEEP BACKEND IDs ARE PRESERVED.");
  console.log("✅ NO DUPLICATE DEVICE ID / IP / SERIAL / SECRET CODE.");
  console.log("✅ EVERY DEVICE HAS A UNIQUE SECRET CODE.");
}

main()
  .catch((err) => {
    console.error("");
    console.error("❌ ERROR:", err.message || err);
    console.error("If a transaction started, it was rolled back.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
