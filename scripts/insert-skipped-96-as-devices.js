const { Client } = require("pg");
require("dotenv").config();

const SHOULD_RUN = process.argv.includes("--run");

const LOG_TABLE = "device_secret_update_312_log_2026_07_09_12_04_21";

function q(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function clean(value) {
  return String(value ?? "").trim();
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

function makeDeviceCode(row) {
  return `QRFIX-${row.excel_row}-${safeIpForCode(row.ip)}-${Date.now()}`;
}

function makeSerialNumber(row) {
  return `QRFIX-SN-${row.excel_row}-${safeIpForCode(row.ip)}`;
}

function makeDeviceName(row) {
  return [
    "QR Fixed Device",
    clean(row.building),
    clean(row.zone),
    clean(row.direction),
    clean(row.ip),
  ]
    .filter(Boolean)
    .join(" - ");
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    throw new Error("DATABASE_URL مش موجود في الترمينال.");
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: dbUrl.includes("proxy.rlwy.net")
      ? { rejectUnauthorized: false }
      : false,
  });

  await client.connect();

  try {
    console.log("====================================");
    console.log("INSERT SKIPPED 96 AS NEW DEVICES");
    console.log("====================================");
    console.log("Mode:", SHOULD_RUN ? "REAL INSERT" : "DRY RUN ONLY");
    console.log("Log table:", LOG_TABLE);
    console.log("====================================");

    const skippedRes = await client.query(`
      SELECT
        action,
        excel_row,
        ip,
        new_secret,
        cluster,
        building,
        zone,
        direction,
        message
      FROM ${q(LOG_TABLE)}
      WHERE action <> 'READY_UPDATE'
      ORDER BY excel_row
    `);

    const rows = skippedRes.rows;

    console.log("Skipped rows found:", rows.length);

    if (!rows.length) {
      throw new Error("مفيش Rows skipped في الـ log table.");
    }

    if (rows.length !== 96) {
      console.log("⚠️ تحذير: العدد مش 96. العدد الحالي:", rows.length);
    }

    const badRows = rows.filter((r) => {
      return !clean(r.new_secret) || !clean(r.ip);
    });

    if (badRows.length) {
      console.log("❌ فيه صفوف ناقصة IP أو Secret:");
      console.table(badRows);
      throw new Error("اتوقفنا بسبب صفوف ناقصة.");
    }

    const existingSecrets = await client.query(
      `
      SELECT id, "ipAddress", "secretCode"
      FROM "Device"
      WHERE "secretCode" = ANY($1)
      `,
      [rows.map((r) => clean(r.new_secret))]
    );

    const existingSecretSet = new Set(
      existingSecrets.rows.map((r) => clean(r.secretCode))
    );

    if (existingSecrets.rows.length) {
      console.log("⚠️ Secret Codes موجودة بالفعل في Device، مش هنعيد إدخالها:");
      console.table(existingSecrets.rows);
    }

    const toInsert = rows.filter((r) => {
      return !existingSecretSet.has(clean(r.new_secret));
    });

    console.log("Will insert:", toInsert.length);
    console.log("Already exists, will skip:", rows.length - toInsert.length);

    console.log("\nPreview:\n");

    toInsert.forEach((row, index) => {
      const n = String(index + 1).padStart(3, "0");

      console.log(
        `[${n}/${toInsert.length}] WILL INSERT | Excel Row: ${row.excel_row} | IP: ${row.ip} | Secret: ${row.new_secret} | Reason before: ${row.action}`
      );
    });

    if (!SHOULD_RUN) {
      console.log("\n====================================");
      console.log("DRY RUN ONLY");
      console.log("مفيش أي حاجة اتضافت.");
      console.log("لو الكلام تمام شغلي نفس الأمر مع --run");
      console.log("====================================");

      await client.end();
      return;
    }

    console.log("\n====================================");
    console.log("REAL INSERT STARTED");
    console.log("====================================");

    await client.query("BEGIN");

    const ts = timestamp();

    const backupTable = `backup_Device_before_insert_skipped_96_${ts}`;
    const insertLogTable = `insert_skipped_96_devices_log_${ts}`;

    await client.query(`
      CREATE TABLE ${q(backupTable)} AS
      TABLE "Device"
    `);

    await client.query(`
      CREATE TABLE ${q(insertLogTable)} (
        id SERIAL PRIMARY KEY,
        source_action TEXT,
        excel_row INTEGER,
        inserted_device_id INTEGER,
        ip TEXT,
        secret_code TEXT,
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

    console.log("✅ Backup table created:", backupTable);
    console.log("✅ Insert log table created:", insertLogTable);

    let inserted = 0;

    for (let i = 0; i < toInsert.length; i++) {
      const row = toInsert[i];
      const n = String(i + 1).padStart(3, "0");

      const ip = clean(row.ip);
      const secretCode = clean(row.new_secret);

      const deviceCode = makeDeviceCode(row);
      const serialNumber = makeSerialNumber(row);
      const barcode = secretCode;
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
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            $13,
            $14,
            $15,
            $16,
            NOW(),
            NOW()
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
            "OK",
            ip,
            secretCode,
            "GATE",
            clean(row.cluster),
            clean(row.building),
            clean(row.zone),
            clean(row.direction),
            "ACTIVE",
            `Inserted from skipped 312 secret import. Original skip reason: ${row.action}. Original message: ${clean(row.message)}`,
          ]
        );

        const insertedId = insertRes.rows[0].id;

        await client.query(
          `
          INSERT INTO ${q(insertLogTable)}
          (
            source_action,
            excel_row,
            inserted_device_id,
            ip,
            secret_code,
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
            clean(row.action),
            row.excel_row,
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
            clean(row.message),
          ]
        );

        inserted++;

        console.log(
          `[${n}/${toInsert.length}] INSERTED | Device ID: ${insertedId} | IP: ${ip} | Barcode: ${barcode} | Secret: ${secretCode}`
        );
      } catch (rowError) {
        console.log("\n❌ ERROR WHILE INSERTING THIS ROW:");
        console.table([
          {
            excel_row: row.excel_row,
            ip,
            secretCode,
            barcode,
            serialNumber,
            deviceCode,
            currentStatus: "OK",
            cluster: clean(row.cluster),
            building: clean(row.building),
            zone: clean(row.zone),
            direction: clean(row.direction),
            old_skip_reason: clean(row.action),
          },
        ]);

        console.log("PostgreSQL Error:", rowError.message);
        throw rowError;
      }
    }

    await client.query("COMMIT");

    console.log("\n====================================");
    console.log("🎉 DONE SUCCESSFULLY");
    console.log("====================================");
    console.log("Inserted new devices:", inserted);
    console.log("No delete happened.");
    console.log("Old devices preserved.");
    console.log("Backup table:", backupTable);
    console.log("Insert log table:", insertLogTable);
    console.log("====================================");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    console.log("\n====================================");
    console.log("❌ FAILED. ROLLBACK DONE.");
    console.log("====================================");
    console.log("مفيش أي حاجة اتحفظت لو حصل Error.");
    console.log("Error:", error.message);
    console.log("====================================");

    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error("❌", error.message);
  process.exit(1);
});