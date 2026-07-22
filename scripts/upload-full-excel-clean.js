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
  "device_secret_update_312_log_2026_07_09_12_04_21";

function clean(value) {
  return String(value ?? "").trim();
}

function q(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "");
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");

  return `${d.getFullYear()}_${pad(d.getMonth() + 1)}_${pad(
    d.getDate()
  )}_${pad(d.getHours())}_${pad(d.getMinutes())}_${pad(d.getSeconds())}`;
}

function safeIp(ip) {
  return clean(ip).replace(/[^0-9]/g, "");
}

function makeDeviceCode(row, index, ts) {
  return `FULLQR-${row.excelRow}-${index + 1}-${safeIp(row.ip)}-${ts}`;
}

function makeSerialNumber(row, index, ts) {
  return `FULLQR-SN-${row.excelRow}-${index + 1}-${safeIp(row.ip)}-${ts}`;
}

function makeDeviceName(row) {
  return ["Excel QR Device", row.building, row.zone, row.direction, row.ip]
    .map(clean)
    .filter(Boolean)
    .join(" - ");
}

function makeLocationExcelId(row) {
  return ["AUTO", row.cluster, row.building, row.zone, row.direction]
    .map(clean)
    .filter(Boolean)
    .join("-")
    .replace(/\s+/g, "_")
    .slice(0, 180);
}

function readExcelRows() {
  if (!fs.existsSync(EXCEL_PATH)) {
    throw new Error(`Excel file not found: ${EXCEL_PATH}`);
  }

  const workbook = xlsx.readFile(EXCEL_PATH);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  const rawRows = xlsx.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false,
  });

  if (!rawRows.length) {
    throw new Error("Excel file is empty.");
  }

  const headerMap = {};

  for (const h of Object.keys(rawRows[0])) {
    headerMap[normalizeHeader(h)] = h;
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
    .filter(
      (r) =>
        r.cluster ||
        r.building ||
        r.zone ||
        r.ip ||
        r.direction ||
        r.secretCode
    );
}

function findDuplicateSecrets(rows) {
  const seen = new Set();
  const dup = new Set();

  for (const r of rows) {
    const secret = clean(r.secretCode);

    if (seen.has(secret)) {
      dup.add(secret);
    }

    seen.add(secret);
  }

  return [...dup];
}

async function getColumnEnumValues(client, tableName, columnName) {
  const res = await client.query(
    `
    SELECT e.enumlabel
    FROM information_schema.columns c
    JOIN pg_type t ON t.typname = c.udt_name
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE c.table_schema = 'public'
      AND c.table_name = $1
      AND c.column_name = $2
    ORDER BY e.enumsortorder
    `,
    [tableName, columnName]
  );

  return res.rows.map((r) => r.enumlabel);
}

function chooseEnum(values, preferred, fallback) {
  for (const p of preferred) {
    if (p && values.includes(p)) {
      return p;
    }
  }

  return values[0] || fallback;
}

async function getBestDeviceType(client) {
  const res = await client.query(`
    SELECT id, name, "assetType"::text AS "assetType"
    FROM "DeviceType"
    ORDER BY
      CASE
        WHEN upper(COALESCE("assetType"::text, '')) = 'GATE' THEN 0
        WHEN lower(COALESCE(name, '')) LIKE '%gate%' THEN 1
        WHEN lower(COALESCE(name, '')) LIKE '%turn%' THEN 2
        WHEN name LIKE '%بوابة%' THEN 3
        ELSE 9
      END,
      id
    LIMIT 1
  `);

  if (!res.rows.length) {
    throw new Error("No DeviceType found.");
  }

  return res.rows[0];
}

