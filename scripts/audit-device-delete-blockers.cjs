const fs = require("fs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const IDS_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\PROTECTED_641_IDS.json";

const EXPECTED_KEEP = 641;

function loadProtectedIds() {
  if (!fs.existsSync(IDS_FILE)) {
    throw new Error(`Protected IDs file not found: ${IDS_FILE}`);
  }

  const data = JSON.parse(fs.readFileSync(IDS_FILE, "utf8"));

  const ids = Array.isArray(data.protectedBackendIds)
    ? data.protectedBackendIds.map(Number).filter(Number.isFinite)
    : [];

  return [...new Set(ids)];
}

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

async function main() {
  console.log("============================================================");
  console.log(" AUDIT DEVICE DELETE BLOCKERS");
  console.log(" READ ONLY - NO DELETE / UPDATE / INSERT");
  console.log("============================================================");

  const protectedIds = loadProtectedIds();

  if (protectedIds.length !== EXPECTED_KEEP) {
    throw new Error(
      `SAFETY STOP: protected IDs must be exactly ${EXPECTED_KEEP}, found ${protectedIds.length}.`
    );
  }

  const allDevices = await prisma.device.findMany({
    where: { assetType: "DEVICE" },
    select: { id: true },
  });

  const protectedSet = new Set(protectedIds.map(Number));
  const candidateIds = allDevices
    .map((d) => Number(d.id))
    .filter((id) => !protectedSet.has(id));

  console.log("");
  console.log(`Protected KEEP DEVICE : ${protectedIds.length}`);
  console.log(`Delete candidates      : ${candidateIds.length}`);
  console.log("");

  const fks = await prisma.$queryRawUnsafe(`
    SELECT
      con.conname AS "constraintName",
      ns_child.nspname AS "childSchema",
      child.relname AS "childTable",
      att_child.attname AS "childColumn",
      ns_parent.nspname AS "parentSchema",
      parent.relname AS "parentTable",
      att_parent.attname AS "parentColumn",
      CASE con.confdeltype
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
        ELSE con.confdeltype::text
      END AS "onDelete"
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_namespace ns_child ON ns_child.oid = child.relnamespace
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace ns_parent ON ns_parent.oid = parent.relnamespace
    JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON TRUE
    JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS pk(attnum, ord) ON pk.ord = ck.ord
    JOIN pg_attribute att_child
      ON att_child.attrelid = con.conrelid AND att_child.attnum = ck.attnum
    JOIN pg_attribute att_parent
      ON att_parent.attrelid = con.confrelid AND att_parent.attnum = pk.attnum
    WHERE con.contype = 'f'
      AND parent.relname = 'Device'
      AND att_parent.attname = 'id'
    ORDER BY child.relname, con.conname
  `);

  if (!fks.length) {
    console.log("No foreign keys referencing Device.id were found.");
    return;
  }

  console.log("FOREIGN KEYS REFERENCING Device.id");
  console.log("------------------------------------------------------------");

  for (const fk of fks) {
    const schema = quoteIdent(fk.childSchema);
    const table = quoteIdent(fk.childTable);
    const column = quoteIdent(fk.childColumn);

    const candidateList = candidateIds.join(",");
    const protectedList = protectedIds.join(",");

    const candidateCountRows = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS "count"
      FROM ${schema}.${table}
      WHERE ${column} IN (${candidateList || "NULL"})
    `);

    const protectedCountRows = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS "count"
      FROM ${schema}.${table}
      WHERE ${column} IN (${protectedList || "NULL"})
    `);

    const candidateCount = Number(candidateCountRows[0]?.count || 0);
    const protectedCount = Number(protectedCountRows[0]?.count || 0);

    console.log("");
    console.log(`Table       : ${fk.childSchema}.${fk.childTable}`);
    console.log(`Column      : ${fk.childColumn}`);
    console.log(`Constraint  : ${fk.constraintName}`);
    console.log(`ON DELETE   : ${fk.onDelete}`);
    console.log(`Refs to 807 : ${candidateCount}`);
    console.log(`Refs to 641 : ${protectedCount}`);
  }

  console.log("");
  console.log("============================================================");
  console.log("READ ONLY ✅ NO DATABASE CHANGES WERE MADE");
  console.log("============================================================");
}

main()
  .catch((err) => {
    console.error("");
    console.error("❌ ERROR:", err.message || err);
    console.error("✅ NO DATABASE CHANGES WERE MADE.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
