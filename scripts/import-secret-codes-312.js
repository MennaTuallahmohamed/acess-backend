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

function logLine(index, total, status, row, extra = "") {
  const num = String(index).padStart(3, "0");
  console.log(
    `[${num}/${total}] ${status} | Excel Row: ${row.excelRow} | IP: ${row.ip} | Secret: ${row.secrt}${extra ? " | " + extra : ""}`
  );
}

function findDuplicates(values) {
  const seen = new Set();
  const dup = new Set();

  for (const value of values) {
    if (seen.has(value)) dup.add(value);
    seen.add(value);
  }

  return [...dup];
}

function readExcelRows() {
  if (!fs.existsSync(filePath)) {
    throw new Error(`ملف الإكسيل مش موجود: ${filePath}`);
  }

  const wb = xlsx.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  const rawRows = xlsx.utils.sheet_to_json(ws, {
    defval: "",
    raw: false,
  });

  if (!rawRows.length) {
    throw new Error("ملف الإكسيل فاضي.");
  }

  const headerMap = {};
  for (const header of Object.keys(rawRows[0])) {
    headerMap[normalizeHeader(header)] = header;
  }

  const required = ["cluster", "building", "zone", "ip", "direction", "secrt"];
  const missing = required.filter((h) => !headerMap[h]);

  if (missing.length) {
    throw new Error(`أعمدة ناقصة في الإكسيل: ${missing.join(", ")}`);
  }

  const rows = rawRows
    .map((r, index) => ({
      excelRow: index + 2,
      cluster: clean(r[headerMap.cluster]),
      building: clean(r[headerMap.building]),
      zone: clean(r[headerMap.zone]),
      ip: clean(r[headerMap.ip]),
      direction: clean(r[headerMap.direction]).toUpperCase(),
      secrt: clean(r[headerMap.secrt]),
    }))
    .filter(
      (r) => r.cluster || r.building || r.zone || r.ip || r.direction || r.secrt
    );

  return rows;
}

async function findSecretTable(client) {
  if (process.env.SECRET_TABLE) {
    return process.env.SECRET_TABLE;
  }

  const res = await client.query(`
    SELECT table_name, array_agg(lower(column_name)) AS cols
    FROM information_schema.columns
    WHERE table_schema = 'public'
    GROUP BY table_name
  `);

  const candidates = res.rows.filter((row) => {
    const cols = row.cols;

    const hasCluster = cols.includes("cluster");
    const hasBuilding = cols.includes("building");
    const hasZone = cols.includes("zone");
    const hasDirection = cols.includes("direction");

    const hasIp =
      cols.includes("ip") ||
      cols.includes("ipaddress") ||
      cols.includes("ip_address");

    const hasSecret =
      cols.includes("secrt") ||
      cols.includes("secret");

    return hasCluster && hasBuilding && hasZone && hasDirection && hasIp && hasSecret;
  });

  if (candidates.length !== 1) {
    console.log("\n❌ مش قادر أحدد جدول السيكريت تلقائيًا.");
    console.log("الجداول المرشحة:");
    console.table(
      candidates.map((c) => ({
        table: c.table_name,
        columns: c.cols.join(", "),
      }))
    );

    console.log("\nاكتبي اسم الجدول يدويًا كده:");
    console.log('$env:SECRET_TABLE="اسم_الجدول"');
    console.log('node scripts/import-secret-codes-312-live.js "secret_codes_312_with_ip_unique_vs_old.xlsx"');

    process.exit(1);
  }

  return candidates[0].table_name;
}