async function getOrCreateLocationId(client, row, locationType) {
  const cluster = clean(row.cluster);
  const building = clean(row.building);
  const zone = clean(row.zone);
  const direction = clean(row.direction);
  const excelId = makeLocationExcelId(row);

  const existingByExcelId = await client.query(
    `
    SELECT id
    FROM "Location"
    WHERE "excelId" = $1
    ORDER BY id
    LIMIT 1
    `,
    [excelId]
  );

  if (existingByExcelId.rows.length) {
    return existingByExcelId.rows[0].id;
  }

  const existingByData = await client.query(
    `
    SELECT id
    FROM "Location"
    WHERE COALESCE(cluster, '') = $1
      AND COALESCE(building, '') = $2
      AND COALESCE(zone, '') = $3
      AND COALESCE(direction, '') = $4
    ORDER BY id
    LIMIT 1
    `,
    [cluster, building, zone, direction]
  );

  if (existingByData.rows.length) {
    return existingByData.rows[0].id;
  }

  const inserted = await client.query(
    `
    INSERT INTO "Location"
    (
      "excelId",
      cluster,
      building,
      zone,
      direction,
      type,
      "createdAt",
      "updatedAt"
    )
    VALUES
    ($1,$2,$3,$4,$5,$6,NOW(),NOW())
    RETURNING id
    `,
    [
      excelId,
      cluster,
      building,
      zone,
      direction,
      locationType,
    ]
  );

  return inserted.rows[0].id;
}

