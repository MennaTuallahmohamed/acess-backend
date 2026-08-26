const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const IDS_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\PROTECTED_641_IDS.json";

const EXPECTED_KEEP = 641;

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || "").trim());
    });
  });
}

function loadKeepIds() {
  if (!fs.existsSync(IDS_FILE)) {
    throw new Error(`KEEP IDs file not found: ${IDS_FILE}`);
  }

  const data = JSON.parse(fs.readFileSync(IDS_FILE, "utf8"));
  const ids = Array.isArray(data.protectedBackendIds)
    ? data.protectedBackendIds.map(Number).filter(Number.isFinite)
    : [];

  return [...new Set(ids)];
}

function sqlIds(ids) {
  return ids.length
    ? ids.map(Number).filter(Number.isFinite).join(",")
    : "NULL";
}

function qIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function jsonReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

async function getForeignKeysToDeviceId() {
  return prisma.$queryRawUnsafe(`
    SELECT
      con.conname AS "constraintName",
      ns_child.nspname AS "childSchema",
      child.relname AS "childTable",
      att_child.attname AS "childColumn",
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
    JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON TRUE
    JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS pk(attnum, ord)
      ON pk.ord = ck.ord
    JOIN pg_attribute att_child
      ON att_child.attrelid = con.conrelid
     AND att_child.attnum = ck.attnum
    JOIN pg_attribute att_parent
      ON att_parent.attrelid = con.confrelid
     AND att_parent.attnum = pk.attnum
    WHERE con.contype = 'f'
      AND parent.relname = 'Device'
      AND att_parent.attname = 'id'
    ORDER BY ns_child.nspname, child.relname, con.conname
  `);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const keepIds = loadKeepIds();

  console.log("============================================================");
  console.log(" LEAVE ONLY THE PROTECTED 641 IN Device TABLE");
  console.log("============================================================");
  console.log(
    apply
      ? " MODE: APPLY - DELETE EVERY Device ROW OUTSIDE KEEP 641"
      : " MODE: DRY RUN - NO DATABASE CHANGES"
  );

  if (keepIds.length !== EXPECTED_KEEP) {
    throw new Error(
      `SAFETY STOP: KEEP IDs must be exactly ${EXPECTED_KEEP}, found ${keepIds.length}.`
    );
  }

  const keepRows = await prisma.device.findMany({
    where: { id: { in: keepIds } },
    select: {
      id: true,
      deviceCode: true,
      assetType: true,
      ipAddress: true,
      serialNumber: true,
    },
  });

  if (keepRows.length !== EXPECTED_KEEP) {
    throw new Error(
      `SAFETY STOP: only ${keepRows.length}/${EXPECTED_KEEP} protected rows exist in Device table.`
    );
  }

  const allRows = await prisma.device.findMany({
    select: {
      id: true,
      deviceCode: true,
      assetType: true,
      ipAddress: true,
      serialNumber: true,
      secretCode: true,
    },
    orderBy: { id: "asc" },
  });

  const keepSet = new Set(keepIds.map(Number));
  const candidates = allRows.filter((r) => !keepSet.has(Number(r.id)));
  const candidateIds = candidates.map((r) => Number(r.id));
  const candidateSql = sqlIds(candidateIds);

  const byType = {};
  for (const row of candidates) {
    const type = String(row.assetType || "NULL");
    byType[type] = (byType[type] || 0) + 1;
  }

  console.log("");
  console.log("SAFETY CHECK");
  console.log("------------------------------------------------------------");
  console.log(`Protected KEEP rows       : ${keepRows.length}`);
  console.log(`Current Device table rows : ${allRows.length}`);
  console.log(`Rows outside KEEP 641     : ${candidates.length}`);
  Object.entries(byType).forEach(([type, count]) => {
    console.log(`  ${type.padEnd(22)}: ${count}`);
  });
  console.log(`Final Device table rows   : ${allRows.length - candidates.length}`);

  if (allRows.length - candidates.length !== EXPECTED_KEEP) {
    throw new Error(
      `SAFETY STOP: result would not be exactly ${EXPECTED_KEEP} rows.`
    );
  }

  // Discover all foreign keys that point to Device.id.
  const fks = await getForeignKeysToDeviceId();

  // Group RESTRICT/NO ACTION FKs by child table so rows are deleted once per table.
  const blockerGroups = new Map();
  const automaticRefs = [];

  for (const fk of fks) {
    const schema = qIdent(fk.childSchema);
    const table = qIdent(fk.childTable);
    const column = qIdent(fk.childColumn);

    const countRows = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS "count"
      FROM ${schema}.${table}
      WHERE ${column} IN (${candidateSql})
    `);

    const count = Number(countRows[0]?.count || 0);
    if (!count) continue;

    if (fk.onDelete === "RESTRICT" || fk.onDelete === "NO ACTION") {
      const key = `${fk.childSchema}.${fk.childTable}`;
      if (!blockerGroups.has(key)) {
        blockerGroups.set(key, {
          schema: fk.childSchema,
          table: fk.childTable,
          columns: [],
        });
      }

      const group = blockerGroups.get(key);
      if (!group.columns.includes(fk.childColumn)) {
        group.columns.push(fk.childColumn);
      }
    } else {
      automaticRefs.push({
        table: `${fk.childSchema}.${fk.childTable}`,
        column: fk.childColumn,
        onDelete: fk.onDelete,
        count,
      });
    }
  }

  const blockers = [];

  for (const group of blockerGroups.values()) {
    const schema = qIdent(group.schema);
    const table = qIdent(group.table);
    const where = group.columns
      .map((col) => `${qIdent(col)} IN (${candidateSql})`)
      .join(" OR ");

    const rows = await prisma.$queryRawUnsafe(`
      SELECT *
      FROM ${schema}.${table}
      WHERE ${where}
    `);

    blockers.push({
      ...group,
      rows,
      where,
    });
  }

  console.log("");
  console.log("DEPENDENCIES");
  console.log("------------------------------------------------------------");

  if (!blockers.length) {
    console.log("RESTRICT/NO ACTION rows to delete first : 0");
  } else {
    for (const b of blockers) {
      console.log(
        `${b.schema}.${b.table} [${b.columns.join(", ")}] : ${b.rows.length} row(s) will be backed up + deleted`
      );
    }
  }

  for (const a of automaticRefs) {
    console.log(
      `${a.table}.${a.column} : ${a.count} ref(s), ON DELETE ${a.onDelete}`
    );
  }

  console.log("");
  console.log("FINAL RESULT");
  console.log("------------------------------------------------------------");
  console.log(`KEEP                       : 641`);
  console.log(`WOULD DELETE FROM Device   : ${candidates.length}`);
  console.log(`FINAL Device TABLE COUNT   : 641`);

  if (!apply) {
    console.log("");
    console.log("============================================================");
    console.log(" DRY RUN ONLY ✅");
    console.log("============================================================");
    console.log("✅ NO DATABASE CHANGES WERE MADE.");
    console.log("");
    console.log("IMPORTANT:");
    console.log("This script deletes EVERY Device-table row outside the protected 641.");
    console.log("That includes GATE rows if they are outside the protected 641.");
    console.log("");
    console.log("To apply:");
    console.log("node scripts\\leave-only-641-total.cjs --apply");
    return;
  }

  // Backups before any delete.
  const backupDir = path.join(process.cwd(), "backup");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const deviceBackup = path.join(
    backupDir,
    `outside-keep-641-device-rows-${stamp}.json`
  );
  fs.writeFileSync(
    deviceBackup,
    JSON.stringify(candidates, jsonReplacer, 2),
    "utf8"
  );
  console.log("");
  console.log(`Backup Device rows: ${deviceBackup}`);

  for (const b of blockers) {
    const p = path.join(
      backupDir,
      `${b.table}-outside-keep-641-${stamp}.json`
    );
    fs.writeFileSync(p, JSON.stringify(b.rows, jsonReplacer, 2), "utf8");
    console.log(`Backup dependency: ${p}`);
  }

  console.log("");
  console.log("FINAL CONFIRMATION");
  console.log("------------------------------------------------------------");
  console.log(`KEEP protected rows       : 641`);
  console.log(`DELETE Device rows        : ${candidates.length}`);
  Object.entries(byType).forEach(([type, count]) => {
    console.log(`  DELETE ${type.padEnd(16)}: ${count}`);
  });
  console.log("FINAL Device table count  : 641");
  console.log("");

  const confirm = await ask(
    "Type LEAVE-ONLY-641 to permanently continue: "
  );

  if (confirm !== "LEAVE-ONLY-641") {
    console.log("❌ Cancelled. NOTHING WAS DELETED.");
    return;
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const keepBefore = await tx.device.count({
        where: { id: { in: keepIds } },
      });

      if (keepBefore !== EXPECTED_KEEP) {
        throw new Error(
          `ROLLBACK: KEEP changed before delete (${keepBefore}/641).`
        );
      }

      const deletedDependencies = [];

      for (const b of blockers) {
        const schema = qIdent(b.schema);
        const table = qIdent(b.table);

        const deleted = await tx.$executeRawUnsafe(`
          DELETE FROM ${schema}.${table}
          WHERE ${b.where}
        `);

        if (Number(deleted) !== b.rows.length) {
          throw new Error(
            `ROLLBACK: ${b.schema}.${b.table} expected delete=${b.rows.length}, actual=${deleted}.`
          );
        }

        deletedDependencies.push({
          table: `${b.schema}.${b.table}`,
          count: Number(deleted),
        });
      }

      const deletedDevices = await tx.device.deleteMany({
        where: {
          id: { in: candidateIds },
          NOT: { id: { in: keepIds } },
        },
      });

      if (deletedDevices.count !== candidateIds.length) {
        throw new Error(
          `ROLLBACK: expected Device delete=${candidateIds.length}, actual=${deletedDevices.count}.`
        );
      }

      const finalTotal = await tx.device.count();
      const keepAfter = await tx.device.count({
        where: { id: { in: keepIds } },
      });

      if (finalTotal !== EXPECTED_KEEP) {
        throw new Error(
          `ROLLBACK: final Device table count=${finalTotal}, expected 641.`
        );
      }

      if (keepAfter !== EXPECTED_KEEP) {
        throw new Error(
          `ROLLBACK: protected KEEP after delete=${keepAfter}/641.`
        );
      }

      return {
        deletedDevices: deletedDevices.count,
        finalTotal,
        keepAfter,
        deletedDependencies,
      };
    },
    {
      maxWait: 10000,
      timeout: 120000,
    }
  );

  console.log("");
  console.log("============================================================");
  console.log(" SUCCESS ✅");
  console.log("============================================================");
  console.log(`Deleted Device rows       : ${result.deletedDevices}`);
  console.log(`Final Device table count  : ${result.finalTotal}`);
  console.log(`Protected KEEP found      : ${result.keepAfter} / 641`);

  for (const d of result.deletedDependencies) {
    console.log(`Deleted ${d.table.padEnd(30)}: ${d.count}`);
  }

  console.log("");
  console.log("✅ ONLY THE PROTECTED 641 REMAIN IN Device TABLE.");
  console.log("✅ ALL 641 PROTECTED ROWS ARE STILL PRESENT.");
}

main()
  .catch((err) => {
    console.error("");
    console.error("❌ ERROR:", err.message || err);
    console.error("If the transaction started, it was rolled back.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
