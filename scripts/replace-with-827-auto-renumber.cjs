const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const INPUT_FILE =
  "C:\\backend\\ALL_827_NEW_DATA_AND_CLEAN_LABELS.xlsx";

const REPORT_FILE =
  "C:\\backend\\IMPORT_827_RENUMBER_REPORT.xlsx";

const FINAL_EXPORT_FILE =
  "C:\\backend\\BACKEND_FINAL_827.xlsx";

const EXPECTED_ROWS = 827;

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
  return /^[A-Za-z0-9._-]{5,}$/.test(s) ? s : "";
}

function generateSecret(used) {
  while (true) {
    const h = crypto.randomBytes(8).toString("hex").toUpperCase();
    const value =
      `DSC-${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}`;

    if (!used.has(norm(value))) {
      used.add(norm(value));
      return value;
    }
  }
}

function makeBarcode(row, used) {
  const base =
    "DEV827-" +
    clean(row.finalDeviceCode) +
    "-" +
    crypto
      .createHash("sha1")
      .update(
        `${row.finalDeviceCode}|${row.finalSecretCode}|${row.ipAddress}|${row.serialNumber}`
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

function locationKey(row) {
  return [
    norm(row.cluster),
    norm(row.building),
    norm(row.zone),
    norm(row.lane),
    norm(row.direction),
  ].join("|");
}

function qIdent(v) {
  return `"${String(v).replace(/"/g, '""')}"`;
}

function jsonReplacer(_k, v) {
  return typeof v === "bigint" ? v.toString() : v;
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

function readAndPrepareExcel() {
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

      const rawDeviceCode = get(r, [
        "Device ID",
        "Device Code",
      ]);

      const ipRaw = get(r, ["IP", "IP Address"]);
      const serialRaw = get(r, [
        "Serial",
        "Serial Number",
      ]);

      return {
        excelRow: index + 2,

        originalDeviceCode: rawDeviceCode,
        finalDeviceCode: rawDeviceCode,

        originalSecretCode: get(r, [
          "Secret Code",
          "Secret",
        ]),
        finalSecretCode: "",

        ipRaw,
        ipAddress: validIPv4(ipRaw),

        serialRaw,
        serialNumber: validSerial(serialRaw),

        cluster: get(r, ["Cluster"]),
        building: get(r, [
          "Building",
          "اسم الوزارة / الجهة",
        ]),
        zone: get(r, ["Zone"]),
        lane: normalizeLane(get(r, ["Lane"])),
        direction: get(r, ["Direction"]).toUpperCase(),
      };
    })
    .filter(r =>
      [
        r.originalDeviceCode,
        r.originalSecretCode,
        r.ipRaw,
        r.serialRaw,
        r.cluster,
        r.building,
        r.zone,
        r.lane,
        r.direction,
      ].some(Boolean)
    );

  if (rows.length !== EXPECTED_ROWS) {
    throw new Error(
      `SAFETY STOP: expected ${EXPECTED_ROWS} Excel rows, found ${rows.length}.`
    );
  }

  const idChanges = [];
  const serialChanges = [];
  const secretChanges = [];
  const ipIssues = [];

  // ----------------------------------------------------------
  // 1) DEVICE ID:
  // Keep first occurrence. Every duplicate / blank gets a new
  // numeric Device ID larger than all numeric IDs in the file.
  // ----------------------------------------------------------
  const numericIds = rows
    .map(r => Number(clean(r.originalDeviceCode)))
    .filter(Number.isFinite);

  let nextId = numericIds.length
    ? Math.max(...numericIds) + 1
    : 1;

  const usedDeviceCodes = new Set();

  for (const row of rows) {
    const original = clean(row.originalDeviceCode);
    const key = norm(original);

    if (original && !usedDeviceCodes.has(key)) {
      row.finalDeviceCode = original;
      usedDeviceCodes.add(key);
      continue;
    }

    while (usedDeviceCodes.has(norm(String(nextId)))) {
      nextId++;
    }

    const newId = String(nextId++);
    row.finalDeviceCode = newId;
    usedDeviceCodes.add(norm(newId));

    idChanges.push({
      "Excel Row": row.excelRow,
      "Old Device ID": original || "(BLANK)",
      "New Device ID": newId,
      Reason: original
        ? `Duplicate Device ID: ${original}`
        : "Blank Device ID",
      IP: row.ipRaw,
      Serial: row.serialRaw,
      "Secret Code": row.originalSecretCode,
      Cluster: row.cluster,
      Building: row.building,
      Zone: row.zone,
      Lane: row.lane,
      Direction: row.direction,
    });
  }

  // ----------------------------------------------------------
  // 2) SERIAL:
  // DB has UNIQUE serialNumber.
  // Keep first valid serial. Duplicate/invalid serial => NULL.
  // We DO NOT invent a fake serial.
  // ----------------------------------------------------------
  const usedSerials = new Set();

  for (const row of rows) {
    const raw = clean(row.serialRaw);
    const valid = validSerial(raw);

    if (!raw) {
      row.serialNumber = null;
      continue;
    }

    if (!valid) {
      row.serialNumber = null;

      serialChanges.push({
        "Excel Row": row.excelRow,
        "Device ID": row.finalDeviceCode,
        "Original Serial": raw,
        "Stored Serial": "(NULL)",
        Reason: "Invalid Serial value",
        IP: row.ipRaw,
        Cluster: row.cluster,
        Building: row.building,
        Zone: row.zone,
        Lane: row.lane,
        Direction: row.direction,
      });

      continue;
    }

    if (usedSerials.has(norm(valid))) {
      row.serialNumber = null;

      serialChanges.push({
        "Excel Row": row.excelRow,
        "Device ID": row.finalDeviceCode,
        "Original Serial": raw,
        "Stored Serial": "(NULL)",
        Reason: `Duplicate Serial: ${raw}`,
        IP: row.ipRaw,
        Cluster: row.cluster,
        Building: row.building,
        Zone: row.zone,
        Lane: row.lane,
        Direction: row.direction,
      });

      continue;
    }

    row.serialNumber = valid;
    usedSerials.add(norm(valid));
  }

  // ----------------------------------------------------------
  // 3) SECRET CODE:
  // DB requires uniqueness.
  // Keep first unique source code. Duplicate/blank => generate new.
  // ----------------------------------------------------------
  const usedSecrets = new Set();

  for (const row of rows) {
    const original = clean(row.originalSecretCode);

    if (original && !usedSecrets.has(norm(original))) {
      row.finalSecretCode = original;
      usedSecrets.add(norm(original));
      continue;
    }

    const newSecret = generateSecret(usedSecrets);
    row.finalSecretCode = newSecret;

    secretChanges.push({
      "Excel Row": row.excelRow,
      "Device ID": row.finalDeviceCode,
      "Old Secret Code": original || "(BLANK)",
      "New Secret Code": newSecret,
      Reason: original
        ? `Duplicate Secret Code: ${original}`
        : "Blank Secret Code",
      IP: row.ipRaw,
      Serial: row.serialRaw,
      Cluster: row.cluster,
      Building: row.building,
      Zone: row.zone,
      Lane: row.lane,
      Direction: row.direction,
    });
  }

  // ----------------------------------------------------------
  // 4) IP:
  // ipAddress is NOT unique in schema.
  // Invalid text is stored NULL and reported.
  // Duplicate valid IP is allowed and does not block the 827 upload.
  // ----------------------------------------------------------
  for (const row of rows) {
    if (row.ipRaw && !row.ipAddress) {
      ipIssues.push({
        "Excel Row": row.excelRow,
        "Device ID": row.finalDeviceCode,
        "Original IP": row.ipRaw,
        "Stored IP": "(NULL)",
        Reason: "Invalid IPv4 value",
        Serial: row.serialRaw,
        Cluster: row.cluster,
        Building: row.building,
        Zone: row.zone,
        Lane: row.lane,
        Direction: row.direction,
      });

      row.ipAddress = null;
    } else if (!row.ipRaw) {
      row.ipAddress = null;
    }
  }

  return {
    sheetName,
    rows,
    idChanges,
    serialChanges,
    secretChanges,
    ipIssues,
  };
}

function writeReport(prepared, backendBeforeCount, gateCount) {
  const {
    rows,
    idChanges,
    serialChanges,
    secretChanges,
    ipIssues,
  } = prepared;

  const summary = [
    { Metric: "Excel rows", Value: rows.length },
    {
      Metric: "Device ID changed",
      Value: idChanges.length,
    },
    {
      Metric: "Serial set NULL",
      Value: serialChanges.length,
    },
    {
      Metric: "Secret Code changed/generated",
      Value: secretChanges.length,
    },
    {
      Metric: "Invalid IP set NULL",
      Value: ipIssues.length,
    },
    {
      Metric: "Current DEVICE rows",
      Value: backendBeforeCount,
    },
    {
      Metric: "Current GATE rows - untouched",
      Value: gateCount,
    },
    {
      Metric: "Final DEVICE rows after apply",
      Value: 827,
    },
  ];

  const finalRows = rows.map(r => ({
    "Excel Row": r.excelRow,
    "Original Device ID": r.originalDeviceCode,
    "Final Device ID": r.finalDeviceCode,
    "Secret Code": r.finalSecretCode,
    IP: r.ipAddress || "",
    Serial: r.serialNumber || "",
    Cluster: r.cluster,
    Building: r.building,
    Zone: r.zone,
    Lane: r.lane,
    Direction: r.direction,
  }));

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(summary),
    "Summary"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      idChanges.length
        ? idChanges
        : [{ Result: "No Device ID changes" }]
    ),
    "DEVICE ID CHANGES"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      serialChanges.length
        ? serialChanges
        : [{ Result: "No Serial changes" }]
    ),
    "SERIAL CHANGES"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      secretChanges.length
        ? secretChanges
        : [{ Result: "No Secret Code changes" }]
    ),
    "SECRET CHANGES"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      ipIssues.length
        ? ipIssues
        : [{ Result: "No invalid IP values" }]
    ),
    "IP ISSUES"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(finalRows),
    "FINAL 827 PLAN"
  );

  XLSX.writeFile(wb, REPORT_FILE);
}