async function main() {
  console.log("====================================");
  console.log("UPLOAD FULL EXCEL CLEAN");
  console.log("====================================");
  console.log("Mode:", SHOULD_RUN ? "REAL RUN" : "DRY RUN ONLY");
  console.log("Excel:", EXCEL_PATH);
  console.log("====================================");

  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    throw new Error("DATABASE_URL is missing.");
  }

  const rows = readExcelRows();

  console.log("Excel rows found:", rows.length);

  const badRows = rows.filter((r) => !r.ip || !r.secretCode);

  if (badRows.length) {
    console.log("Rows with missing IP or secret:");
    console.table(badRows);
    throw new Error("Stopped because some rows have missing IP or secret.");
  }

  const duplicateSecrets = findDuplicateSecrets(rows);

  if (duplicateSecrets.length) {
    console.log("Duplicate Secret Codes inside Excel:");
    console.table(duplicateSecrets.map((secretCode) => ({ secretCode })));
    throw new Error("Stopped because Excel has duplicate secrets.");
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

    const deviceStatusValues = await getColumnEnumValues(
      client,
      "Device",
      "currentStatus"
    );

    const currentStatus = chooseEnum(deviceStatusValues, ["OK"], "OK");

    const lifecycleValues = await getColumnEnumValues(
      client,
      "Device",
      "lifecycleStatus"
    );

    const lifecycleStatus = chooseEnum(
      lifecycleValues,
      ["ACTIVE", "OK", "IN_USE"],
      "ACTIVE"
    );

    const assetTypeValues = await getColumnEnumValues(
      client,
      "Device",
      "assetType"
    );

    const assetType = chooseEnum(
      assetTypeValues,
      ["GATE", clean(deviceType.assetType), "DEVICE"],
      clean(deviceType.assetType) || "DEVICE"
    );

    const locationTypeValues = await getColumnEnumValues(
      client,
      "Location",
      "type"
    );

    const locationType = chooseEnum(
      locationTypeValues,
      ["GATE", assetType, "DEVICE"],
      assetType
    );

    console.log("DeviceType:", deviceType);
    console.log("deviceTypeId:", deviceTypeId);
    console.log("assetType:", assetType);
    console.log("currentStatus:", currentStatus);
    console.log("lifecycleStatus:", lifecycleStatus);
    console.log("locationType:", locationType);

    const logExists = await client.query(`SELECT to_regclass($1) AS exists`, [
      `public.${OLD_UPDATE_LOG_TABLE}`,
    ]);

    const hasOldLog = Boolean(logExists.rows[0].exists);

    if (hasOldLog) {
      const countRes = await client.query(`
        SELECT COUNT(*)::int AS count
        FROM ${q(OLD_UPDATE_LOG_TABLE)}
        WHERE action = 'READY_UPDATE'
      `);

      console.log("Old updated rows to reset:", countRes.rows[0].count);
    } else {
      console.log("Old update log not found. Reset step will be skipped.");
    }

    if (!SHOULD_RUN) {
      console.log("\n====================================");
      console.log("DRY RUN ONLY");
      console.log("لو تمام شغلي نفس الأمر مع --run");
      console.log("====================================");
      await client.end();
      return;
    }

    await client.query("BEGIN");

    const backupTable = `backup_Device_before_full_excel_upload_${ts}`;
    const importLogTable = `full_excel_upload_log_${ts}`;

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
        location_id INTEGER,
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

    if (hasOldLog) {
      console.log("\nSTEP 1: Reset old updated devices...");

      const oldUpdates = await client.query(`
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

      for (const r of oldUpdates.rows) {
        await client.query(
          `
          UPDATE "Device"
          SET "secretCode" = $1,
              "updatedAt" = NOW()
          WHERE id = $2
          `,
          [r.old_secret, r.device_id]
        );

        resetCount++;

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
            r.excel_row,
            r.device_id,
            r.ip,
            r.old_secret,
            r.new_secret,
            r.cluster,
            r.building,
            r.zone,
            r.direction,
            "Restored old secretCode before full Excel upload",
          ]
        );

        console.log(
          `[RESET ${resetCount}/${oldUpdates.rows.length}] Device ID: ${r.device_id} | IP: ${r.ip}`
        );
      }

      console.log("Reset done:", resetCount);
    }

    console.log("\nSTEP 2: Check new secrets are free...");

    const existingSecrets = await client.query(
      `
      SELECT id, "ipAddress", "secretCode"
      FROM "Device"
      WHERE "secretCode" = ANY($1)
      `,
      [rows.map((r) => r.secretCode)]
    );

    if (existingSecrets.rows.length) {
      console.log("These secrets already exist:");
      console.table(existingSecrets.rows.slice(0, 50));
      throw new Error("Some Excel secrets already exist in Device after reset.");
    }

    console.log("OK. No Excel secret exists now.");

    console.log("\nSTEP 3: Insert full Excel...");

    let inserted = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const n = String(i + 1).padStart(3, "0");

      try {
        const locationId = await getOrCreateLocationId(
          client,
          row,
          locationType
        );

        const ip = clean(row.ip);
        const secretCode = clean(row.secretCode);
        const barcode = secretCode;
        const deviceCode = makeDeviceCode(row, i, ts);
        const serialNumber = makeSerialNumber(row, i, ts);
        const deviceName =
          makeDeviceName(row) || `Excel QR Device ${row.excelRow}`;

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
            "locationId",
            "ipAddress",
            "secretCode",
            "assetType",
            "gateCluster",
            "gateBuilding",
            "gateZone",
            "gateDirection",
            "lifecycleStatus",
            "notes",
            "createdAt",
            "updatedAt"
          )
          VALUES
          (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
            $11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW()
          )
          RETURNING id
          `,
          [
            deviceCode,
            deviceName,
            barcode,
            serialNumber,
            "Unknown",
            "Unknown",
            currentStatus,
            deviceTypeId,
            locationId,
            ip,
            secretCode,
            assetType,
            clean(row.cluster),
            clean(row.building),
            clean(row.zone),
            clean(row.direction),
            lifecycleStatus,
            `Inserted from full Excel upload. Excel row: ${row.excelRow}`,
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
            location_id,
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
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          `,
          [
            "INSERT_FULL_EXCEL_DEVICE",
            row.excelRow,
            insertedId,
            locationId,
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
          `[${n}/${rows.length}] INSERTED | Device ID: ${insertedId} | Location ID: ${locationId} | IP: ${ip} | Secret: ${secretCode}`
        );
      } catch (rowError) {
        console.log("\nERROR WHILE INSERTING THIS EXCEL ROW:");
        console.table([
          {
            excelRow: row.excelRow,
            ip: row.ip,
            secretCode: row.secretCode,
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