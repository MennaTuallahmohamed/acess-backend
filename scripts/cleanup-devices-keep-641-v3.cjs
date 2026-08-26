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

function idsSql(ids) {
  if (!ids.length) return "NULL";
  return ids.map((n) => Number(n)).filter(Number.isFinite).join(",");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const protectedIds = loadProtectedIds();

  console.log("============================================================");
  console.log(" KEEP 641 - SAFE DEVICE CLEANUP V3");
  console.log(" GATES OUT OF SCOPE");
  console.log("============================================================");

  if (protectedIds.length !== EXPECTED_KEEP) {
    throw new Error(
      `SAFETY STOP: protected IDs must be exactly ${EXPECTED_KEEP}, found ${protectedIds.length}.`
    );
  }

  const protectedRows = await prisma.device.findMany({
    where: {
      id: { in: protectedIds },
      assetType: "DEVICE",
    },
    select: {
      id: true,
      deviceCode: true,
      ipAddress: true,
      serialNumber: true,
    },
  });

  if (protectedRows.length !== EXPECTED_KEEP) {
    throw new Error(
      `SAFETY STOP: only ${protectedRows.length}/${EXPECTED_KEEP} protected DEVICE rows exist.`
    );
  }

  const allDevices = await prisma.device.findMany({
    where: { assetType: "DEVICE" },
    select: {
      id: true,
      deviceCode: true,
      ipAddress: true,
      serialNumber: true,
    },
    orderBy: { id: "asc" },
  });

  const protectedSet = new Set(protectedIds.map(Number));
  const candidates = allDevices.filter(
    (d) => !protectedSet.has(Number(d.id))
  );
  const candidateIds = candidates.map((d) => Number(d.id));

  if (allDevices.length - candidateIds.length !== EXPECTED_KEEP) {
    throw new Error(
      `SAFETY STOP: cleanup would not leave exactly ${EXPECTED_KEEP} DEVICE rows.`
    );
  }

  const gateCountBefore = await prisma.device.count({
    where: { assetType: "GATE" },
  });

  const candidateSql = idsSql(candidateIds);
  const protectedSql = idsSql(protectedIds);

  const histCandidate = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS "count"
    FROM "DeviceStatusHistory"
    WHERE "deviceId" IN (${candidateSql})
  `);

  const histProtected = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS "count"
    FROM "DeviceStatusHistory"
    WHERE "deviceId" IN (${protectedSql})
  `);

  const histCandidateCount = Number(histCandidate[0]?.count || 0);
  const histProtectedCount = Number(histProtected[0]?.count || 0);

  // Detect any OTHER RESTRICT/NO ACTION references that would still block deletion.
  const blockers = await prisma.$queryRawUnsafe(`
    SELECT
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
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON TRUE
    JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS pk(attnum, ord) ON pk.ord = ck.ord
    JOIN pg_attribute att_child
      ON att_child.attrelid = con.conrelid AND att_child.attnum = ck.attnum
    JOIN pg_attribute att_parent
      ON att_parent.attrelid = con.confrelid AND att_parent.attnum = pk.attnum
    WHERE con.contype = 'f'
      AND parent.relname = 'Device'
      AND att_parent.attname = 'id'
      AND con.confdeltype IN ('a','r')
    ORDER BY child.relname
  `);

  const activeOtherBlockers = [];

  for (const b of blockers) {
    if (b.childTable === "DeviceStatusHistory") continue;

    const table = `"${String(b.childTable).replace(/"/g, '""')}"`;
    const column = `"${String(b.childColumn).replace(/"/g, '""')}"`;

    const rows = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS "count"
      FROM ${table}
      WHERE ${column} IN (${candidateSql})
    `);

    const count = Number(rows[0]?.count || 0);

    if (count > 0) {
      activeOtherBlockers.push({
        table: b.childTable,
        column: b.childColumn,
        onDelete: b.onDelete,
        count,
      });
    }
  }

  console.log("");
  console.log("SAFETY CHECK");
  console.log("------------------------------------------------------------");
  console.log(`Protected KEEP DEVICE          : ${protectedRows.length}`);
  console.log(`All DEVICE rows                : ${allDevices.length}`);
  console.log(`Delete candidate DEVICE rows   : ${candidateIds.length}`);
  console.log(`Final DEVICE count             : ${allDevices.length - candidateIds.length}`);
  console.log(`GATE rows                      : ${gateCountBefore}`);
  console.log(`GATE rows to delete            : 0`);
  console.log("");
  console.log(`DeviceStatusHistory -> 807     : ${histCandidateCount}`);
  console.log(`DeviceStatusHistory -> 641     : ${histProtectedCount}`);
  console.log(`Other active RESTRICT blockers : ${activeOtherBlockers.length}`);

  if (activeOtherBlockers.length) {
    console.log("");
    console.log("❌ OTHER BLOCKERS FOUND:");
    activeOtherBlockers.forEach((b) => {
      console.log(
        `${b.table}.${b.column} | ${b.onDelete} | refs=${b.count}`
      );
    });
    throw new Error(
      "SAFETY STOP: another RESTRICT/NO ACTION table still references delete candidates."
    );
  }

  if (!apply) {
    console.log("");
    console.log("============================================================");
    console.log(" DRY RUN ONLY ✅");
    console.log("============================================================");
    console.log(`KEEP DEVICE                     : ${EXPECTED_KEEP}`);
    console.log(`WOULD DELETE DEVICE             : ${candidateIds.length}`);
    console.log(`WOULD DELETE DeviceStatusHistory: ${histCandidateCount}`);
    console.log(`WOULD DELETE GATE               : 0`);
    console.log(`FINAL DEVICE COUNT              : ${EXPECTED_KEEP}`);
    console.log("");
    console.log("TechnicianActivityLog / SET NULL references are NOT deleted;");
    console.log("PostgreSQL will only set their deviceId to NULL for deleted devices.");
    console.log("");
    console.log("✅ NO DATABASE CHANGES WERE MADE.");
    console.log("To apply:");
    console.log("node scripts\\cleanup-devices-keep-641-v3.cjs --apply");
    return;
  }

  const backupDir = path.join(process.cwd(), "backup");
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const deviceBackupPath = path.join(
    backupDir,
    `deleted-device-candidates-${stamp}.json`
  );

  fs.writeFileSync(
    deviceBackupPath,
    JSON.stringify(candidates, null, 2),
    "utf8"
  );

  const historyRows = await prisma.$queryRawUnsafe(`
    SELECT *
    FROM "DeviceStatusHistory"
    WHERE "deviceId" IN (${candidateSql})
    ORDER BY "deviceId"
  `);

  const historyBackupPath = path.join(
    backupDir,
    `deleted-device-status-history-${stamp}.json`
  );

  fs.writeFileSync(
    historyBackupPath,
    JSON.stringify(historyRows, (_, v) =>
      typeof v === "bigint" ? v.toString() : v
    , 2),
    "utf8"
  );

  console.log("");
  console.log(`Device backup : ${deviceBackupPath}`);
  console.log(`History backup: ${historyBackupPath}`);
  console.log("");
  console.log("FINAL GUARANTEE");
  console.log(`KEEP DEVICE                     = ${EXPECTED_KEEP}`);
  console.log(`DELETE DEVICE                   = ${candidateIds.length}`);
  console.log(`DELETE DeviceStatusHistory      = ${histCandidateCount}`);
  console.log(`DELETE GATE                     = 0`);

  const confirm = await ask(
    "Type KEEP-641-CLEANUP-V3 to continue: "
  );

  if (confirm !== "KEEP-641-CLEANUP-V3") {
    console.log("❌ Cancelled. NOTHING WAS DELETED.");
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const keepBefore = await tx.device.count({
      where: {
        id: { in: protectedIds },
        assetType: "DEVICE",
      },
    });

    if (keepBefore !== EXPECTED_KEEP) {
      throw new Error(
        `ROLLBACK: protected KEEP changed before delete (${keepBefore}/${EXPECTED_KEEP}).`
      );
    }

    const gateBeforeTx = await tx.device.count({
      where: { assetType: "GATE" },
    });

    const protectedHistBeforeRows = await tx.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS "count"
      FROM "DeviceStatusHistory"
      WHERE "deviceId" IN (${protectedSql})
    `);
    const protectedHistBefore = Number(
      protectedHistBeforeRows[0]?.count || 0
    );

    const deletedHistory = await tx.$executeRawUnsafe(`
      DELETE FROM "DeviceStatusHistory"
      WHERE "deviceId" IN (${candidateSql})
    `);

    const deletedDevices = await tx.device.deleteMany({
      where: {
        id: { in: candidateIds },
        assetType: "DEVICE",
        NOT: {
          id: { in: protectedIds },
        },
      },
    });

    const remainingDevices = await tx.device.count({
      where: { assetType: "DEVICE" },
    });

    const keepAfter = await tx.device.count({
      where: {
        id: { in: protectedIds },
        assetType: "DEVICE",
      },
    });

    const gateAfterTx = await tx.device.count({
      where: { assetType: "GATE" },
    });

    const protectedHistAfterRows = await tx.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS "count"
      FROM "DeviceStatusHistory"
      WHERE "deviceId" IN (${protectedSql})
    `);
    const protectedHistAfter = Number(
      protectedHistAfterRows[0]?.count || 0
    );

    if (Number(deletedHistory) !== histCandidateCount) {
      throw new Error(
        `ROLLBACK: expected DeviceStatusHistory delete ${histCandidateCount}, got ${deletedHistory}.`
      );
    }

    if (deletedDevices.count !== candidateIds.length) {
      throw new Error(
        `ROLLBACK: expected DEVICE delete ${candidateIds.length}, got ${deletedDevices.count}.`
      );
    }

    if (remainingDevices !== EXPECTED_KEEP) {
      throw new Error(
        `ROLLBACK: remaining DEVICE=${remainingDevices}, expected=${EXPECTED_KEEP}.`
      );
    }

    if (keepAfter !== EXPECTED_KEEP) {
      throw new Error(
        `ROLLBACK: protected KEEP after delete=${keepAfter}/${EXPECTED_KEEP}.`
      );
    }

    if (gateAfterTx !== gateBeforeTx) {
      throw new Error(
        `ROLLBACK: GATE changed ${gateBeforeTx} -> ${gateAfterTx}.`
      );
    }

    if (protectedHistAfter !== protectedHistBefore) {
      throw new Error(
        `ROLLBACK: protected DeviceStatusHistory changed ${protectedHistBefore} -> ${protectedHistAfter}.`
      );
    }

    return {
      deletedHistory: Number(deletedHistory),
      deletedDevices: deletedDevices.count,
      remainingDevices,
      keepAfter,
      gateBeforeTx,
      gateAfterTx,
      protectedHistBefore,
      protectedHistAfter,
    };
  }, {
    maxWait: 10000,
    timeout: 120000,
  });

  console.log("");
  console.log("============================================================");
  console.log(" CLEANUP SUCCESS ✅");
  console.log("============================================================");
  console.log(`Deleted DEVICE                : ${result.deletedDevices}`);
  console.log(`Remaining DEVICE              : ${result.remainingDevices}`);
  console.log(`Protected KEEP found          : ${result.keepAfter} / 641`);
  console.log(`Deleted DeviceStatusHistory   : ${result.deletedHistory}`);
  console.log(`Protected history before/after: ${result.protectedHistBefore}/${result.protectedHistAfter}`);
  console.log(`GATE before/after             : ${result.gateBeforeTx}/${result.gateAfterTx}`);
  console.log(`Deleted GATE                  : 0`);
  console.log("");
  console.log("✅ EXACTLY 641 DEVICE REMAIN.");
  console.log("✅ ALL 641 PROTECTED DEVICES REMAIN.");
  console.log("✅ PROTECTED HISTORY WAS NOT DELETED.");
  console.log("✅ NO GATE WAS DELETED.");
}

main()
  .catch((err) => {
    console.error("");
    console.error("❌", err.message || err);
    console.error("If deletion had started, the transaction was rolled back.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
