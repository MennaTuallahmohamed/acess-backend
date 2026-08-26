const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const INPUT_FILE =
  "C:\\Users\\Mena\\Downloads\\ALL_827_secret code.xlsx";

const KEEP_IDS_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\PROTECTED_641_IDS.json";

const PRECHECK_REPORT =
  "C:\\Users\\Mena\\Desktop\\Devices\\ALL_827_SECRET_CODE_PRECHECK.xlsx";

const FINAL_BACKEND_EXPORT =
  "C:\\Users\\Mena\\Desktop\\Devices\\BACKEND_FINAL_827_WITH_SECRET.xlsx";

const EXPECTED_TOTAL = 827;
const EXPECTED_KEEP = 641;
const EXPECTED_NEW = 186;

function clean(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function norm(v) {
  return clean(v).toLowerCase().replace(/\s+/g, " ");
}

function normalizeKey(v) {
  return norm(v).replace(/\s+/g, " ").trim();
}

function normalizeRowKeys(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[normalizeKey(k)] = v;
  }
  return out;
}

function get(row, names) {
  for (const name of names) {
    const key = normalizeKey(name);
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const v = clean(row[key]);
      if (v !== "") return v;
    }
  }
  return "";
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
  if (/^-?\d+\.0+$/.test(s)) return String(parseInt(s, 10));
  return s;
}

function normalizeDirection(v) {
  return clean(v).toUpperCase();
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
  if (!/^[A-Za-z0-9._-]{5,}$/.test(s)) return "";
  return s;
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

function duplicateGroups(rows, field, getter) {
  const map = new Map();

  rows.forEach((row, index) => {
    const value = clean(getter(row));
    if (!value) return;

    const key = norm(value);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ row, index });
  });

  const groups = [];

  for (const items of map.values()) {
    if (items.length <= 1) continue;

    groups.push({
      Field: field,
      Value: clean(getter(items[0].row)),
      Count: items.length,
      "Excel Rows": items.map(x => x.row.excelRow).join(", "),
      "Device IDs": items.map(x => x.row.deviceCode).join(", "),
    });
  }

  return groups;
}

