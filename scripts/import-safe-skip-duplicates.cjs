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

const REPORT_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\IMPORT_SAFE_AND_DUPLICATES_REPORT.xlsx";

const FINAL_EXPORT_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\BACKEND_AFTER_SAFE_IMPORT.xlsx";

const EXPECTED_KEEP = 641;

function clean(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function norm(v) {
  return clean(v).toLowerCase().replace(/\s+/g, " ");
}

function normKey(v) {
  return norm(v).replace(/\s+/g, " ").trim();
}

function normalizeLane(v) {
  const s = clean(v);
  if (!s) return "";
  if (/^-?\d+\.0+$/.test(s)) return String(parseInt(s, 10));
  return s;
}

function normalizeDirection(v) {
  return clean(v).toUpperCase();
}

function validIPv4(v) {
  const s = clean(v);
  if (!s) return "";
  const p = s.split(".");
  if (p.length !== 4) return "";
  if (!p.every(x => /^\d{1,3}$/.test(x) && Number(x) >= 0 && Number(x) <= 255)) {
    return "";
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

function normalizeObjectKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[normKey(k)] = v;
  }
  return out;
}

function get(row, names) {
  for (const name of names) {
    const key = normKey(name);
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

function parseInput() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Excel not found: ${INPUT_FILE}`);
  }

  const wb = XLSX.readFile(INPUT_FILE, { raw: false, cellDates: false });
  const sheetName = wb.SheetNames.includes("كل الأجهزة")
    ? "كل الأجهزة"
    : wb.SheetNames[0];

  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    defval: "",
    raw: false,
  });

  const rows = rawRows.map((raw, index) => {
    const r = normalizeObjectKeys(raw);

    const ipOld = get(r, ["IP OLD", "OLD IP"]);
    const ipNew = get(r, ["IP NEW", "NEW IP"]);
    const serialOld = get(r, ["Serial OLD", "OLD Serial"]);
    const serialNew = get(r, ["Serial NEW", "NEW Serial"]);

    const finalIpRaw = first(ipNew, ipOld);
    const finalSerialRaw = first(serialNew, serialOld);

    return {
      excelRow: index + 2,
      deviceCode: get(r, ["Device ID", "Device Code"]),
      building: get(r, ["اسم الوزارة / الجهة", "Building"]),
      cluster: first(get(r, ["Cluster NEW"]), get(r, ["Cluster OLD"]), get(r, ["Cluster"])),
      zone: first(get(r, ["Zone NEW"]), get(r, ["Zone OLD"]), get(r, ["Zone"])),
      lane: normalizeLane(
        first(get(r, ["Lane NEW"]), get(r, ["Lane OLD"]), get(r, ["Lane"]))
      ),
      direction: normalizeDirection(get(r, ["Direction"])),
      ipOld,
      ipNew,
      finalIpRaw,
      finalIp: validIPv4(finalIpRaw),
      serialOld,
      serialNew,
      finalSerialRaw,
      finalSerial: validSerial(finalSerialRaw),
      sourceSecret: get(r, ["Secret Code"]),
      comment: get(r, ["COMMENT"]),
      printQr: get(r, ["طباعه QR؟"]),
      printReason: get(r, ["سبب الطباعة"]),
    };
  }).filter(r => [
    r.deviceCode,
    r.building,
    r.cluster,
    r.zone,
    r.ipOld,
    r.ipNew,
    r.serialOld,
    r.serialNew,
  ].some(Boolean));

  return { sheetName, rows };
}

function membershipMap(rows, getter) {
  const groups = new Map();

  rows.forEach((r, idx) => {
    const raw = clean(getter(r));
    if (!raw) return;
    const key = norm(raw);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(idx);
  });

  const dupMembership = new Map();
  const groupRows = [];

  for (const [key, idxs] of groups.entries()) {
    if (idxs.length <= 1) continue;

    for (const idx of idxs) {
      if (!dupMembership.has(idx)) dupMembership.set(idx, []);
    }

    groupRows.push({ key, idxs });
  }

  return { dupMembership, groupRows };
}

function addReason(reasonMap, idx, reason) {
  if (!reasonMap.has(idx)) reasonMap.set(idx, new Set());
  reasonMap.get(idx).add(reason);
}

function randomSecret(used) {
  while (true) {
    const h = crypto.randomBytes(8).toString("hex").toUpperCase();
    const secret =
      `DSC-${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}`;

    if (!used.has(norm(secret))) {
      used.add(norm(secret));
      return secret;
    }
  }
}

function uniqueBarcode(deviceCode, ip, serial, used) {
  const base =
    `DEV-${clean(deviceCode)}-` +
    crypto
      .createHash("sha1")
      .update(`${deviceCode}|${ip}|${serial}`)
      .digest("hex")
      .slice(0, 10)
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
    norm(r.cluster),
    norm(r.building),
    norm(r.zone),
    norm(r.lane),
    norm(r.direction),
  ].join("|");
}

function locationExcelId(r) {
  return (
    "SAFE-" +
    crypto.createHash("sha1").update(locationKey(r)).digest("hex").slice(0, 16).toUpperCase()
  );
}

function asReportRow(r, status, reason = "") {
  return {
    Status: status,
    Reason: reason,
    "Excel Row": r.excelRow,
    "Device ID": r.deviceCode,
    "IP OLD": r.ipOld,
    "IP NEW": r.ipNew,
    "Final IP": r.finalIp,
    "Serial OLD": r.serialOld,
    "Serial NEW": r.serialNew,
    "Final Serial": r.finalSerial,
    Cluster: r.cluster,
    "الوزارة / الجهة": r.building,
    Zone: r.zone,
    Lane: r.lane,
    Direction: r.direction,
    "Source Secret": r.sourceSecret,
    COMMENT: r.comment,
  };
}

function writeReport({ summary, safePlan, skipped, duplicateDetails }) {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(summary),
    "Summary"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      safePlan.length
        ? safePlan.map(p => ({
            Action: p.action,
            "Excel Row": p.row.excelRow,
            "Backend ID": p.backendId || "",
            "Device ID": p.row.deviceCode,
            IP: p.row.finalIp,
            Serial: p.row.finalSerial,
            "Secret Code": p.finalSecret,
            Cluster: p.row.cluster,
            "الوزارة / الجهة": p.row.building,
            Zone: p.row.zone,
            Lane: p.row.lane,
            Direction: p.row.direction,
          }))
        : [{ Result: "No safe rows" }]
    ),
    "SAFE TO IMPORT"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      skipped.length ? skipped : [{ Result: "No skipped rows" }]
    ),
    "SKIPPED"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      duplicateDetails.length
        ? duplicateDetails
        : [{ Result: "No duplicate rows" }]
    ),
    "DUPLICATES"
  );

  XLSX.writeFile(wb, REPORT_FILE);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(String(answer || "").trim());
    });
  });
}

async function exportBackend() {
  const rows = await prisma.device.findMany({
    include: { location: true, deviceType: true },
    orderBy: { id: "asc" },
  });

  const data = rows.map(d => ({
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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Backend");
  XLSX.writeFile(wb, FINAL_EXPORT_FILE);
}

async function main() {
  const apply = process.argv.includes("--apply");

  console.log("============================================================");
  console.log(" SAFE IMPORT: UPLOAD ONLY NON-DUPLICATED ROWS");
  console.log(" DUPLICATES / CONFLICTS ARE SKIPPED + EXPORTED");
  console.log("============================================================");
  console.log(apply ? "MODE: APPLY" : "MODE: DRY RUN / PREVIEW");
  console.log("");

  const keepIds = loadKeepIds();
  if (keepIds.length !== EXPECTED_KEEP) {
    throw new Error(`SAFETY STOP: KEEP IDs=${keepIds.length}, expected 641.`);
  }

  const { sheetName, rows } = parseInput();
  console.log(`Sheet                  : ${sheetName}`);
  console.log(`Excel rows             : ${rows.length}`);

  const backend = await prisma.device.findMany({
    include: { location: true, deviceType: true },
    orderBy: { id: "asc" },
  });

  const keepSet = new Set(keepIds.map(Number));
  const protectedFound = backend.filter(d => keepSet.has(Number(d.id))).length;

  if (backend.length !== 641 || protectedFound !== 641) {
    throw new Error(
      `SAFETY STOP: backend must currently be exactly protected 641. total=${backend.length}, keep=${protectedFound}.`
    );
  }

  const typeIds = [...new Set(
    backend.map(d => Number(d.deviceTypeId)).filter(Number.isFinite)
  )];

  const typeSummary = {};
  for (const d of backend) {
    const key = `${d.deviceTypeId}:${clean(d.deviceType?.name)}`;
    typeSummary[key] = (typeSummary[key] || 0) + 1;
  }

  console.log(`Backend protected KEEP : ${protectedFound} / 641`);
  console.log(`Device types in KEEP   : ${Object.entries(typeSummary).map(([k,v]) => `${k}=${v}`).join(" | ")}`);

  const reasons = new Map();
  const duplicateDetails = [];

  // Blank / invalid values.
  rows.forEach((r, idx) => {
    if (!clean(r.deviceCode)) addReason(reasons, idx, "BLANK_DEVICE_ID");
    if (r.finalIpRaw && !r.finalIp) addReason(reasons, idx, "INVALID_IP");
    if (r.finalSerialRaw && !r.finalSerial) addReason(reasons, idx, "INVALID_SERIAL");
  });

  // Duplicates INSIDE Excel: every participant is skipped.
  const checks = [
    ["DUPLICATE_DEVICE_ID", r => r.deviceCode],
    ["DUPLICATE_IP", r => r.finalIp],
    ["DUPLICATE_SERIAL", r => r.finalSerial],
  ];

  for (const [label, getter] of checks) {
    const map = new Map();

    rows.forEach((r, idx) => {
      const value = clean(getter(r));
      if (!value) return;
      const key = norm(value);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(idx);
    });

    for (const idxs of map.values()) {
      if (idxs.length <= 1) continue;

      for (const idx of idxs) {
        addReason(reasons, idx, label);
        duplicateDetails.push(
          asReportRow(rows[idx], "DUPLICATE", label)
        );
      }
    }
  }

  const backendByCode = new Map(
    backend.map(d => [norm(d.deviceCode), d])
  );

  // Candidate safe rows after Excel duplicate/invalid filtering.
  const candidateIndexes = rows
    .map((_, idx) => idx)
    .filter(idx => !reasons.has(idx));

  // Rows that update existing backend by exact Device ID.
  const updateTargetIds = new Set();

  for (const idx of candidateIndexes) {
    const r = rows[idx];
    const existing = backendByCode.get(norm(r.deviceCode));
    if (existing) updateTargetIds.add(Number(existing.id));
  }

  // Untouched backend values are hard conflicts.
  const untouchedBackend = backend.filter(
    d => !updateTargetIds.has(Number(d.id))
  );

  const untouchedIpOwner = new Map();
  const untouchedSerialOwner = new Map();

  for (const d of untouchedBackend) {
    if (clean(d.ipAddress)) untouchedIpOwner.set(norm(d.ipAddress), d);
    if (clean(d.serialNumber)) untouchedSerialOwner.set(norm(d.serialNumber), d);
  }

  for (const idx of candidateIndexes) {
    const r = rows[idx];

    if (r.finalIp) {
      const owner = untouchedIpOwner.get(norm(r.finalIp));
      if (owner) {
        addReason(
          reasons,
          idx,
          `BACKEND_IP_CONFLICT_WITH_ID_${clean(owner.deviceCode)}`
        );
      }
    }

    if (r.finalSerial) {
      const owner = untouchedSerialOwner.get(norm(r.finalSerial));
      if (owner) {
        addReason(
          reasons,
          idx,
          `BACKEND_SERIAL_CONFLICT_WITH_ID_${clean(owner.deviceCode)}`
        );
      }
    }
  }

  // Recalculate safe rows after backend conflict detection.
  const safeIndexes = rows
    .map((_, idx) => idx)
    .filter(idx => !reasons.has(idx));

  const newSafeIndexes = safeIndexes.filter(idx => {
    return !backendByCode.has(norm(rows[idx].deviceCode));
  });

  // New inserts need a safe device type. Never guess when current KEEP has multiple types.
  if (newSafeIndexes.length > 0 && typeIds.length !== 1) {
    for (const idx of newSafeIndexes) {
      addReason(reasons, idx, "NO_SAFE_DEVICE_TYPE_TO_INFER");
    }
  }

  const finalSafeIndexes = rows
    .map((_, idx) => idx)
    .filter(idx => !reasons.has(idx));

  const usedSecrets = new Set(
    backend.map(d => norm(d.secretCode)).filter(Boolean)
  );
  const usedBarcodes = new Set(
    backend.map(d => norm(d.barcode)).filter(Boolean)
  );

  const safePlan = [];

  for (const idx of finalSafeIndexes) {
    const r = rows[idx];
    const existing = backendByCode.get(norm(r.deviceCode));

    if (existing) {
      let secret = clean(existing.secretCode);
      if (!secret) secret = randomSecret(usedSecrets);

      safePlan.push({
        action: "UPDATE_EXISTING",
        backendId: Number(existing.id),
        deviceTypeId: Number(existing.deviceTypeId),
        barcode: clean(existing.barcode),
        finalSecret: secret,
        row: r,
      });
    } else {
      const secret = randomSecret(usedSecrets);
      const barcode = uniqueBarcode(
        r.deviceCode,
        r.finalIp,
        r.finalSerial,
        usedBarcodes
      );

      safePlan.push({
        action: "INSERT_NEW",
        backendId: null,
        deviceTypeId: typeIds[0],
        barcode,
        finalSecret: secret,
        row: r,
      });
    }
  }

  const skipped = rows
    .map((r, idx) => {
      if (!reasons.has(idx)) return null;
      return asReportRow(
        r,
        "SKIPPED",
        [...reasons.get(idx)].join(" | ")
      );
    })
    .filter(Boolean);

  const updateCount = safePlan.filter(p => p.action === "UPDATE_EXISTING").length;
  const insertCount = safePlan.filter(p => p.action === "INSERT_NEW").length;
  const expectedFinalCount = backend.length + insertCount;

  const duplicateRowCount = new Set(
    duplicateDetails.map(x => x["Excel Row"])
  ).size;

  const summary = [
    { Metric: "Excel rows", Value: rows.length },
    { Metric: "Backend before", Value: backend.length },
    { Metric: "Protected KEEP found", Value: protectedFound },
    { Metric: "Duplicate rows in Excel", Value: duplicateRowCount },
    { Metric: "All skipped rows", Value: skipped.length },
    { Metric: "Safe UPDATE existing", Value: updateCount },
    { Metric: "Safe INSERT new", Value: insertCount },
    { Metric: "Safe total processed", Value: safePlan.length },
    { Metric: "Expected backend after", Value: expectedFinalCount },
  ];

  writeReport({
    summary,
    safePlan,
    skipped,
    duplicateDetails,
  });

  console.log("");
  console.log("PLAN");
  console.log("------------------------------------------------------------");
  console.log(`Duplicate rows skipped  : ${duplicateRowCount}`);
  console.log(`All skipped/conflicts   : ${skipped.length}`);
  console.log(`Safe UPDATE existing    : ${updateCount}`);
  console.log(`Safe INSERT new         : ${insertCount}`);
  console.log(`Safe rows total         : ${safePlan.length}`);
  console.log(`Backend before          : ${backend.length}`);
  console.log(`Expected backend after  : ${expectedFinalCount}`);
  console.log(`Report                  : ${REPORT_FILE}`);

  if (!apply) {
    console.log("");
    console.log("============================================================");
    console.log(" DRY RUN ONLY ✅");
    console.log("============================================================");
    console.log("✅ DATABASE WAS NOT CHANGED.");
    console.log("✅ Open the Excel report: DUPLICATES + SKIPPED + SAFE TO IMPORT.");
    console.log("");
    console.log("To upload only the SAFE rows:");
    console.log("node scripts\\import-safe-skip-duplicates.cjs --apply");
    return;
  }

  if (!safePlan.length) {
    console.log("Nothing safe to import.");
    return;
  }

  const backupDir = path.join(process.cwd(), "backup");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const backupPath = path.join(
    backupDir,
    `before-safe-import-${stamp}.json`
  );

  fs.writeFileSync(
    backupPath,
    JSON.stringify(backend, (k, v) =>
      typeof v === "bigint" ? v.toString() : v
    , 2),
    "utf8"
  );

  console.log("");
  console.log(`Backup: ${backupPath}`);
  console.log("");
  console.log(`Will UPDATE existing : ${updateCount}`);
  console.log(`Will INSERT new      : ${insertCount}`);
  console.log(`Will SKIP            : ${skipped.length}`);
  console.log(`Expected final count : ${expectedFinalCount}`);

  const confirm = await ask(
    "Type IMPORT-SAFE-ONLY to continue: "
  );

  if (confirm !== "IMPORT-SAFE-ONLY") {
    console.log("❌ Cancelled. DATABASE WAS NOT CHANGED.");
    return;
  }

  const locationCache = new Map();

  const result = await prisma.$transaction(
    async tx => {
      const beforeRows = await tx.device.findMany({
        select: { id: true, deviceCode: true },
      });

      if (beforeRows.length !== 641) {
        throw new Error(
          `ROLLBACK: backend changed before apply. Expected 641, found ${beforeRows.length}.`
        );
      }

      const beforeIdSet = new Set(beforeRows.map(x => Number(x.id)));
      if (keepIds.some(id => !beforeIdSet.has(Number(id)))) {
        throw new Error("ROLLBACK: one or more protected KEEP IDs disappeared.");
      }

      // Free serials only for rows that will be updated, so serial swaps cannot hit UNIQUE.
      const updateIds = safePlan
        .filter(p => p.action === "UPDATE_EXISTING")
        .map(p => p.backendId);

      if (updateIds.length) {
        await tx.device.updateMany({
          where: { id: { in: updateIds } },
          data: { serialNumber: null },
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

          const existingExcelId = await tx.location.findFirst({
            where: { excelId },
          });

          if (existingExcelId) {
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

      for (const p of safePlan) {
        const locationId = await getLocationId(p.row);

        if (p.action === "UPDATE_EXISTING") {
          await tx.device.update({
            where: { id: p.backendId },
            data: {
              ipAddress: p.row.finalIp || null,
              serialNumber: p.row.finalSerial || null,
              secretCode: p.finalSecret,
              assetType: "DEVICE",
              locationId,
            },
          });
          updated++;
        } else {
          await tx.device.create({
            data: {
              deviceCode: p.row.deviceCode,
              deviceName: `Device ${p.row.deviceCode}`,
              barcode: p.barcode,
              ipAddress: p.row.finalIp || null,
              serialNumber: p.row.finalSerial || null,
              secretCode: p.finalSecret,
              assetType: "DEVICE",
              currentStatus: "OK",
              lifecycleStatus: "ACTIVE",
              deviceTypeId: p.deviceTypeId,
              locationId,
              notes: "Safe import; duplicate/conflicting rows skipped",
            },
          });
          inserted++;
        }
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

      const uniqueCount = values =>
        new Set(values.map(norm).filter(Boolean)).size;

      const codes = finalRows.map(r => r.deviceCode);
      const ips = finalRows.map(r => r.ipAddress).filter(Boolean);
      const serials = finalRows.map(r => r.serialNumber).filter(Boolean);
      const secrets = finalRows.map(r => r.secretCode).filter(Boolean);

      if (finalRows.length !== expectedFinalCount) {
        throw new Error(
          `ROLLBACK: final count=${finalRows.length}, expected=${expectedFinalCount}.`
        );
      }

      if (uniqueCount(codes) !== codes.length) {
        throw new Error("ROLLBACK: duplicate Device ID exists after import.");
      }

      if (uniqueCount(ips) !== ips.length) {
        throw new Error("ROLLBACK: duplicate IP exists after import.");
      }

      if (uniqueCount(serials) !== serials.length) {
        throw new Error("ROLLBACK: duplicate Serial exists after import.");
      }

      if (secrets.length !== finalRows.length || uniqueCount(secrets) !== secrets.length) {
        throw new Error("ROLLBACK: Secret Codes are missing or duplicated.");
      }

      const keepAfter = await tx.device.count({
        where: { id: { in: keepIds } },
      });

      if (keepAfter !== 641) {
        throw new Error(
          `ROLLBACK: protected KEEP after import=${keepAfter}/641.`
        );
      }

      return {
        updated,
        inserted,
        total: finalRows.length,
        keepAfter,
        uniqueCodes: uniqueCount(codes),
        uniqueIps: uniqueCount(ips),
        ipCount: ips.length,
        uniqueSerials: uniqueCount(serials),
        serialCount: serials.length,
        uniqueSecrets: uniqueCount(secrets),
      };
    },
    { maxWait: 10000, timeout: 180000 }
  );

  await exportBackend();

  console.log("");
  console.log("============================================================");
  console.log(" SAFE IMPORT SUCCESS ✅");
  console.log("============================================================");
  console.log(`Updated existing       : ${result.updated}`);
  console.log(`Inserted new           : ${result.inserted}`);
  console.log(`Skipped/report         : ${skipped.length}`);
  console.log(`Final backend count    : ${result.total}`);
  console.log(`Protected KEEP         : ${result.keepAfter} / 641`);
  console.log(`Unique Device IDs      : ${result.uniqueCodes} / ${result.total}`);
  console.log(`Unique IPs             : ${result.uniqueIps} / ${result.ipCount}`);
  console.log(`Unique Serials         : ${result.uniqueSerials} / ${result.serialCount}`);
  console.log(`Unique Secret Codes    : ${result.uniqueSecrets} / ${result.total}`);
  console.log(`Duplicates report      : ${REPORT_FILE}`);
  console.log(`Backend export         : ${FINAL_EXPORT_FILE}`);
  console.log("");
  console.log("✅ DUPLICATES/CONFLICTS WERE NOT UPLOADED.");
  console.log("✅ THEY ARE ALL LISTED IN THE EXCEL REPORT.");
  console.log("✅ ALL PROTECTED 641 BACKEND IDs STILL EXIST.");
}

main()
  .catch(err => {
    console.error("");
    console.error("❌ ERROR:", err.message || err);
    console.error("If a transaction started, it was rolled back.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
