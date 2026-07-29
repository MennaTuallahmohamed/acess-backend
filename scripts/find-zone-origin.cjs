/*
  SMART IT — READ-ONLY DEVICE / ZONE ORIGIN FINDER

  Run from C:\backend after copying this file to:
    C:\backend\scripts\find-zone-origin.cjs

  Command:
    node scripts\find-zone-origin.cjs

  This script performs SELECT queries only. It does not update or delete data.
*/

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: ['error'],
});

const TARGETS = [
  { label: 'IP', value: '10.254.198.136' },
  { label: 'Secret / Barcode', value: 'ACD-V1-E586-60B6-5FA2-13A5' },
  {
    label: 'Device name',
    value: 'FULLQR-148-147-10254198136-2026_07_09_13_11_59',
  },
  {
    label: 'Serial',
    value: 'FULLQR-SN-148-147-10254198136-2026_07_09_13_11_59',
  },
  { label: 'Zone compact', value: 'zon11right' },
  { label: 'Zone normal', value: 'zone11right' },
  { label: 'Building Arabic 1', value: 'وزارة الإعلام' },
  { label: 'Building Arabic 2', value: 'وزاره الاعلم' },
];

const TARGET_ID = 1852;

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function shortJson(value, maxLength = 4000) {
  const text = JSON.stringify(value, null, 2);
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...TRUNCATED...` : text;
}

async function listSearchableColumns() {
  return prisma.$queryRawUnsafe(`
    SELECT
      c.table_schema,
      c.table_name,
      c.column_name,
      c.data_type,
      c.udt_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND (
        c.data_type IN ('text', 'character varying', 'character')
        OR c.udt_name IN ('citext', 'inet')
      )
    ORDER BY c.table_name, c.ordinal_position
  `);
}

async function listIdColumns() {
  return prisma.$queryRawUnsafe(`
    SELECT
      c.table_schema,
      c.table_name,
      c.column_name,
      c.data_type,
      c.udt_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND lower(c.column_name) = 'id'
      AND (
        c.data_type IN ('smallint', 'integer', 'bigint', 'numeric', 'decimal')
        OR c.udt_name IN ('int2', 'int4', 'int8', 'numeric')
      )
    ORDER BY c.table_name
  `);
}

async function searchTextColumns(columns) {
  const hits = [];
  const patterns = TARGETS.map((item) => `%${item.value.toLowerCase()}%`);
  const conditions = patterns
    .map((_, index) => `LOWER(CAST(t.__COLUMN__ AS text)) LIKE $${index + 1}`)
    .join(' OR ');

  for (const column of columns) {
    const schema = quoteIdentifier(column.table_schema);
    const table = quoteIdentifier(column.table_name);
    const field = quoteIdentifier(column.column_name);
    const where = conditions.replaceAll('t.__COLUMN__', `t.${field}`);
    const sql = `
      SELECT to_jsonb(t) AS row_data
      FROM ${schema}.${table} AS t
      WHERE ${where}
      LIMIT 25
    `;

    try {
      const rows = await prisma.$queryRawUnsafe(sql, ...patterns);
      for (const row of rows) {
        const rowText = JSON.stringify(row.row_data || {}).toLowerCase();
        const matchedTargets = TARGETS
          .filter((target) => rowText.includes(target.value.toLowerCase()))
          .map((target) => target.label);

        hits.push({
          table: `${column.table_schema}.${column.table_name}`,
          matchedColumn: column.column_name,
          matchedTargets,
          row: row.row_data,
        });
      }
    } catch (error) {
      console.warn(
        `Skipped ${column.table_name}.${column.column_name}: ${error.message}`,
      );
    }
  }

  return hits;
}

async function searchIdAcrossTables(columns) {
  const hits = [];

  for (const column of columns) {
    const schema = quoteIdentifier(column.table_schema);
    const table = quoteIdentifier(column.table_name);
    const field = quoteIdentifier(column.column_name);
    const sql = `
      SELECT to_jsonb(t) AS row_data
      FROM ${schema}.${table} AS t
      WHERE CAST(t.${field} AS text) = $1
      LIMIT 25
    `;

    try {
      const rows = await prisma.$queryRawUnsafe(sql, String(TARGET_ID));
      for (const row of rows) {
        hits.push({
          table: `${column.table_schema}.${column.table_name}`,
          matchedColumn: column.column_name,
          row: row.row_data,
        });
      }
    } catch (error) {
      console.warn(`Skipped ID scan on ${column.table_name}: ${error.message}`);
    }
  }

  return hits;
}

async function listRelevantTables() {
  return prisma.$queryRawUnsafe(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND (
        table_name ILIKE '%device%'
        OR table_name ILIKE '%location%'
        OR table_name ILIKE '%import%'
        OR table_name ILIKE '%audit%'
        OR table_name ILIKE '%activity%'
        OR table_name ILIKE '%log%'
        OR table_name ILIKE '%replacement%'
      )
    ORDER BY table_name
  `);
}

async function listForeignKeys() {
  return prisma.$queryRawUnsafe(`
    SELECT
      tc.table_name AS source_table,
      kcu.column_name AS source_column,
      ccu.table_name AS target_table,
      ccu.column_name AS target_column,
      tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND (
        tc.table_name ILIKE '%device%'
        OR tc.table_name ILIKE '%location%'
        OR ccu.table_name ILIKE '%device%'
        OR ccu.table_name ILIKE '%location%'
      )
    ORDER BY source_table, source_column
  `);
}

async function main() {
  console.log('====================================================');
  console.log('SMART IT — DEVICE / ZONE ORIGIN INVESTIGATION');
  console.log('READ-ONLY: no rows will be changed or deleted.');
  console.log('====================================================\n');

  console.log('Targets:');
  for (const target of TARGETS) {
    console.log(`- ${target.label}: ${target.value}`);
  }
  console.log(`- Numeric ID: ${TARGET_ID}\n`);

  const [textColumns, idColumns, relevantTables, foreignKeys] =
    await Promise.all([
      listSearchableColumns(),
      listIdColumns(),
      listRelevantTables(),
      listForeignKeys(),
    ]);

  console.log('Relevant database tables:');
  console.log(shortJson(relevantTables));
  console.log('\nRelevant Device/Location foreign keys:');
  console.log(shortJson(foreignKeys, 12000));

  console.log('\nSearching all public text / varchar / inet columns...');
  const textHits = await searchTextColumns(textColumns);
  console.log(`Text hits found: ${textHits.length}`);
  console.log(shortJson(textHits, 50000));

  console.log(`\nSearching every numeric ID column for ID ${TARGET_ID}...`);
  const idHits = await searchIdAcrossTables(idColumns);
  console.log(`ID hits found: ${idHits.length}`);
  console.log(shortJson(idHits, 30000));

  console.log('\n====================================================');
  console.log('HOW TO READ THE RESULT');
  console.log('1) Find the row containing the exact IP / secret / FULLQR name.');
  console.log('2) Note its locationId, createdAt, updatedAt, createdById, or source fields.');
  console.log('3) Find the matching Location row in the output.');
  console.log('4) Compare Location.createdAt with Device.createdAt.');
  console.log('5) Import/audit/activity hits reveal which process created or changed it.');
  console.log('====================================================');
}

main()
  .catch((error) => {
    console.error('\nINVESTIGATION FAILED');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });