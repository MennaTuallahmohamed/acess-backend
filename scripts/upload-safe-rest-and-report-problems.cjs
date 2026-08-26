const fs = require("fs");
const path = require("path");
const readline = require("readline");
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const INPUT_FILE =
  "C:\\Users\\Mena\\Downloads\\ALL_827_secret code.xlsx";

const KEEP_IDS_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\PROTECTED_641_IDS.json";

const REPORT_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\UPLOAD_SAFE_AND_PROBLEMS_DETAILS.xlsx";

const FINAL_EXPORT_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\BACKEND_AFTER_SAFE_827_UPLOAD.xlsx";

const EXPECTED_KEEP = 641;

function clean(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function norm(v) {
  return clean(v).toLowerCase().replace(/\s+/g, " ");
}

function normalizeKeys(obj) {
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
      const value = clean(row[key]);
      if (value !== "") return value;
    }
  }
  return "";
}

function normalizeLane(v) {
  const s = clean(v);
  if (/^-?\d+\.0+$/.test(s)) return String(parseInt(s, 10));
  return s;
}

function validIPv4(v) {
  const s = clean(v);
  if (!s) return "";
  const parts = s.split(".");
  if (parts.length !== 4) return "";
  if (
    !parts.every(
      (p) =>
        /^\d{1,3}$/.test(p) &&
        Number(p) >= 0 &&
        Number(p) <= 255
    )
  ) {
    return "";
  }
  return s;
}

function validSerial(v) {
  const s = clean(v);
  if (!s) return "";
  return /^[A-Za-z0-9._-]{5,}$/.test(s) ? s : "";
}

function loadKeepIds() {
  if (!fs.existsSync(KEEP_IDS_FILE)) {
    throw new Error(`KEEP IDs file not found: ${KEEP_IDS_FILE}`);
  }

  const data = JSON.parse(fs.readFileSync(KEEP_IDS_FILE, "utf8"));

  return [
    ...new Set(
      (data.protectedBackendIds || [])
        .map(Number)
        .filter(Number.isFinite)
    ),
  ];
}

