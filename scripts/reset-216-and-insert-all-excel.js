const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const { Client } = require("pg");
require("dotenv").config();

const SHOULD_RUN = process.argv.includes("--run");

const EXCEL_PATH =
  process.argv.find((arg) => arg.toLowerCase().endsWith(".xlsx")) ||
  path.join(process.cwd(), "secret_codes_312_with_ip_unique_vs_old.xlsx");

const OLD_UPDATE_LOG_TABLE =
  process.env.OLD_UPDATE_LOG_TABLE ||
  "device_secret_update_312_log_2026_07_09_12_04_21";

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "");
}

function q(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");

  return `${d.getFullYear()}_${pad(d.getMonth() + 1)}_${pad(d.getDate())}_${pad(
    d.getHours()
  )}_${pad(d.getMinutes())}_${pad(d.getSeconds())}`;
}

function safeIpForCode(ip) {
  return clean(ip).replace(/[^0-9]/g, "");
}

function makeDeviceCode(row, index, ts) {
  return `EXCELFULL-${row.excelRow}-${index + 1}-${safeIpForCode(row.ip)}-${ts}`;
}

function makeSerialNumber(row, index, ts) {
  return `EXCELFULL-SN-${row.excelRow}-${index + 1}-${safeIpForCode(row.ip)}-${ts}`;
}

function makeDeviceName(row) {
  return [
    "Excel QR Device",
    row.building,
    row.zone,
    row.direction,
    row.ip,
  ]
    .map(clean)
    .filter(Boolean)
    .join(" - ");
}

function findDuplicates(values) {
  const seen = new Set();
  const dup = new Set();

  for (const value of values) {
    const v = clean(value);
    if (seen.has(v)) dup.add(v);
    seen.add(v);
  }

  return [...dup];
}

function readExcelRows() {
  if (!fs.existsSync(EXCEL_PATH)) {
    throw new Error(`Excel file not found: ${EXCEL_PATH}`);
  }

  const workbook = xlsx.readFile(EXCEL_PATH);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rawRows = xlsx.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false,
  });

  if (!rawRows.length) {
    throw new Error("Excel file is empty.");
  }

  const headerMap = {};
  for (const header of Object.keys(rawRows[0])) {
    headerMap[normalizeHeader(header)] = header;
  }

  const required = ["cluster", "building", "zone", "ip", "direction", "secrt"];
  const missing = required.filter((h) => !headerMap[h]);

  if (missing.length) {
    throw new Error(`Missing Excel columns: ${missing.join(", ")}`);
  }

  return rawRows
    .map((r, index) => ({
      excelRow: index + 2,
      cluster: clean(r[headerMap.cluster]),
      building: clean(r[headerMap.building]),
      zone: clean(r[headerMap.zone]),
      ip: clean(r[headerMap.ip]),
      direction: clean(r[headerMap.direction]).toUpperCase(),
      secretCode: clean(r[headerMap.secrt]),
    }))
    .filter((r) => {
      return (
        r.cluster ||
        r.building ||
        r.zone ||
        r.ip ||
        r.direction ||
        r.secretCode
      );
    });
}

async function getBestDeviceType(client) {
  const res = await client.query(`
    SELECT
      id,
      name,
      "assetType"::text AS "assetType"
    FROM "DeviceType"
    ORDER BY
      CASE
        WHEN upper(COALESCE("assetType"::text, '')) IN ('GATE', 'GATES') THEN 0
        WHEN lower(COALESCE(name, '')) LIKE '%gate%' THEN 1
        WHEN lower(COALESCE(name, '')) LIKE '%turn%' THEN 2
        WHEN name LIKE '%بوابة%' THEN 3
        ELSE 9
      END,
      id
    LIMIT 1
  `);

  if (!res.rows.length) {
    throw new Error("No DeviceType found. لازم يكون فيه صف في جدول DeviceType.");
  }

  return res.rows[0];
}

