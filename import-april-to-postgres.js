const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { Pool } = require("pg");
require("dotenv").config({
  path: path.join(__dirname, ".env.import"),
});

/* =========================================================
   SETTINGS
========================================================= */

const DATABASE_URL = process.env.DATABASE_URL;

const EXCEL_FILE =
  process.env.INSPECTIONS_FILE ||
  "C:\\backend\\April_2026_Completed_Inspections_All_Devices.xlsx";

const SHEET_NAME =
  process.env.INSPECTIONS_SHEET || "Inspection_Import";

const TABLE_NAME = "april_2026_inspections_import";

const RESULT_FILE = path.join(
  __dirname,
  "april-postgresql-import-result.json"
);

const ERRORS_FILE = path.join(
  __dirname,
  "april-postgresql-import-errors.json"
);

/* =========================================================
   VALIDATION
========================================================= */

if (!DATABASE_URL) {
  console.error(`
DATABASE_URL is missing.

Create this file:

C:\\backend\\.env.import

Then add:

DATABASE_URL=YOUR_RAILWAY_POSTGRESQL_URL
INSPECTIONS_FILE=C:\\backend\\April_2026_Completed_Inspections_All_Devices.xlsx
`);

  process.exit(1);
}

if (!fs.existsSync(EXCEL_FILE)) {
  console.error(`Excel file was not found:\n${EXCEL_FILE}`);
  process.exit(1);
}

/* =========================================================
   POSTGRES CONNECTION
========================================================= */

const pool = new Pool({
  connectionString: DATABASE_URL,

  // Railway PostgreSQL normally requires SSL.
  ssl: {
    rejectUnauthorized: false,
  },

  max: 5,
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
});

/* =========================================================
   HELPERS
========================================================= */

function separator(character = "=", length = 68) {
  console.log(character.repeat(length));
}

function text(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const result = String(value).trim();

  return result === "" ? null : result;
}

function integer(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? Math.trunc(parsed)
    : null;
}

function booleanValue(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  return [
    "yes",
    "true",
    "1",
    "نعم",
    "تمام",
    "ok",
    "سليم",
  ].includes(normalized);
}

function dateOnly(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);

    if (!parsed) {
      return null;
    }

    const year = String(parsed.y).padStart(4, "0");
    const month = String(parsed.m).padStart(2, "0");
    const day = String(parsed.d).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate.toISOString().slice(0, 10);
}

function dateTime(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);

    if (!parsed) {
      return null;
    }

    return new Date(
      Date.UTC(
        parsed.y,
        parsed.m - 1,
        parsed.d,
        parsed.H || 0,
        parsed.M || 0,
        Math.floor(parsed.S || 0)
      )
    );
  }

  const parsedDate = new Date(value);

  return Number.isNaN(parsedDate.getTime())
    ? null
    : parsedDate;
}

function timeValue(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [
      String(value.getHours()).padStart(2, "0"),
      String(value.getMinutes()).padStart(2, "0"),
      String(value.getSeconds()).padStart(2, "0"),
    ].join(":");
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);

    if (!parsed) {
      return null;
    }

    return [
      String(parsed.H || 0).padStart(2, "0"),
      String(parsed.M || 0).padStart(2, "0"),
      String(Math.floor(parsed.S || 0)).padStart(2, "0"),
    ].join(":");
  }

  const normalized = String(value).trim();

  const match = normalized.match(
    /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/
  );

  if (!match) {
    return normalized || null;
  }

  return [
    String(match[1]).padStart(2, "0"),
    match[2],
    match[3] || "00",
  ].join(":");
}

function jsonSafeRow(row) {
  const result = {};

  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      result[key] = value.toISOString();
    } else {
      result[key] = value;
    }
  }

  return result;
}