function readInput() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Excel file not found: ${INPUT_FILE}`);
  }

  const wb = XLSX.readFile(INPUT_FILE, {
    raw: false,
    cellDates: false,
  });

  const sheetName = wb.SheetNames.includes("NEW فقط")
    ? "NEW فقط"
    : wb.SheetNames[0];

  const rawRows = XLSX.utils.sheet_to_json(
    wb.Sheets[sheetName],
    {
      defval: "",
      raw: false,
    }
  );

  const rows = rawRows
    .map((raw, index) => {
      const r = normalizeKeys(raw);

      const ipRaw = get(r, ["IP", "IP Address"]);
      const serialRaw = get(r, ["Serial", "Serial Number"]);

      return {
        excelRow: index + 2,
        deviceCode: get(r, ["Device ID", "Device Code"]),
        secretCode: get(r, ["Secret Code", "Secret"]),
        ipRaw,
        ipAddress: validIPv4(ipRaw),
        serialRaw,
        serialNumber: validSerial(serialRaw),
        cluster: get(r, ["Cluster"]),
        building: get(r, ["Building", "اسم الوزارة / الجهة"]),
        zone: get(r, ["Zone"]),
        lane: normalizeLane(get(r, ["Lane"])),
        direction: get(r, ["Direction"]).toUpperCase(),
      };
    })
    .filter((r) =>
      [
        r.deviceCode,
        r.secretCode,
        r.ipRaw,
        r.serialRaw,
        r.cluster,
        r.building,
        r.zone,
        r.lane,
        r.direction,
      ].some(Boolean)
    );

  return { sheetName, rows };
}

function addReason(reasonMap, index, reason) {
  if (!reasonMap.has(index)) {
    reasonMap.set(index, new Set());
  }
  reasonMap.get(index).add(reason);
}

function markDuplicateGroups(rows, fieldName, getter, reasonMap) {
  const map = new Map();
  const groups = [];

  rows.forEach((r, index) => {
    const value = clean(getter(r));
    if (!value) return;

    const key = norm(value);

    if (!map.has(key)) map.set(key, []);
    map.get(key).push(index);
  });

  for (const indexes of map.values()) {
    if (indexes.length <= 1) continue;

    const value = clean(getter(rows[indexes[0]]));

    groups.push({
      Field: fieldName,
      Value: value,
      Count: indexes.length,
      "Excel Rows": indexes
        .map((i) => rows[i].excelRow)
        .join(", "),
      "Device IDs": indexes
        .map((i) => rows[i].deviceCode)
        .join(", "),
    });

    for (const index of indexes) {
      addReason(
        reasonMap,
        index,
        `DUPLICATE ${fieldName}: ${value}`
      );
    }
  }

  return groups;
}

function problemRow(row, reasons) {
  return {
    "Excel Row": row.excelRow,
    "Device ID": row.deviceCode,
    "Secret Code": row.secretCode,
    IP: row.ipRaw,
    "Validated IP": row.ipAddress,
    Serial: row.serialRaw,
    "Validated Serial": row.serialNumber,
    Cluster: row.cluster,
    Building: row.building,
    Zone: row.zone,
    Lane: row.lane,
    Direction: row.direction,
    Problems: reasons.join(" | "),
  };
}

function locationKey(row) {
  return [
    norm(row.cluster),
    norm(row.building),
    norm(row.zone),
    norm(row.lane),
    norm(row.direction),
  ].join("|");
}

async function getOrCreateLocation(tx, row, cache) {
  const key = locationKey(row);

  if (cache.has(key)) {
    return cache.get(key);
  }

  let location = await tx.location.findFirst({
    where: {
      cluster: row.cluster,
      building: row.building,
      zone: row.zone,
      lane: row.lane,
      direction: row.direction,
    },
  });

  if (!location) {
    const hash = require("crypto")
      .createHash("sha1")
      .update(key)
      .digest("hex")
      .slice(0, 16)
      .toUpperCase();

    let excelId = `SAFE827-${hash}`;

    const collision = await tx.location.findFirst({
      where: { excelId },
    });

    if (collision) {
      excelId =
        `${excelId}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    }

    location = await tx.location.create({
      data: {
        cluster: row.cluster,
        building: row.building,
        zone: row.zone,
        lane: row.lane,
        direction: row.direction,
        excelId,
        type: "DEVICE",
      },
    });
  }

  cache.set(key, Number(location.id));
  return Number(location.id);
}

function makeBarcode(row, used) {
  const crypto = require("crypto");

  const base =
    "SAFE827-" +
    clean(row.deviceCode) +
    "-" +
    crypto
      .createHash("sha1")
      .update(
        `${row.deviceCode}|${row.secretCode}|${row.ipAddress}|${row.serialNumber}`
      )
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

function writeReport({
  summary,
  safeRows,
  problems,
  duplicateGroups,
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
      safeRows.length
        ? safeRows
        : [{ Result: "NO SAFE ROWS" }]
    ),
    "SAFE TO UPLOAD"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      problems.length
        ? problems
        : [{ Result: "NO PROBLEMS" }]
    ),
    "PROBLEMS DETAILS"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      duplicateGroups.length
        ? duplicateGroups
        : [{ Result: "NO DUPLICATE GROUPS" }]
    ),
    "DUPLICATE GROUPS"
  );

  XLSX.writeFile(wb, REPORT_FILE);
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

async function exportBackend() {
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
    Building: clean(d.location?.building),
    Zone: clean(d.location?.zone),
    Lane: clean(d.location?.lane),
    Direction: clean(d.location?.direction),
    "Device Type": clean(d.deviceType?.name),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(data),
    "Backend"
  );

  XLSX.writeFile(wb, FINAL_EXPORT_FILE);
}