function readInput() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Excel file not found: ${INPUT_FILE}`);
  }

  const wb = XLSX.readFile(INPUT_FILE, { raw: false, cellDates: false });

  const sheetName = wb.SheetNames.includes("كل الأجهزة")
    ? "كل الأجهزة"
    : wb.SheetNames[0];

  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    defval: "",
    raw: false,
  });

  const headers = Object.keys(rawRows[0] || {});

  const rows = rawRows.map((raw, index) => {
    const r = normalizeRowKeys(raw);

    // User confirmed OLD/NEW is intentional:
    // final values use NEW first, then normal column, then OLD.
    const ipRaw = first(
      get(r, ["IP NEW"]),
      get(r, ["IP"]),
      get(r, ["IP Address"]),
      get(r, ["IP OLD"])
    );

    const serialRaw = first(
      get(r, ["Serial NEW"]),
      get(r, ["Serial"]),
      get(r, ["Serial Number"]),
      get(r, ["Serial OLD"])
    );

    return {
      excelRow: index + 2,

      deviceCode: get(r, ["Device ID", "Device Code", "deviceCode"]),
      secretCode: get(r, ["Secret Code", "secretCode", "Secret"]),

      ipRaw,
      ipAddress: validIPv4(ipRaw),

      serialRaw,
      serialNumber: validSerial(serialRaw),

      building: get(r, ["اسم الوزارة / الجهة", "Building", "Ministry"]),

      cluster: first(
        get(r, ["Cluster NEW"]),
        get(r, ["Cluster"]),
        get(r, ["Cluster OLD"])
      ),

      zone: first(
        get(r, ["Zone NEW"]),
        get(r, ["Zone"]),
        get(r, ["Zone OLD"])
      ),

      lane: normalizeLane(
        first(
          get(r, ["Lane NEW"]),
          get(r, ["Lane"]),
          get(r, ["Lane OLD"])
        )
      ),

      direction: normalizeDirection(
        get(r, ["Direction", "direction"])
      ),
    };
  }).filter(r =>
    [
      r.deviceCode,
      r.secretCode,
      r.ipRaw,
      r.serialRaw,
      r.building,
      r.cluster,
      r.zone,
    ].some(Boolean)
  );

  return { sheetName, headers, rows };
}

function locationKey(r) {
  return [
    norm(r.cluster),
    norm(r.building),
    norm(r.zone),
    norm(r.lane),
    norm(r.direction),
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

function makeBarcode(deviceCode, secretCode, used) {
  const base =
    `DEV827-${clean(deviceCode)}-` +
    crypto
      .createHash("sha1")
      .update(`${deviceCode}|${secretCode}`)
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

function writePrecheck({
  summary,
  duplicates,
  invalidRows,
  missingKeep,
  plan,
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
      duplicates.length ? duplicates : [{ Result: "NO DUPLICATES" }]
    ),
    "Duplicates"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      invalidRows.length ? invalidRows : [{ Result: "NO INVALID ROWS" }]
    ),
    "Invalid"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      missingKeep.length
        ? missingKeep
        : [{ Result: "ALL 641 BACKEND SECRETS FOUND IN FILE" }]
    ),
    "KEEP Check"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(plan),
    "Import Plan"
  );

  XLSX.writeFile(wb, PRECHECK_REPORT);
}

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(String(answer || "").trim());
    });
  });
}

async function exportBackend() {
  const rows = await prisma.device.findMany({
    include: {
      location: true,
      deviceType: true,
    },
    orderBy: { id: "asc" },
  });

  const output = rows.map(d => ({
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
    XLSX.utils.json_to_sheet(output),
    "FINAL 827"
  );

  XLSX.writeFile(wb, FINAL_BACKEND_EXPORT);
}

async function main() {
  const apply = process.argv.includes("--apply");

  console.log("============================================================");
  console.log(" IMPORT ALL_827_secret code.xlsx");
  console.log(" MATCH CURRENT 641 BY UNIQUE SECRET CODE");
  console.log(" 641 UPDATE + 186 INSERT = 827");
  console.log("============================================================");
  console.log(apply ? "MODE: APPLY" : "MODE: DRY RUN / VALIDATION");
  console.log("");

  const keepIds = loadKeepIds();

  if (keepIds.length !== EXPECTED_KEEP) {
    throw new Error(
      `SAFETY STOP: protected IDs=${keepIds.length}, expected 641.`
    );
  }

  const { sheetName, headers, rows } = readInput();

  console.log(`File        : ${INPUT_FILE}`);
  console.log(`Sheet       : ${sheetName}`);
  console.log(`Excel rows  : ${rows.length}`);
  console.log(`Headers     : ${headers.join(" | ")}`);
  console.log("");

  if (rows.length !== EXPECTED_TOTAL) {
    throw new Error(
      `SAFETY STOP: expected exactly 827 Excel rows, found ${rows.length}.`
    );
  }

  const duplicates = [
    ...duplicateGroups(rows, "Device ID", r => r.deviceCode),
    ...duplicateGroups(rows, "Secret Code", r => r.secretCode),
    ...duplicateGroups(rows, "IP", r => r.ipAddress),
    ...duplicateGroups(rows, "Serial", r => r.serialNumber),
  ];

  const invalidRows = [];

  for (const r of rows) {
    const reasons = [];

    if (!r.deviceCode) reasons.push("BLANK DEVICE ID");
    if (!r.secretCode) reasons.push("BLANK SECRET CODE");

    if (r.ipRaw && !r.ipAddress) {
      reasons.push(`INVALID IP: ${r.ipRaw}`);
    }

    if (r.serialRaw && !r.serialNumber) {
      reasons.push(`INVALID SERIAL: ${r.serialRaw}`);
    }

    if (!r.building) reasons.push("BLANK MINISTRY/BUILDING");
    if (!r.cluster) reasons.push("BLANK CLUSTER");
    if (!r.zone) reasons.push("BLANK ZONE");
    if (!r.lane) reasons.push("BLANK LANE");
    if (!r.direction) reasons.push("BLANK DIRECTION");

    if (reasons.length) {
      invalidRows.push({
        "Excel Row": r.excelRow,
        "Device ID": r.deviceCode,
        "Secret Code": r.secretCode,
        IP: r.ipRaw,
        Serial: r.serialRaw,
        Reason: reasons.join(" | "),
      });
    }
  }

  const current = await prisma.device.findMany({
    include: {
      location: true,
      deviceType: true,
    },
    orderBy: { id: "asc" },
  });

  const keepSet = new Set(keepIds.map(Number));
  const currentKeep = current.filter(d => keepSet.has(Number(d.id)));
  const outsideKeep = current.filter(d => !keepSet.has(Number(d.id)));

  if (
    current.length !== EXPECTED_KEEP ||
    currentKeep.length !== EXPECTED_KEEP ||
    outsideKeep.length !== 0
  ) {
    throw new Error(
      `SAFETY STOP: backend must currently contain exactly protected 641. total=${current.length}, keep=${currentKeep.length}, outside=${outsideKeep.length}.`
    );
  }

  const currentSecretDup = duplicateGroups(
    currentKeep.map((d, i) => ({
      excelRow: i + 1,
      deviceCode: d.deviceCode,
      secretCode: d.secretCode,
    })),
    "CURRENT BACKEND SECRET",
    r => r.secretCode
  );

  const backendMissingSecret = currentKeep.filter(d => !clean(d.secretCode));

  if (currentSecretDup.length || backendMissingSecret.length) {
    throw new Error(
      `SAFETY STOP: current 641 secret codes are not fully unique/non-empty. duplicates=${currentSecretDup.length}, blank=${backendMissingSecret.length}.`
    );
  }

  // The key idea: current 641 are matched ONLY by their unique Secret Code.
  // Device ID/IP/Serial may change and do not affect identity matching.
  const excelBySecret = new Map();

  rows.forEach((r, idx) => {
    const key = norm(r.secretCode);
    if (key) excelBySecret.set(key, { r, idx });
  });

  const matched = [];
  const missingKeep = [];
  const matchedExcelIndexes = new Set();

  for (const d of currentKeep) {
    const found = excelBySecret.get(norm(d.secretCode));

    if (!found) {
      missingKeep.push({
        "Backend ID": d.id,
        "Current Device ID": clean(d.deviceCode),
        "Current Secret Code": clean(d.secretCode),
        "Current IP": clean(d.ipAddress),
        "Current Serial": clean(d.serialNumber),
      });
      continue;
    }

    matched.push({
      backend: d,
      row: found.r,
      inputIndex: found.idx,
    });

    matchedExcelIndexes.add(found.idx);
  }

  const newRows = rows
    .map((r, idx) => ({ r, idx }))
    .filter(x => !matchedExcelIndexes.has(x.idx));

  const typeIds = [
    ...new Set(
      currentKeep
        .map(d => Number(d.deviceTypeId))
        .filter(Number.isFinite)
    ),
  ];

  if (typeIds.length !== 1) {
    throw new Error(
      `SAFETY STOP: current 641 use ${typeIds.length} device types; cannot safely infer type for new 186.`
    );
  }

  const defaultDeviceTypeId = typeIds[0];

  const plan = [
    ...matched.map(x => ({
      Action: "UPDATE KEEP BY SECRET",
      "Backend ID": x.backend.id,
      "Excel Row": x.row.excelRow,
      "Device ID": x.row.deviceCode,
      "Secret Code": x.row.secretCode,
      IP: x.row.ipAddress,
      Serial: x.row.serialNumber,
      Cluster: x.row.cluster,
      "الوزارة / الجهة": x.row.building,
      Zone: x.row.zone,
      Lane: x.row.lane,
      Direction: x.row.direction,
    })),
    ...newRows.map(x => ({
      Action: "INSERT NEW",
      "Backend ID": "",
      "Excel Row": x.r.excelRow,
      "Device ID": x.r.deviceCode,
      "Secret Code": x.r.secretCode,
      IP: x.r.ipAddress,
      Serial: x.r.serialNumber,
      Cluster: x.r.cluster,
      "الوزارة / الجهة": x.r.building,
      Zone: x.r.zone,
      Lane: x.r.lane,
      Direction: x.r.direction,
    })),
  ];

  const summary = [
    { Metric: "Excel rows", Value: rows.length },
    { Metric: "Current backend", Value: current.length },
    { Metric: "Protected KEEP", Value: currentKeep.length },
    { Metric: "Duplicate groups", Value: duplicates.length },
    { Metric: "Invalid rows", Value: invalidRows.length },
    { Metric: "KEEP matched by Secret Code", Value: matched.length },
    { Metric: "KEEP secret missing from file", Value: missingKeep.length },
    { Metric: "New rows", Value: newRows.length },
    { Metric: "Expected final backend", Value: matched.length + newRows.length },
  ];

  writePrecheck({
    summary,
    duplicates,
    invalidRows,
    missingKeep,
    plan,
  });

  console.log("VALIDATION");
  console.log("------------------------------------------------------------");
  console.log(`Duplicate groups            : ${duplicates.length}`);
  console.log(`Invalid rows                : ${invalidRows.length}`);
  console.log(`KEEP matched by Secret Code : ${matched.length} / 641`);
  console.log(`KEEP missing from file      : ${missingKeep.length}`);
  console.log(`New devices                 : ${newRows.length} / 186`);
  console.log(`Expected final backend      : ${matched.length + newRows.length}`);
  console.log(`Precheck report             : ${PRECHECK_REPORT}`);

  const ready =
    duplicates.length === 0 &&
    invalidRows.length === 0 &&
    matched.length === EXPECTED_KEEP &&
    missingKeep.length === 0 &&
    newRows.length === EXPECTED_NEW;

  if (!ready) {
    console.log("");
    console.log("❌ NOT READY.");
    console.log("❌ NO DATABASE CHANGES WERE MADE.");
    console.log("Open the PRECHECK Excel; exact duplicates/problems are listed there.");
    process.exitCode = 3;
    return;
  }

  console.log("");
  console.log("✅ READY");
  console.log("✅ 827 unique Device IDs");
  console.log("✅ 827 unique Secret Codes");
  console.log("✅ IP values unique");
  console.log("✅ Serial values unique");
  console.log("✅ Current 641 matched exactly by Secret Code");
  console.log("✅ 186 new devices identified");
  console.log("✅ Final backend will be exactly 827");

  if (!apply) {
    console.log("");
    console.log("============================================================");
    console.log(" DRY RUN ONLY ✅");
    console.log("============================================================");
    console.log("NO DATABASE CHANGES WERE MADE.");
    console.log("");
    console.log("To import:");
    console.log("node scripts\\import-827-by-secret-final.cjs --apply");
    return;
  }

  const backupDir = path.join(process.cwd(), "backup");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const backupPath = path.join(
    backupDir,
    `before-import-827-by-secret-${stamp}.json`
  );

  fs.writeFileSync(
    backupPath,
    JSON.stringify(current, (k, v) =>
      typeof v === "bigint" ? v.toString() : v
    , 2),
    "utf8"
  );

  console.log("");
  console.log(`Backup: ${backupPath}`);
  console.log("");
  console.log("FINAL PLAN");
  console.log("------------------------------------------------------------");
  console.log("UPDATE existing KEEP by Secret Code : 641");
  console.log("INSERT new devices                  : 186");
  console.log("FINAL Device count                  : 827");
  console.log("");

  const confirm = await ask(
    "Type IMPORT-827-BY-SECRET to continue: "
  );

  if (confirm !== "IMPORT-827-BY-SECRET") {
    console.log("❌ Cancelled. NO DATABASE CHANGES WERE MADE.");
    return;
  }

  const usedBarcodes = new Set(
    current.map(d => norm(d.barcode)).filter(Boolean)
  );

  const locationCache = new Map();

  const result = await prisma.$transaction(
    async tx => {
      // Re-check immediately before write.
      const before = await tx.device.findMany({
        select: {
          id: true,
          secretCode: true,
        },
      });

      if (before.length !== 641) {
        throw new Error(
          `ROLLBACK: backend changed before import. Expected 641, found ${before.length}.`
        );
      }

      const beforeIds = new Set(before.map(d => Number(d.id)));

      if (keepIds.some(id => !beforeIds.has(Number(id)))) {
        throw new Error(
          "ROLLBACK: protected KEEP IDs changed before import."
        );
      }

      // Temporarily free UNIQUE columns that may be renumbered/swapped.
      for (const x of matched) {
        await tx.device.update({
          where: { id: Number(x.backend.id) },
          data: {
            deviceCode:
              `TMP827-${x.backend.id}-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`,
            serialNumber: null,
          },
        });
      }

      async function getLocationId(r) {
        const key = locationKey(r);

        if (locationCache.has(key)) {
          return locationCache.get(key);
        }

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

          const collision = await tx.location.findFirst({
            where: { excelId },
          });

          if (collision) {
            excelId =
              `${excelId}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
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

      for (const x of matched) {
        const locationId = await getLocationId(x.row);

        await tx.device.update({
          where: { id: Number(x.backend.id) },
          data: {
            deviceCode: x.row.deviceCode,
            deviceName:
              clean(x.backend.deviceName) || `Device ${x.row.deviceCode}`,
            ipAddress: x.row.ipAddress || null,
            serialNumber: x.row.serialNumber || null,
            secretCode: x.row.secretCode,
            assetType: "DEVICE",
            deviceTypeId: Number(x.backend.deviceTypeId),
            locationId,
          },
        });

        updated++;
      }

      for (const x of newRows) {
        const locationId = await getLocationId(x.r);

        const barcode = makeBarcode(
          x.r.deviceCode,
          x.r.secretCode,
          usedBarcodes
        );

        await tx.device.create({
          data: {
            deviceCode: x.r.deviceCode,
            deviceName: `Device ${x.r.deviceCode}`,
            barcode,
            ipAddress: x.r.ipAddress || null,
            serialNumber: x.r.serialNumber || null,
            secretCode: x.r.secretCode,
            assetType: "DEVICE",
            currentStatus: "OK",
            lifecycleStatus: "ACTIVE",
            deviceTypeId: defaultDeviceTypeId,
            locationId,
            notes: "Imported from ALL_827_secret code.xlsx",
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

      if (finalRows.length !== 827) {
        throw new Error(
          `ROLLBACK: final count=${finalRows.length}, expected 827.`
        );
      }

      const uniqCount = values =>
        new Set(values.map(norm).filter(Boolean)).size;

      const codes = finalRows.map(r => r.deviceCode);
      const secrets = finalRows.map(r => r.secretCode);
      const ips = finalRows.map(r => r.ipAddress).filter(Boolean);
      const serials = finalRows.map(r => r.serialNumber).filter(Boolean);

      if (
        codes.some(v => !clean(v)) ||
        uniqCount(codes) !== 827
      ) {
        throw new Error(
          "ROLLBACK: final Device IDs are missing or duplicated."
        );
      }

      if (
        secrets.some(v => !clean(v)) ||
        uniqCount(secrets) !== 827
      ) {
        throw new Error(
          "ROLLBACK: final Secret Codes are missing or duplicated."
        );
      }

      if (uniqCount(ips) !== ips.length) {
        throw new Error(
          "ROLLBACK: duplicate IP exists after import."
        );
      }

      if (uniqCount(serials) !== serials.length) {
        throw new Error(
          "ROLLBACK: duplicate Serial exists after import."
        );
      }

      const keepAfter = await tx.device.count({
        where: {
          id: { in: keepIds },
        },
      });

      if (keepAfter !== 641) {
        throw new Error(
          `ROLLBACK: protected KEEP backend IDs=${keepAfter}/641.`
        );
      }

      return {
        updated,
        inserted,
        total: finalRows.length,
        keepAfter,
        uniqueCodes: uniqCount(codes),
        uniqueSecrets: uniqCount(secrets),
        uniqueIps: uniqCount(ips),
        ipCount: ips.length,
        uniqueSerials: uniqCount(serials),
        serialCount: serials.length,
      };
    },
    {
      maxWait: 10000,
      timeout: 180000,
    }
  );

  await exportBackend();

  console.log("");
  console.log("============================================================");
  console.log(" IMPORT SUCCESS ✅");
  console.log("============================================================");
  console.log(`Updated KEEP by Secret Code : ${result.updated}`);
  console.log(`Inserted new                : ${result.inserted}`);
  console.log(`Final Device count          : ${result.total}`);
  console.log(`Protected KEEP Backend IDs  : ${result.keepAfter} / 641`);
  console.log(`Unique Device IDs           : ${result.uniqueCodes} / 827`);
  console.log(`Unique Secret Codes         : ${result.uniqueSecrets} / 827`);
  console.log(`Unique IPs                  : ${result.uniqueIps} / ${result.ipCount}`);
  console.log(`Unique Serials              : ${result.uniqueSerials} / ${result.serialCount}`);
  console.log(`Final backend Excel         : ${FINAL_BACKEND_EXPORT}`);
  console.log("");
  console.log("✅ EXACTLY 827 DEVICES.");
  console.log("✅ ALL 641 EXISTING BACKEND IDs PRESERVED.");
  console.log("✅ MATCHING USED SECRET CODE, NOT OLD/NEW VALUES.");
  console.log("✅ NO DUPLICATE DEVICE ID / SECRET / IP / SERIAL.");
}

main()
  .catch(err => {
    console.error("");
    console.error("❌ ERROR:", err.message || err);
    console.error("If the transaction started, it was rolled back.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