async function main() {
  console.log("====================================");
  console.log("RESET 216 + INSERT FULL EXCEL");
  console.log("====================================");
  console.log("Mode:", SHOULD_RUN ? "REAL RUN" : "DRY RUN ONLY");
  console.log("Excel:", EXCEL_PATH);
  console.log("Old update log:", OLD_UPDATE_LOG_TABLE);
  console.log("====================================");

  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    throw new Error("DATABASE_URL is missing.");
  }

  const rows = readExcelRows();

  console.log("Excel rows found:", rows.length);

  const badRows = rows.filter((r) => !r.secretCode || !r.ip);

  if (badRows.length) {
    console.log("Rows missing IP or secret:");
    console.table(badRows);
    throw new Error("Stopped because some rows have missing IP or secret.");
  }

  const duplicateSecrets = findDuplicates(rows.map((r) => r.secretCode));

  if (duplicateSecrets.length) {
    console.log("Duplicate secret codes inside Excel:");
    console.table(duplicateSecrets.map((secretCode) => ({ secretCode })));
    throw new Error("Stopped because Excel has duplicate secret codes.");
  }

  const duplicateIps = findDuplicates(rows.map((r) => r.ip));

  if (duplicateIps.length) {
    console.log("⚠️ Duplicate IPs inside Excel. هنرفعهم عادي كأجهزة منفصلة لأن الـ secret مختلف:");
    console.table(duplicateIps.map((ip) => ({ ip })));
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: dbUrl.includes("proxy.rlwy.net")
      ? { rejectUnauthorized: false }
      : false,
  });

  await client.connect();

  try {
    const ts = timestamp();

    const deviceType = await getBestDeviceType(client);
    const deviceTypeId = deviceType.id;
    const assetType = clean(deviceType.assetType) || "GATE";

    console.log("Selected DeviceType:", deviceType);
    console.log("Using assetType:", assetType);

    const oldLogExists = await client.query(
      `
      SELECT to_regclass($1) AS table_name
      `,
      [`public.${OLD_UPDATE_LOG_TABLE}`]
    );

    if (!oldLogExists.rows[0].table_name) {
      throw new Error(`Old update log table not found: ${OLD_UPDATE_LOG_TABLE}`);
    }

    const readyCountRes = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM ${q(OLD_UPDATE_LOG_TABLE)}
      WHERE action = 'READY_UPDATE'
    `);

    const readyCount = readyCountRes.rows[0].count;

    console.log("216 update rows found in old log:", readyCount);

    if (!SHOULD_RUN) {
      console.log("\n====================================");
      console.log("DRY RUN ONLY");
      console.log("هيعمل الآتي عند --run:");
      console.log("1) Backup لجدول Device");
      console.log("2) يرجع الـ READY_UPDATE للقديم");
      console.log("3) يرفع كل صفوف الإكسيل كـ Devices جديدة");
      console.log("Excel rows to insert:", rows.length);
      console.log("====================================");
      await client.end();
      return;
    }

    await client.query("BEGIN");

    const backupTable = `backup_Device_before_full_excel_reset_insert_${ts}`;
    const importLogTable = `full_excel_reset_insert_log_${ts}`;

    await client.query(`
      CREATE TABLE ${q(backupTable)} AS
      TABLE "Device"
    `);

    await client.query(`
      CREATE TABLE ${q(importLogTable)} (
        id SERIAL PRIMARY KEY,
        action TEXT,
        excel_row INTEGER,
        old_device_id INTEGER,
        inserted_device_id INTEGER,
        ip TEXT,
        old_secret TEXT,
        new_secret TEXT,
        barcode TEXT,
        serial_number TEXT,
        device_code TEXT,
        cluster TEXT,
        building TEXT,
        zone TEXT,
        direction TEXT,
        message TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log("Backup table created:", backupTable);
    console.log("Import log table created:", importLogTable);

    console.log("\nSTEP 1: Resetting old 216 updated devices...");

    const oldUpdatesRes = await client.query(`
      SELECT
        excel_row,
        device_id,
        ip,
        old_secret,
        new_secret,
        cluster,
        building,
        zone,
        direction
      FROM ${q(OLD_UPDATE_LOG_TABLE)}
      WHERE action = 'READY_UPDATE'
      ORDER BY excel_row
    `);

    let resetCount = 0;

    for (const row of oldUpdatesRes.rows) {
      await client.query(
        `
        UPDATE "Device"
        SET "secretCode" = $1,
            "updatedAt" = NOW()
        WHERE id = $2
        `,
        [row.old_secret, row.device_id]
      );

      await client.query(
        `
        INSERT INTO ${q(importLogTable)}
        (
          action,
          excel_row,
          old_device_id,
          ip,
          old_secret,
          new_secret,
          cluster,
          building,
          zone,
          direction,
          message
        )
        VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `,
        [
          "RESET_OLD_216",
          row.excel_row,
          row.device_id,
          row.ip,
          row.old_secret,
          row.new_secret,
          row.cluster,
          row.building,
          row.zone,
          row.direction,
          "Restored old secretCode before full Excel insert",
        ]
      );

      resetCount++;

      console.log(
        `[RESET ${resetCount}/${oldUpdatesRes.rows.length}] Device ID: ${row.device_id} | IP: ${row.ip} | Restored old secret`
      );
    }

    console.log("\nSTEP 2: Checking Excel secrets after reset...");

    const existingSecretsAfterReset = await client.query(
      `
      SELECT id, "ipAddress", "secretCode"
      FROM "Device"
      WHERE "secretCode" = ANY($1)
      `,
      [rows.map((r) => r.secretCode)]
    );

    if (existingSecretsAfterReset.rows.length) {
      console.log("These new Excel secrets still exist in Device after reset:");
      console.table(existingSecretsAfterReset.rows.slice(0, 50));
      throw new Error(
        "Stopped because some Excel secret codes already exist in Device after reset."
      );
    }

    console.log("OK: No Excel new secret exists after reset.");

    console.log("\nSTEP 3: Inserting full Excel as new Devices...");

    let inserted = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const n = String(i + 1).padStart(3, "0");

      const ip = clean(row.ip);
      const secretCode = clean(row.secretCode);
      const barcode = secretCode;
      const deviceCode = makeDeviceCode(row, i, ts);
      const serialNumber = makeSerialNumber(row, i, ts);
      const deviceName = makeDeviceName(row);

      try {
        const insertRes = await client.query(
          `
          INSERT INTO "Device"
          (
            "deviceCode",
            "deviceName",
            "barcode",
            "serialNumber",
            "manufacturer",
            "modelNumber",
            "currentStatus",
            "deviceTypeId",
            "ipAddress",
            "secretCode",
            "assetType",
            "gateCluster",
            "gateBuilding",
            "gateZone",
            "gateDirection",
            "notes",
            "createdAt",
            "updatedAt"
          )
          VALUES
          (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW()
          )
          RETURNING id
          `,
          [
            deviceCode,
            deviceName || `Excel QR Device ${row.excelRow}`,
            barcode,
            serialNumber,
            "Unknown",
            "Unknown",
            "OK",
            deviceTypeId,
            ip,
            secretCode,
            assetType,
            clean(row.cluster),
            clean(row.building),
            clean(row.zone),
            clean(row.direction),
            `Inserted from full Excel reset import. Excel row: ${row.excelRow}`,
          ]
        );

        const insertedId = insertRes.rows[0].id;

        await client.query(
          `
          INSERT INTO ${q(importLogTable)}
          (
            action,
            excel_row,
            inserted_device_id,
            ip,
            new_secret,
            barcode,
            serial_number,
            device_code,
            cluster,
            building,
            zone,
            direction,
            message
          )
          VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          `,
          [
            "INSERT_FULL_EXCEL_DEVICE",
            row.excelRow,
            insertedId,
            ip,
            secretCode,
            barcode,
            serialNumber,
            deviceCode,
            clean(row.cluster),
            clean(row.building),
            clean(row.zone),
            clean(row.direction),
            "Inserted as new device from full Excel",
          ]
        );

        inserted++;

        console.log(
          `[${n}/${rows.length}] INSERTED | Device ID: ${insertedId} | IP: ${ip} | Secret: ${secretCode}`
        );
      } catch (rowError) {
        console.log("\nERROR WHILE INSERTING THIS EXCEL ROW:");
        console.table([
          {
            excelRow: row.excelRow,
            ip,
            secretCode,
            barcode,
            serialNumber,
            deviceCode,
            currentStatus: "OK",
            deviceTypeId,
            assetType,
            cluster: row.cluster,
            building: row.building,
            zone: row.zone,
            direction: row.direction,
          },
        ]);

        console.log("PostgreSQL Error:", rowError.message);
        throw rowError;
      }
    }

    await client.query("COMMIT");

    console.log("\n====================================");
    console.log("DONE SUCCESSFULLY");
    console.log("====================================");
    console.log("Reset old updated devices:", resetCount);
    console.log("Inserted full Excel devices:", inserted);
    console.log("Backup table:", backupTable);
    console.log("Log table:", importLogTable);
    console.log("No inspections deleted.");
    console.log("No tasks deleted.");
    console.log("No images deleted.");
    console.log("====================================");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    console.log("\n====================================");
    console.log("FAILED. ROLLBACK DONE.");
    console.log("مفيش أي حاجة اتحفظت من العملية دي لو حصل Error.");
    console.log("Error:", error.message);
    console.log("====================================");

    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error("Fatal:", error.message);
  process.exit(1);
});