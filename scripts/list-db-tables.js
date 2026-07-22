const { Client } = require("pg");
require("dotenv").config();

async function main() {
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    console.log("DATABASE_URL مش موجود");
    process.exit(1);
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: dbUrl.includes("proxy.rlwy.net")
      ? { rejectUnauthorized: false }
      : false,
  });

  await client.connect();

  const res = await client.query(`
    SELECT
      table_name,
      string_agg(column_name, ', ' ORDER BY ordinal_position) AS columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
    GROUP BY table_name
    ORDER BY table_name;
  `);

  console.table(
    res.rows.map((r) => ({
      table: r.table_name,
      columns: r.columns,
    }))
  );

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});