const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const { Client } = require("pg");
require("dotenv").config();

function q(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}_${pad(d.getMonth() + 1)}_${pad(d.getDate())}_${pad(d.getHours())}_${pad(d.getMinutes())}_${pad(d.getSeconds())}`;
}

async function findSecretTable(client) {
  if (process.env.SECRET_TABLE) return process.env.SECRET_TABLE;

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
    console.log("❌ مش قادر أحدد جدول السيكريت تلقائيًا.");
    console.log("الجداول المرشحة:");
    console.table(
      candidates.map((c) => ({
        table: c.table_name,
        columns: c.cols.join(", "),
      }))
    );

    console.log("\nلو عارفة اسم الجدول، شغلي كده:");
    console.log('$env:SECRET_TABLE="اسم_جدول_السيكريت"');
    console.log("node scripts/backup-old-secrets.js");

    process.exit(1);
  }

  return candidates[0].table_name;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    throw new Error("DATABASE_URL مش موجود في الترمينال.");
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: dbUrl.includes("proxy.rlwy.net") ? { rejectUnauthorized: false } : false,
  });

  await client.connect();

  try {
    const tableName = await findSecretTable(client);
    const ts = timestamp();

    const backupTable = `backup_${tableName}_old_before_312_${ts}`;

    console.log("==================================");
    console.log("OLD SECRET BACKUP");
    console.log("==================================");
    console.log("Target table:", tableName);

    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE ${q(backupTable)} AS
      TABLE ${q(tableName)}
    `);

    const countRes = await client.query(`SELECT COUNT(*)::int AS count FROM ${q(tableName)}`);
    const count = countRes.rows[0].count;

    const dataRes = await client.query(`SELECT * FROM ${q(tableName)} ORDER BY 1`);

    await client.query("COMMIT");

    console.log("✅ Backup table created inside DB:", backupTable);
    console.log("✅ Old rows copied:", count);

    const backupsDir = path.join(process.cwd(), "backups");
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir);

    const excelPath = path.join(backupsDir, `old_${tableName}_backup_${ts}.xlsx`);

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(dataRes.rows);
    xlsx.utils.book_append_sheet(wb, ws, "Old_Secrets_Backup");
    xlsx.writeFile(wb, excelPath);

    console.log("✅ Excel backup saved:", excelPath);
    console.log("==================================");
    console.log("مفيش أي حاجة اتمسحت.");
    console.log("مفيش أي حاجة اتعدلت.");
    console.log("ده Backup فقط.");
    console.log("==================================");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("❌ Backup failed:");
    console.error(err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});