function normalizeRow(row, excelIndex) {
  return {
    inspection_id:
      text(row["Inspection ID"]) ||
      `APR26-INSP-${String(excelIndex).padStart(6, "0")}`,

    device_name:
      text(row["Device Name"]) ||
      text(row["Device"]),

    device_id:
      text(row["Device ID"]),

    device_code:
      text(row["Device Code"]),

    barcode:
      text(row["Barcode"]),

    serial_number:
      text(row["Serial Number"]),

    ip_address:
      text(row["IP Address"]),

    firmware:
      text(row["Firmware"]),

    device_type:
      text(row["Device Type"]),

    asset_type:
      text(row["Asset Type"]),

    device_ok:
      booleanValue(row["هل الجهاز تمام؟"]),

    result_detail:
      text(row["تفصيل النتيجة"]),

    status:
      text(row["Status"]) || "OK",

    before_status:
      text(row["قبل الحل"]),

    after_status:
      text(row["بعد الحل / الحالي"]),

    issue_reason:
      text(row["Issue Reason"]),

    notes:
      text(row["Notes"]),

    inspection_date:
      dateOnly(row["التاريخ"]),

    inspection_time:
      timeValue(row["الساعة"]),

    inspection_at:
      dateTime(
        row["Inspection DateTime"] ||
        row["Completed At"] ||
        row["Last Inspection At"]
      ),

    technician_id:
      text(row["Technician ID"]),

    technician_name:
      text(row["الاسم"]),

    username:
      text(row["Username"]),

    email:
      text(row["Email"]),

    current_status:
      text(row["Current Status"]),

    lifecycle_status:
      text(row["Lifecycle Status"]),

    location_id:
      text(row["Location ID"]),

    location_text:
      text(row["Location Text"]),

    gps:
      text(row["GPS"]),

    cluster:
      text(row["Cluster"]),

    building:
      text(row["Building"]),

    zone:
      text(row["Zone"]),

    lane:
      text(row["Lane"]),

    direction:
      text(row["Direction"]),

    excel_id:
      text(row["Excel ID"]),

    task_id:
      text(row["Task ID"]),

    task_title:
      text(row["Task Title"]),

    task_status:
      text(row["Task Status"]),

    priority:
      text(row["Priority"]),

    scheduled_date:
      dateOnly(row["Scheduled Date"]),

    due_date:
      dateTime(row["Due Date"]),

    started_at:
      dateTime(row["Started At"]),

    completed_at:
      dateTime(row["Completed At"]),

    scanned_code:
      text(row["Scanned Code"]),

    completion_note:
      text(row["Completion Note"]),

    completed_gps:
      text(row["Completed GPS"]),

    completed_location_text:
      text(row["Completed Location Text"]),

    source_row:
      integer(row["Source Row"]) || excelIndex + 2,

    raw_data: jsonSafeRow(row),
  };
}

/* =========================================================
   CREATE TABLE
========================================================= */

