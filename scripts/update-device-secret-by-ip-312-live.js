const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const { Client } = require("pg");
require("dotenv").config();

const filePath =
  process.argv[2] ||
  path.join(process.cwd(), "secret_codes_312_with_ip_unique_vs_old.xlsx");

const SHOULD_RUN = process.argv.includes("--run");

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
  return `${d.getFullYear()}_${pad(d.getMonth() + 1)}_${pad(d.getDate())}_${pad(d.getHours())}_${pad(d.getMinutes())}_${pad(d.getSeconds())}`;
}

function readExcelRows() {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Excel file not found: ${filePath}`);
  }

  const wb = xlsx.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];

  const rawRows = xlsx.utils.sheet_to_json(ws, {
    defval: "",
    raw: false,
  });

  const headerMap = {};
  for (const h of Object.keys(rawRows[0] || {})) {
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
      newSecret: clean(r[headerMap.secrt]),
    }))
    .filter((r) => r.ip || r.newSecret);
}

function countBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

async function main() {
  console.log("====================================");
  console.log("DEVICE SECRET UPDATE BY IP");
  console.log("====================================");
  console.log("Mode:", SHOULD_RUN ? "REAL UPDATE" : "DRY RUN ONLY");
  console.log("Excel:", filePath);
  console.log("====================================");

  const rows = readExcelRows();

  console.log("Excel rows:", rows.length);

  if (rows.length !== 312) {
    throw new Error(`Expected 312 rows, found ${rows.length}`);
  }

  const emptyRows = rows.filter(
    (r) => !r.cluster || !r.building || !r.zone || !r.ip || !r.direction || !r.newSecret
  );

  if (emptyRows.length) {
    console.log("Rows with missing data:");
    console.table(emptyRows);
    throw new Error("Stopped because some rows have missing data.");
  }

  const secretCounts = countBy(rows, (r) => r.newSecret);
  const duplicateSecrets = [...secretCounts.entries()].filter(([, count]) => count > 1);

  if (duplicateSecrets.length) {
    console.log("Duplicate secrets inside Excel:");
    console.table(duplicateSecrets.map(([secret, count]) => ({ secret, count })));
    throw new Error("Stopped because Excel has duplicated secret codes.");
  }

  const ipCounts = countBy(rows, (r) => r.ip);
  const duplicateExcelIps = new Set(
    [...ipCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([ip]) => ip)
  );

  if (duplicateExcelIps.size) {
    console.log("⚠️ Duplicate IPs in Excel. These rows will be SKIPPED, not updated:");
    console.table([...duplicateExcelIps].map((ip) => ({ ip, count: ipCounts.get(ip) })));
  }

  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    throw new Error("DATABASE_URL is missing.");
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: dbUrl.includes("proxy.rlwy.net") ? { rejectUnauthorized: false } : false,
  });

  await client.connect();

  try {
    console.log("Checking if any new secret already exists in Device...");

    const existingSecretRes = await client.query(
      `
      SELECT id, "ipAddress", "secretCode"
      FROM "Device"
      WHERE "secretCode" = ANY($1)
      `,
      [rows.map((r) => r.newSecret)]
    );

    if (existingSecretRes.rows.length) {
      console.log("❌ Some new secrets already exist in Device:");
      console.table(existingSecretRes.rows);
      throw new Error("Stopped because some new secrets already exist in database.");
    }

    console.log("✅ No new secret exists in Device.");

    const plans = [];

    for (const row of rows) {
      if (duplicateExcelIps.has(row.ip)) {
        plans.push({
          ...row,
          action: "SKIP_DUPLICATE_IP_IN_EXCEL",
          deviceId: null,
          oldSecret: null,
          message: "Same IP appears more than once in Excel",
        });
        continue;
      }

      const deviceRes = await client.query(
        `
        SELECT id, "ipAddress", "secretCode", "deviceCode", "deviceName"
        FROM "Device"
        WHERE "ipAddress" = $1
        `,
        [row.ip]
      );

      if (deviceRes.rows.length === 0) {
        plans.push({
          ...row,
          action: "SKIP_IP_NOT_FOUND",
          deviceId: null,
          oldSecret: null,
          message: "No Device found with this IP",
        });
        continue;
      }

      if (deviceRes.rows.length > 1) {
        plans.push({
          ...row,
          action: "SKIP_DUPLICATE_IP_IN_DB",
          deviceId: null,
          oldSecret: null,
          message: "More than one Device found with this IP",
        });
        continue;
      }

      const device = deviceRes.rows[0];

      plans.push({
        ...row,
        action: "READY_UPDATE",
        deviceId: device.id,
        oldSecret: device.secretCode,
        deviceCode: device.deviceCode,
        deviceName: device.deviceName,
        message: "Ready to update secretCode only",
      });
    }

    console.log("\n====================================");
    console.log("PREVIEW");
    console.log("====================================");

    let readyCount = 0;
    let skippedCount = 0;

    plans.forEach((p, index) => {
      const n = String(index + 1).padStart(3, "0");

      if (p.action === "READY_UPDATE") readyCount++;
      else skippedCount++;

      console.log(
        `[${n}/${plans.length}] ${p.action} | Excel Row: ${p.excelRow} | IP: ${p.ip} | Old: ${p.oldSecret || "-"} | New: ${p.newSecret} | ${p.message}`
      );
    });

    console.log("====================================");
    console.log("Ready to update:", readyCount);
    console.log("Skipped:", skippedCount);
    console.log("====================================");

    if (!SHOULD_RUN) {
      console.log("\n🧪 DRY RUN ONLY. No database changes happened.");
      console.log("لو الأرقام فوق تمام، شغلي نفس الأمر مع --run");
      await client.end();
      return;
    }

    console.log("\n🚨 REAL UPDATE STARTED");

    await client.query("BEGIN");

    const ts = timestamp();

    const backupTable = `backup_Device_before_312_secret_update_${ts}`;
    const logTable = `device_secret_update_312_log_${ts}`;

    await client.query(`
      CREATE TABLE ${q(backupTable)} AS
      TABLE "Device"
    `);

    await client.query(`
      CREATE TABLE ${q(logTable)} (
        id SERIAL PRIMARY KEY,
        action TEXT,
        excel_row INTEGER,
        device_id INTEGER,
        ip TEXT,
        old_secret TEXT,
        new_secret TEXT,
        cluster TEXT,
        building TEXT,
        zone TEXT,
        direction TEXT,
        message TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log("✅ Backup table created:", backupTable);
    console.log("✅ Log table created:", logTable);

    let updated = 0;

    for (let i = 0; i < plans.length; i++) {
      const p = plans[i];
      const n = String(i + 1).padStart(3, "0");

      await client.query(
        `
        INSERT INTO ${q(logTable)}
        (action, excel_row, device_id, ip, old_secret, new_secret, cluster, building, zone, direction, message)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `,
        [
          p.action,
          p.excelRow,
          p.deviceId,
          p.ip,
          p.oldSecret,
          p.newSecret,
          p.cluster,
          p.building,
          p.zone,
          p.direction,
          p.message,
        ]
      );

      if (p.action !== "READY_UPDATE") {
        console.log(`[${n}/${plans.length}] SKIPPED | IP: ${p.ip} | ${p.action}`);
        continue;
      }

      await client.query(
        `
        UPDATE "Device"
        SET "secretCode" = $1,
            "updatedAt" = NOW()
        WHERE id = $2
        `,
        [p.newSecret, p.deviceId]
      );

      updated++;

      console.log(
        `[${n}/${plans.length}] UPDATED | Device ID: ${p.deviceId} | IP: ${p.ip} | Old: ${p.oldSecret || "-"} | New: ${p.newSecret}`
      );
    }

    await client.query("COMMIT");

    console.log("\n====================================");
    console.log("🎉 DONE SUCCESSFULLY");
    console.log("====================================");
    console.log("Updated:", updated);
    console.log("Skipped:", skippedCount);
    console.log("Backup table:", backupTable);
    console.log("Log table:", logTable);
    console.log("No delete happened.");
    console.log("Only Device.secretCode was updated.");
    console.log("====================================");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.log("\n❌ FAILED. ROLLBACK DONE. No changes saved.");
    console.log("Error:", err.message);
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});