async function getRestrictDependencies(deviceIds) {
  if (!deviceIds.length) return [];

  const idsSql = deviceIds.map(Number).join(",");

  const fks = await prisma.$queryRawUnsafe(`
    SELECT
      ns_child.nspname AS "childSchema",
      child.relname AS "childTable",
      att_child.attname AS "childColumn",
      CASE con.confdeltype
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
        ELSE con.confdeltype::text
      END AS "onDelete"
    FROM pg_constraint con
    JOIN pg_class child
      ON child.oid = con.conrelid
    JOIN pg_namespace ns_child
      ON ns_child.oid = child.relnamespace
    JOIN pg_class parent
      ON parent.oid = con.confrelid
    JOIN LATERAL unnest(con.conkey)
      WITH ORDINALITY AS ck(attnum, ord)
      ON TRUE
    JOIN LATERAL unnest(con.confkey)
      WITH ORDINALITY AS pk(attnum, ord)
      ON pk.ord = ck.ord
    JOIN pg_attribute att_child
      ON att_child.attrelid = con.conrelid
     AND att_child.attnum = ck.attnum
    JOIN pg_attribute att_parent
      ON att_parent.attrelid = con.confrelid
     AND att_parent.attnum = pk.attnum
    WHERE con.contype = 'f'
      AND parent.relname = 'Device'
      AND att_parent.attname = 'id'
      AND con.confdeltype IN ('a', 'r')
    ORDER BY ns_child.nspname, child.relname
  `);

  const grouped = new Map();

  for (const fk of fks) {
    const key = `${fk.childSchema}.${fk.childTable}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        schema: fk.childSchema,
        table: fk.childTable,
        columns: [],
      });
    }

    const group = grouped.get(key);

    if (!group.columns.includes(fk.childColumn)) {
      group.columns.push(fk.childColumn);
    }
  }

  const result = [];

  for (const group of grouped.values()) {
    const schema = qIdent(group.schema);
    const table = qIdent(group.table);

    const where = group.columns
      .map(col => `${qIdent(col)} IN (${idsSql})`)
      .join(" OR ");

    const rows = await prisma.$queryRawUnsafe(`
      SELECT *
      FROM ${schema}.${table}
      WHERE ${where}
    `);

    if (rows.length) {
      result.push({
        ...group,
        where,
        rows,
      });
    }
  }

  return result;
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
    const hash = crypto
      .createHash("sha1")
      .update(key)
      .digest("hex")
      .slice(0, 16)
      .toUpperCase();

    let excelId = `FINAL827-${hash}`;

    const collision = await tx.location.findFirst({
      where: { excelId },
    });

    if (collision) {
      excelId =
        `${excelId}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
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

async function exportBackend() {
  const rows = await prisma.device.findMany({
    where: {
      assetType: "DEVICE",
    },
    include: {
      location: true,
      deviceType: true,
    },
    orderBy: {
      id: "asc",
    },
  });

  const output = rows.map(d => ({
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
    XLSX.utils.json_to_sheet(output),
    "FINAL 827"
  );

  XLSX.writeFile(wb, FINAL_EXPORT_FILE);
}

async function main() {
  const apply = process.argv.includes("--apply");

  console.log("============================================================");
  console.log(" REPLACE DEVICE DATA WITH FINAL 827");
  console.log(" DUPLICATE DEVICE ID => AUTO RENUMBER");
  console.log(" ALL 827 WILL BE IMPORTED");
  console.log("============================================================");
  console.log(apply ? "MODE: APPLY" : "MODE: DRY RUN");
  console.log("");

  const prepared = readAndPrepareExcel();

  const currentDevices = await prisma.device.findMany({
    where: {
      assetType: "DEVICE",
    },
    include: {
      location: true,
      deviceType: true,
    },
    orderBy: {
      id: "asc",
    },
  });

  const gateCount = await prisma.device.count({
    where: {
      assetType: "GATE",
    },
  });

  const deviceTypeIds = [
    ...new Set(
      currentDevices
        .map(d => Number(d.deviceTypeId))
        .filter(Number.isFinite)
    ),
  ];

  if (deviceTypeIds.length !== 1) {
    throw new Error(
      `SAFETY STOP: current DEVICE rows use ${deviceTypeIds.length} device types.`
    );
  }

  const defaultDeviceTypeId = deviceTypeIds[0];

  writeReport(
    prepared,
    currentDevices.length,
    gateCount
  );

  console.log(`Excel sheet               : ${prepared.sheetName}`);
  console.log(`Excel rows                : ${prepared.rows.length}`);
  console.log(`Current DEVICE rows       : ${currentDevices.length}`);
  console.log(`Current GATE rows         : ${gateCount} (UNTOUCHED)`);
  console.log("");
  console.log("AUTO FIX");
  console.log("------------------------------------------------------------");
  console.log(`Device IDs renumbered     : ${prepared.idChanges.length}`);
  console.log(`Serials set NULL          : ${prepared.serialChanges.length}`);
  console.log(`Secret Codes regenerated  : ${prepared.secretChanges.length}`);
  console.log(`Invalid IPs set NULL      : ${prepared.ipIssues.length}`);
  console.log(`Final DEVICE count        : 827`);
  console.log(`Report                    : ${REPORT_FILE}`);

  if (prepared.idChanges.length) {
    console.log("");
    console.log("DEVICE ID CHANGES");
    console.log("------------------------------------------------------------");

    for (const c of prepared.idChanges) {
      console.log(
        `Excel Row ${c["Excel Row"]}: ${c["Old Device ID"]} -> ${c["New Device ID"]} | ${c.Reason}`
      );
    }
  }

  if (!apply) {
    console.log("");
    console.log("============================================================");
    console.log(" DRY RUN ONLY ✅");
    console.log("============================================================");
    console.log("✅ NO DATABASE CHANGES WERE MADE.");
    console.log("✅ The Excel report shows every automatic change.");
    console.log("");
    console.log("To replace current DEVICE rows with these 827:");
    console.log("node scripts\\replace-with-827-auto-renumber.cjs --apply");
    return;
  }

  const backupDir = path.join(
    process.cwd(),
    "backup"
  );

  fs.mkdirSync(
    backupDir,
    {
      recursive: true,
    }
  );

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  const deviceBackupPath = path.join(
    backupDir,
    `before-final-827-devices-${stamp}.json`
  );

  fs.writeFileSync(
    deviceBackupPath,
    JSON.stringify(
      currentDevices,
      jsonReplacer,
      2
    ),
    "utf8"
  );

  const currentDeviceIds =
    currentDevices.map(d => Number(d.id));

  const dependencies =
    await getRestrictDependencies(
      currentDeviceIds
    );

  for (const dep of dependencies) {
    const depBackupPath = path.join(
      backupDir,
      `${dep.table}-before-final-827-${stamp}.json`
    );

    fs.writeFileSync(
      depBackupPath,
      JSON.stringify(
        dep.rows,
        jsonReplacer,
        2
      ),
      "utf8"
    );
  }

  console.log("");
  console.log(`Device backup            : ${deviceBackupPath}`);

  for (const dep of dependencies) {
    console.log(
      `Dependency backup        : ${dep.table} (${dep.rows.length} rows)`
    );
  }

  console.log("");
  console.log("FINAL ACTION");
  console.log("------------------------------------------------------------");
  console.log(`DELETE old DEVICE rows   : ${currentDevices.length}`);
  console.log(`INSERT final DEVICE rows : 827`);
  console.log(`GATE rows touched        : 0`);
  console.log(`FINAL DEVICE count       : 827`);
  console.log("");

  const confirm = await ask(
    "Type REPLACE-WITH-827 to continue: "
  );

  if (confirm !== "REPLACE-WITH-827") {
    console.log("❌ Cancelled. NO DATABASE CHANGES WERE MADE.");
    return;
  }

  const usedBarcodes = new Set();
  const locationCache = new Map();

  const result = await prisma.$transaction(
    async tx => {
      const beforeDevices =
        await tx.device.findMany({
          where: {
            assetType: "DEVICE",
          },
          select: {
            id: true,
          },
        });

      const beforeGates =
        await tx.device.count({
          where: {
            assetType: "GATE",
          },
        });

      if (
        beforeDevices.length !==
        currentDevices.length
      ) {
        throw new Error(
          `ROLLBACK: DEVICE count changed before apply. Expected ${currentDevices.length}, found ${beforeDevices.length}.`
        );
      }

      // Delete RESTRICT / NO ACTION child rows only for old DEVICE ids.
      for (const dep of dependencies) {
        const schema = qIdent(dep.schema);
        const table = qIdent(dep.table);

        const deleted =
          await tx.$executeRawUnsafe(`
            DELETE FROM ${schema}.${table}
            WHERE ${dep.where}
          `);

        if (
          Number(deleted) !==
          dep.rows.length
        ) {
          throw new Error(
            `ROLLBACK: ${dep.schema}.${dep.table} expected delete=${dep.rows.length}, actual=${deleted}.`
          );
        }
      }

      const deletedDevices =
        await tx.device.deleteMany({
          where: {
            id: {
              in: currentDeviceIds,
            },
            assetType: "DEVICE",
          },
        });

      if (
        deletedDevices.count !==
        currentDevices.length
      ) {
        throw new Error(
          `ROLLBACK: expected to delete ${currentDevices.length} old DEVICE rows, deleted ${deletedDevices.count}.`
        );
      }

      let inserted = 0;

      for (const row of prepared.rows) {
        const locationId =
          await getOrCreateLocation(
            tx,
            row,
            locationCache
          );

        const barcode = makeBarcode(
          row,
          usedBarcodes
        );

        await tx.device.create({
          data: {
            deviceCode:
              row.finalDeviceCode,

            deviceName:
              `Device ${row.finalDeviceCode}`,

            barcode,

            ipAddress:
              row.ipAddress || null,

            serialNumber:
              row.serialNumber || null,

            secretCode:
              row.finalSecretCode,

            assetType:
              "DEVICE",

            currentStatus:
              "OK",

            lifecycleStatus:
              "ACTIVE",

            deviceTypeId:
              defaultDeviceTypeId,

            locationId,

            notes:
              row.originalDeviceCode !==
              row.finalDeviceCode
                ? `Imported from final 827. Device ID changed from ${row.originalDeviceCode || "BLANK"} to ${row.finalDeviceCode}.`
                : "Imported from final 827.",
          },
        });

        inserted++;
      }

      const finalDevices =
        await tx.device.findMany({
          where: {
            assetType: "DEVICE",
          },
          select: {
            id: true,
            deviceCode: true,
            serialNumber: true,
            secretCode: true,
          },
        });

      const finalGates =
        await tx.device.count({
          where: {
            assetType: "GATE",
          },
        });

      if (finalDevices.length !== 827) {
        throw new Error(
          `ROLLBACK: final DEVICE count=${finalDevices.length}, expected 827.`
        );
      }

      if (finalGates !== beforeGates) {
        throw new Error(
          `ROLLBACK: GATE count changed ${beforeGates} -> ${finalGates}.`
        );
      }

      const uniqueCount = values =>
        new Set(
          values
            .map(norm)
            .filter(Boolean)
        ).size;

      const codes =
        finalDevices.map(r => r.deviceCode);

      const serials =
        finalDevices
          .map(r => r.serialNumber)
          .filter(Boolean);

      const secrets =
        finalDevices.map(r => r.secretCode);

      if (
        uniqueCount(codes) !==
        827
      ) {
        throw new Error(
          "ROLLBACK: Device IDs are not unique after import."
        );
      }

      if (
        uniqueCount(serials) !==
        serials.length
      ) {
        throw new Error(
          "ROLLBACK: Serials are not unique after import."
        );
      }

      if (
        secrets.some(s => !clean(s)) ||
        uniqueCount(secrets) !==
        827
      ) {
        throw new Error(
          "ROLLBACK: Secret Codes are not unique/non-empty after import."
        );
      }

      return {
        deleted:
          deletedDevices.count,
        inserted,
        finalDeviceCount:
          finalDevices.length,
        gateBefore:
          beforeGates,
        gateAfter:
          finalGates,
        uniqueDeviceCodes:
          uniqueCount(codes),
        uniqueSerials:
          uniqueCount(serials),
        serialCount:
          serials.length,
        uniqueSecrets:
          uniqueCount(secrets),
      };
    },
    {
      maxWait: 10000,
      timeout: 240000,
    }
  );

  await exportBackend();

  console.log("");
  console.log("============================================================");
  console.log(" SUCCESS ✅");
  console.log("============================================================");
  console.log(`Old DEVICE deleted      : ${result.deleted}`);
  console.log(`New DEVICE inserted     : ${result.inserted}`);
  console.log(`Final DEVICE count      : ${result.finalDeviceCount}`);
  console.log(`Unique Device IDs       : ${result.uniqueDeviceCodes} / 827`);
  console.log(`Unique Serials          : ${result.uniqueSerials} / ${result.serialCount}`);
  console.log(`Unique Secret Codes     : ${result.uniqueSecrets} / 827`);
  console.log(`GATE before/after       : ${result.gateBefore}/${result.gateAfter}`);
  console.log(`Device ID changes       : ${prepared.idChanges.length}`);
  console.log(`Serial adjustments      : ${prepared.serialChanges.length}`);
  console.log(`Secret adjustments      : ${prepared.secretChanges.length}`);
  console.log(`Invalid IP adjustments  : ${prepared.ipIssues.length}`);
  console.log(`Changes report          : ${REPORT_FILE}`);
  console.log(`Backend export          : ${FINAL_EXPORT_FILE}`);
  console.log("");
  console.log("✅ EXACTLY 827 DEVICE ROWS ARE NOW IN BACKEND.");
  console.log("✅ DUPLICATE DEVICE IDs WERE AUTO-RENUMBERED.");
  console.log("✅ EVERY DEVICE ID CHANGE IS WRITTEN IN THE EXCEL REPORT.");
  console.log("✅ GATE ROWS WERE NOT TOUCHED.");
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
