const fs = require("fs");
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const INPUT_FILE =
  "C:\\Users\\Mena\\Downloads\\ALL_827_secret code.xlsx";

const KEEP_IDS_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\PROTECTED_641_IDS.json";

const REPORT_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\AUDIT_827_BY_DEVICE_ID.xlsx";

function clean(v) {
  return v == null ? "" : String(v).trim();
}

function norm(v) {
  return clean(v).toLowerCase().replace(/\s+/g, " ");
}

function normalizeRowKeys(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
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

function validIPv4(v) {
  const s = clean(v);
  if (!s) return "";
  const parts = s.split(".");
  if (parts.length !== 4) return "";
  if (!parts.every(p => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255)) {
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
  const data = JSON.parse(fs.readFileSync(KEEP_IDS_FILE, "utf8"));
  return [...new Set(
    (data.protectedBackendIds || [])
      .map(Number)
      .filter(Number.isFinite)
  )];
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

  const groups = [];
  const participantRows = new Set();

  for (const items of map.values()) {
    if (items.length <= 1) continue;

    items.forEach(r => participantRows.add(r.excelRow));

    groups.push({
      Field: field,
      Value: clean(getter(items[0])),
      Count: items.length,
      "Excel Rows": items.map(r => r.excelRow).join(", "),
      "Device IDs": items.map(r => r.deviceCode).join(", "),
    });
  }

  return { groups, participantRows };
}

async function main() {
  console.log("============================================================");
  console.log(" AUDIT NEW 827 FILE BY DEVICE ID");
  console.log(" READ ONLY - NO DATABASE CHANGES");
  console.log("============================================================");

  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Excel file not found: ${INPUT_FILE}`);
  }

  const keepIds = loadKeepIds();
  if (keepIds.length !== 641) {
    throw new Error(`KEEP IDs=${keepIds.length}, expected 641.`);
  }

  const wb = XLSX.readFile(INPUT_FILE, { raw: false, cellDates: false });
  const sheetName = wb.SheetNames.includes("NEW فقط")
    ? "NEW فقط"
    : wb.SheetNames[0];

  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    defval: "",
    raw: false,
  });

  const rows = rawRows.map((raw, i) => {
    const r = normalizeRowKeys(raw);

    const ipRaw = get(r, ["IP"]);
    const serialRaw = get(r, ["Serial"]);

    return {
      excelRow: i + 2,
      deviceCode: get(r, ["Device ID", "Device Code"]),
      secretCode: get(r, ["Secret Code"]),
      ipRaw,
      ipAddress: validIPv4(ipRaw),
      serialRaw,
      serialNumber: validSerial(serialRaw),
      cluster: get(r, ["Cluster"]),
      building: get(r, ["Building", "اسم الوزارة / الجهة"]),
      zone: get(r, ["Zone"]),
      lane: get(r, ["Lane"]),
      direction: get(r, ["Direction"]).toUpperCase(),
    };
  }).filter(r =>
    [
      r.deviceCode,
      r.secretCode,
      r.ipRaw,
      r.serialRaw,
      r.cluster,
      r.building,
      r.zone,
    ].some(Boolean)
  );

  console.log(`Sheet                  : ${sheetName}`);
  console.log(`Excel rows             : ${rows.length}`);

  if (rows.length !== 827) {
    throw new Error(`Expected 827 rows, found ${rows.length}.`);
  }

  const backend = await prisma.device.findMany({
    select: {
      id: true,
      deviceCode: true,
      ipAddress: true,
      serialNumber: true,
      secretCode: true,
      assetType: true,
    },
    orderBy: { id: "asc" },
  });

  const keepSet = new Set(keepIds.map(Number));
  const protectedRows = backend.filter(d => keepSet.has(Number(d.id)));
  const outsideKeep = backend.filter(d => !keepSet.has(Number(d.id)));

  console.log(`Backend total          : ${backend.length}`);
  console.log(`Protected KEEP found   : ${protectedRows.length} / 641`);
  console.log(`Rows outside KEEP      : ${outsideKeep.length}`);

  if (
    backend.length !== 641 ||
    protectedRows.length !== 641 ||
    outsideKeep.length !== 0
  ) {
    throw new Error("Backend is no longer exactly the protected 641.");
  }

  const dupDevice = duplicateGroups(rows, "Device ID", r => r.deviceCode);
  const dupIp = duplicateGroups(rows, "IP", r => r.ipAddress);
  const dupSerial = duplicateGroups(rows, "Serial", r => r.serialNumber);
  const dupSecret = duplicateGroups(rows, "Secret Code", r => r.secretCode);

  const invalidIp = rows
    .filter(r => r.ipRaw && !r.ipAddress)
    .map(r => ({
      "Excel Row": r.excelRow,
      "Device ID": r.deviceCode,
      Value: r.ipRaw,
      Problem: "INVALID IP",
    }));

  const invalidSerial = rows
    .filter(r => r.serialRaw && !r.serialNumber)
    .map(r => ({
      "Excel Row": r.excelRow,
      "Device ID": r.deviceCode,
      Value: r.serialRaw,
      Problem: "INVALID SERIAL",
    }));

  const backendByDeviceCode = new Map();
  protectedRows.forEach(d => {
    const key = norm(d.deviceCode);
    if (key) backendByDeviceCode.set(key, d);
  });

  const matched = [];
  const newRows = [];

  for (const r of rows) {
    const existing = backendByDeviceCode.get(norm(r.deviceCode));
    if (existing) {
      matched.push({
        "Backend ID": existing.id,
        "Device ID": r.deviceCode,
        "Excel Row": r.excelRow,
        "Current IP": clean(existing.ipAddress),
        "New IP": r.ipAddress,
        "Current Serial": clean(existing.serialNumber),
        "New Serial": r.serialNumber,
        "Current Secret": clean(existing.secretCode),
        "File Secret": r.secretCode,
      });
    } else {
      newRows.push({
        "Excel Row": r.excelRow,
        "Device ID": r.deviceCode,
        IP: r.ipAddress,
        Serial: r.serialNumber,
        "Secret Code": r.secretCode,
        Cluster: r.cluster,
        Building: r.building,
        Zone: r.zone,
        Lane: r.lane,
        Direction: r.direction,
      });
    }
  }

  const matchedDeviceCodes = new Set(
    matched.map(x => norm(x["Device ID"]))
  );

  const backendNotFoundInExcel = protectedRows
    .filter(d => !matchedDeviceCodes.has(norm(d.deviceCode)))
    .map(d => ({
      "Backend ID": d.id,
      "Device ID": d.deviceCode,
      IP: clean(d.ipAddress),
      Serial: clean(d.serialNumber),
      Secret: clean(d.secretCode),
    }));

  const summary = [
    { Metric: "Excel rows", Value: rows.length },
    { Metric: "Backend protected KEEP", Value: protectedRows.length },

    { Metric: "Duplicate Device ID groups", Value: dupDevice.groups.length },
    { Metric: "Rows in Device ID duplicates", Value: dupDevice.participantRows.size },

    { Metric: "Duplicate IP groups", Value: dupIp.groups.length },
    { Metric: "Rows in IP duplicates", Value: dupIp.participantRows.size },

    { Metric: "Duplicate Serial groups", Value: dupSerial.groups.length },
    { Metric: "Rows in Serial duplicates", Value: dupSerial.participantRows.size },

    { Metric: "Duplicate Secret groups", Value: dupSecret.groups.length },
    { Metric: "Rows in Secret duplicates", Value: dupSecret.participantRows.size },

    { Metric: "Invalid IP rows", Value: invalidIp.length },
    { Metric: "Invalid Serial rows", Value: invalidSerial.length },

    { Metric: "Matched existing by Device ID", Value: matched.length },
    { Metric: "Backend KEEP not found by Device ID", Value: backendNotFoundInExcel.length },
    { Metric: "Rows considered NEW by Device ID", Value: newRows.length },
  ];

  const report = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    report,
    XLSX.utils.json_to_sheet(summary),
    "Summary"
  );

  XLSX.utils.book_append_sheet(
    report,
    XLSX.utils.json_to_sheet(
      dupDevice.groups.length ? dupDevice.groups : [{ Result: "No duplicate Device IDs" }]
    ),
    "DUP Device ID"
  );

  XLSX.utils.book_append_sheet(
    report,
    XLSX.utils.json_to_sheet(
      dupIp.groups.length ? dupIp.groups : [{ Result: "No duplicate IPs" }]
    ),
    "DUP IP"
  );

  XLSX.utils.book_append_sheet(
    report,
    XLSX.utils.json_to_sheet(
      dupSerial.groups.length ? dupSerial.groups : [{ Result: "No duplicate Serials" }]
    ),
    "DUP Serial"
  );

  XLSX.utils.book_append_sheet(
    report,
    XLSX.utils.json_to_sheet(
      dupSecret.groups.length ? dupSecret.groups : [{ Result: "No duplicate Secrets" }]
    ),
    "DUP Secret"
  );

  XLSX.utils.book_append_sheet(
    report,
    XLSX.utils.json_to_sheet(
      [...invalidIp, ...invalidSerial].length
        ? [...invalidIp, ...invalidSerial]
        : [{ Result: "No invalid IP/Serial values" }]
    ),
    "INVALID"
  );

  XLSX.utils.book_append_sheet(
    report,
    XLSX.utils.json_to_sheet(
      matched.length ? matched : [{ Result: "No Device ID matches" }]
    ),
    "MATCHED BY DEVICE ID"
  );

  XLSX.utils.book_append_sheet(
    report,
    XLSX.utils.json_to_sheet(
      backendNotFoundInExcel.length
        ? backendNotFoundInExcel
        : [{ Result: "All 641 backend Device IDs found" }]
    ),
    "KEEP NOT IN FILE"
  );

  XLSX.utils.book_append_sheet(
    report,
    XLSX.utils.json_to_sheet(
      newRows.length ? newRows : [{ Result: "No new rows" }]
    ),
    "NEW BY DEVICE ID"
  );

  XLSX.writeFile(report, REPORT_FILE);

  console.log("");
  console.log("RESULT");
  console.log("------------------------------------------------------------");
  console.log(`Duplicate Device ID groups : ${dupDevice.groups.length}`);
  console.log(`Duplicate IP groups        : ${dupIp.groups.length}`);
  console.log(`Duplicate Serial groups    : ${dupSerial.groups.length}`);
  console.log(`Duplicate Secret groups    : ${dupSecret.groups.length}`);
  console.log(`Invalid IP rows            : ${invalidIp.length}`);
  console.log(`Invalid Serial rows        : ${invalidSerial.length}`);
  console.log(`Matched by Device ID       : ${matched.length} / 641`);
  console.log(`KEEP not found in file     : ${backendNotFoundInExcel.length}`);
  console.log(`NEW by Device ID           : ${newRows.length}`);
  console.log(`Report                     : ${REPORT_FILE}`);
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