async function createTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id BIGSERIAL PRIMARY KEY,

      inspection_id TEXT NOT NULL UNIQUE,

      device_name TEXT,
      device_id TEXT,
      device_code TEXT,
      barcode TEXT,
      serial_number TEXT,
      ip_address TEXT,
      firmware TEXT,
      device_type TEXT,
      asset_type TEXT,

      device_ok BOOLEAN NOT NULL DEFAULT TRUE,
      result_detail TEXT,
      status TEXT NOT NULL DEFAULT 'OK',
      before_status TEXT,
      after_status TEXT,
      issue_reason TEXT,
      notes TEXT,

      inspection_date DATE,
      inspection_time TIME,
      inspection_at TIMESTAMPTZ,

      technician_id TEXT,
      technician_name TEXT,
      username TEXT,
      email TEXT,

      current_status TEXT,
      lifecycle_status TEXT,

      location_id TEXT,
      location_text TEXT,
      gps TEXT,
      cluster TEXT,
      building TEXT,
      zone TEXT,
      lane TEXT,
      direction TEXT,
      excel_id TEXT,

      task_id TEXT,
      task_title TEXT,
      task_status TEXT,
      priority TEXT,
      scheduled_date DATE,
      due_date TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,

      scanned_code TEXT,
      completion_note TEXT,
      completed_gps TEXT,
      completed_location_text TEXT,

      source_row INTEGER,
      raw_data JSONB NOT NULL,

      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_april_inspections_device_id
    ON ${TABLE_NAME}(device_id);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_april_inspections_serial
    ON ${TABLE_NAME}(serial_number);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_april_inspections_ip
    ON ${TABLE_NAME}(ip_address);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_april_inspections_completed_at
    ON ${TABLE_NAME}(completed_at);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_april_inspections_building
    ON ${TABLE_NAME}(building);
  `);
}

/* =========================================================
   INSERT OR UPDATE
========================================================= */

async function upsertInspection(client, row) {
  const columns = Object.keys(row);

  const values = columns.map((column) => {
    if (column === "raw_data") {
      return JSON.stringify(row[column]);
    }

    return row[column];
  });

  const placeholders = columns.map(
    (_, index) => `$${index + 1}`
  );

  const updateColumns = columns.filter(
    (column) => column !== "inspection_id"
  );

  const updateClause = updateColumns
    .map(
      (column) =>
        `${column} = EXCLUDED.${column}`
    )
    .join(",\n");

  const sql = `
    INSERT INTO ${TABLE_NAME} (
      ${columns.join(", ")}
    )
    VALUES (
      ${placeholders.join(", ")}
    )
    ON CONFLICT (inspection_id)
    DO UPDATE SET
      ${updateClause},
      updated_at = NOW()
    RETURNING
      id,
      inspection_id,
      (xmax = 0) AS was_inserted;
  `;

  const result = await client.query(sql, values);

  return result.rows[0];
}

/* =========================================================
   MAIN IMPORT
========================================================= */

async function runImport() {
  const absoluteFilePath = path.resolve(EXCEL_FILE);

  separator();
  console.log("APRIL 2026 POSTGRESQL IMPORT");
  separator();

  console.log(`Excel file : ${absoluteFilePath}`);
  console.log(`Sheet      : ${SHEET_NAME}`);
  console.log(`Table      : ${TABLE_NAME}`);
  console.log("Database   : Railway PostgreSQL");
  separator("-");

  const workbook = XLSX.readFile(absoluteFilePath, {
    cellDates: true,
    raw: true,
  });

  const sheet = workbook.Sheets[SHEET_NAME];

  if (!sheet) {
    throw new Error(
      `Sheet "${SHEET_NAME}" was not found.\n` +
      `Available sheets: ${workbook.SheetNames.join(", ")}`
    );
  }

  const excelRows = XLSX.utils.sheet_to_json(sheet, {
    defval: null,
    raw: true,
  });

  if (!excelRows.length) {
    throw new Error("No inspection rows were found in the Excel file.");
  }

  console.log(`Excel rows : ${excelRows.length}`);
  console.log("");
  console.log("Connecting to PostgreSQL...");

  const client = await pool.connect();

  const statistics = {
    totalExcelRows: excelRows.length,
    inserted: 0,
    updated: 0,
    failed: 0,
    processed: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    tableName: TABLE_NAME,
  };

  const errors = [];

  try {
    const databaseInfo = await client.query(`
      SELECT
        current_database() AS database_name,
        current_user AS database_user,
        version() AS postgres_version;
    `);

    console.log(
      `Connected to database: ${databaseInfo.rows[0].database_name}`
    );

    console.log(
      `Connected as user    : ${databaseInfo.rows[0].database_user}`
    );

    console.log("");
    console.log("Creating import table and indexes...");

    await createTable(client);

    console.log("Table is ready.");
    console.log("");
    console.log("Starting upload...");
    console.log("");

    for (let index = 0; index < excelRows.length; index++) {
      const excelRow = excelRows[index];

      try {
        const normalized = normalizeRow(
          excelRow,
          index + 1
        );

        if (!normalized.inspection_id) {
          throw new Error("Inspection ID is missing.");
        }

        const result = await upsertInspection(
          client,
          normalized
        );

        if (result.was_inserted === true) {
          statistics.inserted++;
        } else {
          statistics.updated++;
        }
      } catch (error) {
        statistics.failed++;

        errors.push({
          excelRow: index + 2,
          inspectionId:
            text(excelRow["Inspection ID"]) || null,
          deviceId:
            text(excelRow["Device ID"]) || null,
          serialNumber:
            text(excelRow["Serial Number"]) || null,
          error: error.message,
        });
      }

      statistics.processed++;

      if (
        statistics.processed % 50 === 0 ||
        statistics.processed === excelRows.length
      ) {
        console.log(
          [
            `Processed: ${statistics.processed}/${excelRows.length}`,
            `Inserted: ${statistics.inserted}`,
            `Updated: ${statistics.updated}`,
            `Failed: ${statistics.failed}`,
          ].join(" | ")
        );
      }
    }

    statistics.finishedAt = new Date().toISOString();
    statistics.successful =
      statistics.inserted + statistics.updated;
    statistics.notUploaded = statistics.failed;

    const databaseCountResult = await client.query(`
      SELECT COUNT(*)::INTEGER AS total
      FROM ${TABLE_NAME};
    `);

    statistics.totalRowsNowInDatabase =
      databaseCountResult.rows[0].total;

    fs.writeFileSync(
      RESULT_FILE,
      JSON.stringify(statistics, null, 2),
      "utf8"
    );

    fs.writeFileSync(
      ERRORS_FILE,
      JSON.stringify(errors, null, 2),
      "utf8"
    );

    console.log("");
    separator();
    console.log("POSTGRESQL IMPORT COMPLETED");
    separator();

    console.log(
      `Total Excel rows         : ${statistics.totalExcelRows}`
    );

    console.log(
      `Uploaded successfully    : ${statistics.successful}`
    );

    console.log(
      `New rows inserted        : ${statistics.inserted}`
    );

    console.log(
      `Existing rows updated    : ${statistics.updated}`
    );

    console.log(
      `Failed / not uploaded    : ${statistics.failed}`
    );

    console.log(
      `Total rows in DB table   : ${statistics.totalRowsNowInDatabase}`
    );

    separator("-");

    console.log(`Result file:`);
    console.log(RESULT_FILE);

    console.log("");
    console.log(`Errors file:`);
    console.log(ERRORS_FILE);

    if (errors.length > 0) {
      console.log("");
      console.log("FIRST ERRORS:");

      errors.slice(0, 20).forEach((error, index) => {
        console.log(
          `${index + 1}. Excel row ${error.excelRow}: ${error.error}`
        );
      });
    }

    separator();
  } finally {
    client.release();
  }
}

/* =========================================================
   START
========================================================= */

runImport()
  .then(async () => {
    await pool.end();

    console.log("");
    console.log("Upload process finished successfully.");
  })
  .catch(async (error) => {
    console.log("");
    separator();
    console.error("IMPORT FAILED");
    separator();

    console.error(error.message);

    if (error.code) {
      console.error(`PostgreSQL error code: ${error.code}`);
    }

    console.error(`
Check:

1. C:\\backend\\.env.import exists.
2. DATABASE_URL is correct.
3. The Railway database is running.
4. The Excel file exists.
5. Your network allows connecting to Railway PostgreSQL.
`);

    await pool.end().catch(() => {});
    process.exit(1);
  });