async function main() {
  const apply = process.argv.includes("--apply");

  console.log("============================================================");
  console.log(" UPLOAD SAFE ROWS - SKIP EVERY PROBLEM");
  console.log(" ALL PROBLEMS EXPORTED WITH DEVICE DETAILS");
  console.log("============================================================");
  console.log(apply ? "MODE: APPLY" : "MODE: DRY RUN");
  console.log("");

  const keepIds = loadKeepIds();

  if (keepIds.length !== EXPECTED_KEEP) {
    throw new Error(
      `SAFETY STOP: protected IDs=${keepIds.length}, expected 641.`
    );
  }

  const { sheetName, rows } = readInput();

  console.log(`Sheet                  : ${sheetName}`);
  console.log(`Excel rows             : ${rows.length}`);

  if (rows.length !== 827) {
    throw new Error(
      `SAFETY STOP: expected 827 Excel rows, found ${rows.length}.`
    );
  }

  const backend = await prisma.device.findMany({
    include: { deviceType: true },
    orderBy: { id: "asc" },
  });

  const keepSet = new Set(keepIds.map(Number));
  const keepFound = backend.filter((d) =>
    keepSet.has(Number(d.id))
  ).length;

  if (backend.length !== 641 || keepFound !== 641) {
    throw new Error(
      `SAFETY STOP: backend must currently be exactly protected 641. total=${backend.length}, keep=${keepFound}.`
    );
  }

  const typeIds = [
    ...new Set(
      backend
        .map((d) => Number(d.deviceTypeId))
        .filter(Number.isFinite)
    ),
  ];

  if (typeIds.length !== 1) {
    throw new Error(
      `SAFETY STOP: current 641 use ${typeIds.length} device types.`
    );
  }

  const defaultDeviceTypeId = typeIds[0];

  const reasons = new Map();
  const duplicateGroups = [];

  // Invalid / blank fields are problems and are skipped.
  rows.forEach((r, index) => {
    if (!r.deviceCode) {
      addReason(reasons, index, "BLANK Device ID");
    }

    if (!r.secretCode) {
      addReason(reasons, index, "BLANK Secret Code");
    }

    if (r.ipRaw && !r.ipAddress) {
      addReason(
        reasons,
        index,
        `INVALID IP: ${r.ipRaw}`
      );
    }

    if (r.serialRaw && !r.serialNumber) {
      addReason(
        reasons,
        index,
        `INVALID SERIAL: ${r.serialRaw}`
      );
    }

    if (!r.cluster) addReason(reasons, index, "BLANK Cluster");
    if (!r.building) addReason(reasons, index, "BLANK Building");
    if (!r.zone) addReason(reasons, index, "BLANK Zone");
    if (!r.lane) addReason(reasons, index, "BLANK Lane");
    if (!r.direction) addReason(reasons, index, "BLANK Direction");
  });

  // All participants in a duplicate group are skipped.
  duplicateGroups.push(
    ...markDuplicateGroups(
      rows,
      "Device ID",
      (r) => r.deviceCode,
      reasons
    )
  );

  duplicateGroups.push(
    ...markDuplicateGroups(
      rows,
      "IP",
      (r) => r.ipAddress,
      reasons
    )
  );

  duplicateGroups.push(
    ...markDuplicateGroups(
      rows,
      "Serial",
      (r) => r.serialNumber,
      reasons
    )
  );

  duplicateGroups.push(
    ...markDuplicateGroups(
      rows,
      "Secret Code",
      (r) => r.secretCode,
      reasons
    )
  );

  const backendByCode = new Map();
  const backendByIp = new Map();
  const backendBySerial = new Map();
  const backendBySecret = new Map();

  for (const d of backend) {
    if (clean(d.deviceCode)) {
      backendByCode.set(norm(d.deviceCode), d);
    }
    if (clean(d.ipAddress)) {
      backendByIp.set(norm(d.ipAddress), d);
    }
    if (clean(d.serialNumber)) {
      backendBySerial.set(norm(d.serialNumber), d);
    }
    if (clean(d.secretCode)) {
      backendBySecret.set(norm(d.secretCode), d);
    }
  }

  // Rows with exact Device ID match are updates.
  // All other safe rows are inserts.
  const updateTargetBackendIds = new Set();

  rows.forEach((r, index) => {
    if (reasons.has(index)) return;

    const existing = backendByCode.get(norm(r.deviceCode));
    if (existing) {
      updateTargetBackendIds.add(Number(existing.id));
    }
  });

  // Existing rows being updated may legitimately change IP/Serial/Secret.
  // Conflicts are checked against BACKEND rows that are NOT update targets.
  for (const [index, r] of rows.entries()) {
    if (reasons.has(index)) continue;

    const target = backendByCode.get(norm(r.deviceCode));
    const targetId = target ? Number(target.id) : null;

    if (r.ipAddress) {
      const owner = backendByIp.get(norm(r.ipAddress));
      if (
        owner &&
        Number(owner.id) !== targetId &&
        !updateTargetBackendIds.has(Number(owner.id))
      ) {
        addReason(
          reasons,
          index,
          `BACKEND IP CONFLICT: ${r.ipAddress} belongs to Device ID ${clean(owner.deviceCode)} / Backend ID ${owner.id}`
        );
      }
    }

    if (r.serialNumber) {
      const owner = backendBySerial.get(norm(r.serialNumber));
      if (
        owner &&
        Number(owner.id) !== targetId &&
        !updateTargetBackendIds.has(Number(owner.id))
      ) {
        addReason(
          reasons,
          index,
          `BACKEND SERIAL CONFLICT: ${r.serialNumber} belongs to Device ID ${clean(owner.deviceCode)} / Backend ID ${owner.id}`
        );
      }
    }

    if (r.secretCode) {
      const owner = backendBySecret.get(norm(r.secretCode));
      if (
        owner &&
        Number(owner.id) !== targetId &&
        !updateTargetBackendIds.has(Number(owner.id))
      ) {
        addReason(
          reasons,
          index,
          `BACKEND SECRET CONFLICT: ${r.secretCode} belongs to Device ID ${clean(owner.deviceCode)} / Backend ID ${owner.id}`
        );
      }
    }
  }

  const safePlan = [];
  const problems = [];

  for (const [index, r] of rows.entries()) {
    if (reasons.has(index)) {
      problems.push(
        problemRow(
          r,
          [...reasons.get(index)]
        )
      );
      continue;
    }

    const existing = backendByCode.get(norm(r.deviceCode));

    safePlan.push({
      action: existing ? "UPDATE EXISTING" : "INSERT NEW",
      backendId: existing ? Number(existing.id) : null,
      row: r,
    });
  }

  const safeReportRows = safePlan.map((p) => ({
    Action: p.action,
    "Backend ID": p.backendId || "",
    "Excel Row": p.row.excelRow,
    "Device ID": p.row.deviceCode,
    "Secret Code": p.row.secretCode,
    IP: p.row.ipAddress,
    Serial: p.row.serialNumber,
    Cluster: p.row.cluster,
    Building: p.row.building,
    Zone: p.row.zone,
    Lane: p.row.lane,
    Direction: p.row.direction,
  }));

  const updateCount = safePlan.filter(
    (p) => p.action === "UPDATE EXISTING"
  ).length;

  const insertCount = safePlan.filter(
    (p) => p.action === "INSERT NEW"
  ).length;

  const expectedFinalCount = backend.length + insertCount;

  const summary = [
    { Metric: "Excel rows", Value: rows.length },
    { Metric: "Backend before", Value: backend.length },
    { Metric: "Protected KEEP", Value: keepFound },
    { Metric: "SAFE UPDATE existing", Value: updateCount },
    { Metric: "SAFE INSERT new", Value: insertCount },
    { Metric: "SAFE total", Value: safePlan.length },
    { Metric: "Problem rows skipped", Value: problems.length },
    { Metric: "Duplicate groups", Value: duplicateGroups.length },
    { Metric: "Expected backend after", Value: expectedFinalCount },
  ];

  writeReport({
    summary,
    safeRows: safeReportRows,
    problems,
    duplicateGroups,
  });

  console.log("");
  console.log("PLAN");
  console.log("------------------------------------------------------------");
  console.log(`SAFE UPDATE existing    : ${updateCount}`);
  console.log(`SAFE INSERT new         : ${insertCount}`);
  console.log(`SAFE total              : ${safePlan.length}`);
  console.log(`PROBLEM rows skipped    : ${problems.length}`);
  console.log(`Duplicate groups        : ${duplicateGroups.length}`);
  console.log(`Backend before          : ${backend.length}`);
  console.log(`Expected backend after  : ${expectedFinalCount}`);
  console.log(`Problems report         : ${REPORT_FILE}`);

  if (problems.length) {
    console.log("");
    console.log("PROBLEM DEVICES");
    console.log("------------------------------------------------------------");

    problems.forEach((p, i) => {
      console.log("");
      console.log(`PROBLEM ${i + 1} / ${problems.length}`);
      console.log(`Excel Row   : ${p["Excel Row"]}`);
      console.log(`Device ID   : ${p["Device ID"] || "-"}`);
      console.log(`IP          : ${p["IP"] || "-"}`);
      console.log(`Serial      : ${p["Serial"] || "-"}`);
      console.log(`Secret Code : ${p["Secret Code"] || "-"}`);
      console.log(`Cluster     : ${p["Cluster"] || "-"}`);
      console.log(`Building    : ${p["Building"] || "-"}`);
      console.log(`Zone        : ${p["Zone"] || "-"}`);
      console.log(`Lane        : ${p["Lane"] || "-"}`);
      console.log(`Direction   : ${p["Direction"] || "-"}`);
      console.log(`Problem     : ${p["Problems"]}`);
    });
  }

  if (!apply) {
    console.log("");
    console.log("============================================================");
    console.log(" DRY RUN ONLY ✅");
    console.log("============================================================");
    console.log("✅ DATABASE WAS NOT CHANGED.");
    console.log("✅ SAFE rows are ready.");
    console.log("✅ Problem rows are skipped and fully listed.");
    console.log("");
    console.log("To upload ONLY the SAFE rows:");
    console.log(
      "node scripts\\upload-safe-rest-and-report-problems.cjs --apply"
    );
    return;
  }

  const backupDir = path.join(process.cwd(), "backup");
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  const backupPath = path.join(
    backupDir,
    `before-upload-safe-rest-${stamp}.json`
  );

  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      backend,
      (k, v) =>
        typeof v === "bigint"
          ? v.toString()
          : v,
      2
    ),
    "utf8"
  );

  console.log("");
  console.log(`Backup: ${backupPath}`);
  console.log(`SAFE UPDATE : ${updateCount}`);
  console.log(`SAFE INSERT : ${insertCount}`);
  console.log(`SKIP        : ${problems.length}`);
  console.log(`FINAL COUNT : ${expectedFinalCount}`);
  console.log("");

  const confirm = await ask(
    "Type UPLOAD-SAFE-REST to continue: "
  );

  if (confirm !== "UPLOAD-SAFE-REST") {
    console.log("❌ Cancelled. DATABASE WAS NOT CHANGED.");
    return;
  }

  const usedBarcodes = new Set(
    backend
      .map((d) => norm(d.barcode))
      .filter(Boolean)
  );

  const locationCache = new Map();

  const result = await prisma.$transaction(
    async (tx) => {
      const before = await tx.device.findMany({
        select: {
          id: true,
          deviceCode: true,
        },
      });

      const beforeIds = new Set(
        before.map((d) => Number(d.id))
      );

      if (before.length !== 641) {
        throw new Error(
          `ROLLBACK: backend changed before apply. Expected 641, found ${before.length}.`
        );
      }

      if (
        keepIds.some(
          (id) => !beforeIds.has(Number(id))
        )
      ) {
        throw new Error(
          "ROLLBACK: a protected KEEP Backend ID disappeared."
        );
      }

      const updateIds = safePlan
        .filter(
          (p) => p.action === "UPDATE EXISTING"
        )
        .map((p) => p.backendId);

      // Free unique Serial + Secret for the rows being updated.
      if (updateIds.length) {
        await tx.device.updateMany({
          where: {
            id: { in: updateIds },
          },
          data: {
            serialNumber: null,
            secretCode: null,
          },
        });
      }

      let updated = 0;
      let inserted = 0;

      for (const p of safePlan) {
        const locationId =
          await getOrCreateLocation(
            tx,
            p.row,
            locationCache
          );

        if (p.action === "UPDATE EXISTING") {
          await tx.device.update({
            where: {
              id: p.backendId,
            },
            data: {
              ipAddress:
                p.row.ipAddress || null,
              serialNumber:
                p.row.serialNumber || null,
              secretCode:
                p.row.secretCode,
              assetType: "DEVICE",
              locationId,
            },
          });

          updated++;
        } else {
          const barcode = makeBarcode(
            p.row,
            usedBarcodes
          );

          await tx.device.create({
            data: {
              deviceCode:
                p.row.deviceCode,
              deviceName:
                `Device ${p.row.deviceCode}`,
              barcode,
              ipAddress:
                p.row.ipAddress || null,
              serialNumber:
                p.row.serialNumber || null,
              secretCode:
                p.row.secretCode,
              assetType: "DEVICE",
              currentStatus: "OK",
              lifecycleStatus: "ACTIVE",
              deviceTypeId:
                defaultDeviceTypeId,
              locationId,
              notes:
                "Safe upload from ALL_827_secret code.xlsx; problem rows skipped",
            },
          });

          inserted++;
        }
      }

      const finalRows =
        await tx.device.findMany({
          select: {
            id: true,
            deviceCode: true,
            ipAddress: true,
            serialNumber: true,
            secretCode: true,
          },
        });

      if (
        finalRows.length !==
        expectedFinalCount
      ) {
        throw new Error(
          `ROLLBACK: final Device count=${finalRows.length}, expected=${expectedFinalCount}.`
        );
      }

      const uniqueCount = (values) =>
        new Set(
          values
            .map(norm)
            .filter(Boolean)
        ).size;

      const deviceCodes = finalRows.map(
        (r) => r.deviceCode
      );

      const ips = finalRows
        .map((r) => r.ipAddress)
        .filter(Boolean);

      const serials = finalRows
        .map((r) => r.serialNumber)
        .filter(Boolean);

      const secrets = finalRows
        .map((r) => r.secretCode)
        .filter(Boolean);

      if (
        uniqueCount(deviceCodes) !==
        deviceCodes.length
      ) {
        throw new Error(
          "ROLLBACK: duplicate Device ID exists after upload."
        );
      }

      if (
        uniqueCount(ips) !== ips.length
      ) {
        throw new Error(
          "ROLLBACK: duplicate IP exists after upload."
        );
      }

      if (
        uniqueCount(serials) !==
        serials.length
      ) {
        throw new Error(
          "ROLLBACK: duplicate Serial exists after upload."
        );
      }

      if (
        uniqueCount(secrets) !==
        secrets.length
      ) {
        throw new Error(
          "ROLLBACK: duplicate Secret Code exists after upload."
        );
      }

      const keepAfter =
        await tx.device.count({
          where: {
            id: { in: keepIds },
          },
        });

      if (keepAfter !== 641) {
        throw new Error(
          `ROLLBACK: protected KEEP=${keepAfter}/641.`
        );
      }

      return {
        updated,
        inserted,
        finalCount: finalRows.length,
        keepAfter,
        uniqueDeviceCodes:
          uniqueCount(deviceCodes),
        uniqueIps:
          uniqueCount(ips),
        ipCount: ips.length,
        uniqueSerials:
          uniqueCount(serials),
        serialCount:
          serials.length,
        uniqueSecrets:
          uniqueCount(secrets),
        secretCount:
          secrets.length,
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
  console.log(" SAFE UPLOAD SUCCESS ✅");
  console.log("============================================================");
  console.log(`Updated existing       : ${result.updated}`);
  console.log(`Inserted new           : ${result.inserted}`);
  console.log(`Problem rows skipped   : ${problems.length}`);
  console.log(`Final backend count    : ${result.finalCount}`);
  console.log(`Protected KEEP         : ${result.keepAfter} / 641`);
  console.log(`Unique Device IDs      : ${result.uniqueDeviceCodes} / ${result.finalCount}`);
  console.log(`Unique IPs             : ${result.uniqueIps} / ${result.ipCount}`);
  console.log(`Unique Serials         : ${result.uniqueSerials} / ${result.serialCount}`);
  console.log(`Unique Secret Codes    : ${result.uniqueSecrets} / ${result.secretCount}`);
  console.log(`Problems report        : ${REPORT_FILE}`);
  console.log(`Backend export         : ${FINAL_EXPORT_FILE}`);
  console.log("");
  console.log("✅ SAFE ROWS ONLY WERE UPLOADED.");
  console.log("✅ EVERY PROBLEM ROW WAS SKIPPED.");
  console.log("✅ PROBLEM DEVICE DETAILS ARE IN THE EXCEL REPORT.");
  console.log("✅ ALL 641 PROTECTED BACKEND IDs STILL EXIST.");
}

main()
  .catch((err) => {
    console.error("");
    console.error(
      "❌ ERROR:",
      err.message || err
    );
    console.error(
      "If the transaction started, it was rolled back."
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