async function getTableColumns(client, tableName) {
  const res = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    ORDER BY ordinal_position
    `,
    [tableName]
  );

  const columns = res.rows.map((r) => r.column_name);

  const map = {};
  for (const col of columns) {
    map[col.toLowerCase().replace(/_/g, "")] = col;
  }

  return map;
}

async function main() {
  console.log("======================================");
  console.log("🚀 SECRET CODES IMPORT");
  console.log("======================================");
  console.log("Excel:", filePath);
  console.log("Mode:", SHOULD_RUN ? "REAL UPLOAD" : "DRY RUN ONLY");
  console.log("======================================\n");

  const rows = readExcelRows();

  console.log(`📌 Total rows found in Excel: ${rows.length}`);

  if (rows.length !== 312) {
    throw new Error(`العدد لازم يكون 312، لكن الموجود: ${rows.length}`);
  }

  const emptyRows = rows.filter(
    (r) => !r.cluster || !r.building || !r.zone || !r.ip || !r.direction || !r.secrt
  );

  if (emptyRows.length) {
    console.log("\n❌ صفوف ناقصة بيانات:");
    console.table(emptyRows);
    throw new Error("الرفع اتوقف بسبب صفوف ناقصة.");
  }

  const duplicateSecrets = findDuplicates(rows.map((r) => r.secrt));

  if (duplicateSecrets.length) {
    console.log("\n❌ Secret Codes مكررة داخل الإكسيل:");
    console.table(duplicateSecrets.map((secrt) => ({ secrt })));
    throw new Error("الرفع اتوقف بسبب Secret مكرر داخل الإكسيل.");
  }

  const duplicateIps = findDuplicates(rows.map((r) => r.ip));

  if (duplicateIps.length) {
    console.log("\n⚠️ تنبيه: فيه IPs مكررة داخل الإكسيل، بس هنكمل لأن السيكريت مختلف:");
    console.table(duplicateIps.map((ip) => ({ ip })));
  }

  console.log("\n✅ Excel validation passed.");
  console.log("✅ Secret Codes inside Excel are unique.\n");

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
    const tableName = await findSecretTable(client);
    const cols = await getTableColumns(client, tableName);

    const clusterCol = cols.cluster;
    const buildingCol = cols.building;
    const zoneCol = cols.zone;
    const ipCol = cols.ip || cols.ipaddress;
    const directionCol = cols.direction;
    const secretCol = cols.secrt || cols.secret;

    if (!clusterCol || !buildingCol || !zoneCol || !ipCol || !directionCol || !secretCol) {
      console.log("Detected columns:", cols);
      throw new Error("أعمدة الجدول مش مطابقة للأعمدة المطلوبة.");
    }

    console.log("✅ Target table:", tableName);
    console.log("✅ DB columns:", {
      clusterCol,
      buildingCol,
      zoneCol,
      ipCol,
      directionCol,
      secretCol,
    });

    console.log("\n🔎 Checking if any new Secret already exists in database...\n");

    const existingSecrets = await client.query(
      `
      SELECT ${q(secretCol)} AS secrt
      FROM ${q(tableName)}
      WHERE ${q(secretCol)} = ANY($1)
      `,
      [rows.map((r) => r.secrt)]
    );

    if (existingSecrets.rows.length) {
      console.log("\n❌ فيه Secret Codes موجودة بالفعل في الداتابيز:");
      console.table(existingSecrets.rows);
      throw new Error("الرفع اتوقف. فيه سيكريتات موجودة بالفعل.");
    }

    console.log("✅ No duplicated Secret Codes found in database.");

    console.log("\n🔎 Preview rows that will be uploaded:\n");

    rows.forEach((row, index) => {
      logLine(index + 1, rows.length, "READY", row);
    });

    if (!SHOULD_RUN) {
      console.log("\n======================================");
      console.log("🧪 DRY RUN FINISHED");
      console.log("مفيش أي حاجة اترفعت.");
      console.log("لو كل اللي فوق تمام، شغلي نفس الأمر مع --run");
      console.log("======================================");
      await client.end();
      return;
    }

    console.log("\n======================================");
    console.log("🚨 REAL UPLOAD STARTED");
    console.log("======================================\n");

    await client.query("BEGIN");

    const backupTable = `backup_${tableName}_before_import_312_${Date.now()}`;

    await client.query(`
      CREATE TABLE ${q(backupTable)} AS
      TABLE ${q(tableName)}
    `);

    console.log("✅ Backup table created inside DB:", backupTable);

    const logTable = `secret_import_312_log_${Date.now()}`;

    await client.query(`
      CREATE TABLE ${q(logTable)} (
        id SERIAL PRIMARY KEY,
        action TEXT,
        excel_row INTEGER,
        cluster TEXT,
        building TEXT,
        zone TEXT,
        ip TEXT,
        direction TEXT,
        secrt TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log("✅ Import log table created:", logTable);
    console.log("\n⬆️ Uploading rows now...\n");

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      try {
        await client.query(
          `
          INSERT INTO ${q(tableName)}
          (${q(clusterCol)}, ${q(buildingCol)}, ${q(zoneCol)}, ${q(ipCol)}, ${q(directionCol)}, ${q(secretCol)})
          VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [row.cluster, row.building, row.zone, row.ip, row.direction, row.secrt]
        );

        await client.query(
          `
          INSERT INTO ${q(logTable)}
          (action, excel_row, cluster, building, zone, ip, direction, secrt)
          VALUES ('INSERT', $1, $2, $3, $4, $5, $6, $7)
          `,
          [row.excelRow, row.cluster, row.building, row.zone, row.ip, row.direction, row.secrt]
        );

        logLine(i + 1, rows.length, "INSERTED", row);
      } catch (rowError) {
        console.log("\n❌ ERROR WHILE INSERTING THIS ROW:");
        console.table([row]);
        console.log("PostgreSQL Error:", rowError.message);
        throw rowError;
      }
    }

    await client.query("COMMIT");

    console.log("\n======================================");
    console.log("🎉 UPLOAD DONE SUCCESSFULLY");
    console.log("======================================");
    console.log("Inserted:", rows.length);
    console.log("No delete happened.");
    console.log("No update happened.");
    console.log("Old data preserved.");
    console.log("Backup table:", backupTable);
    console.log("Import log table:", logTable);
    console.log("======================================");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    console.log("\n======================================");
    console.log("❌ UPLOAD FAILED");
    console.log("======================================");
    console.log("العملية اتلغت بالكامل.");
    console.log("مفيش أي حاجة اتضافت بسبب ROLLBACK.");
    console.log("Error:", error.message);
    console.log("======================================");

    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error("❌", error.message);
  process.exit(1);
});