const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const IDS_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\PROTECTED_641_IDS.json";

const EXPECTED_KEEP = 641;

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(q, (a) => {
    rl.close();
    resolve(String(a || "").trim());
  }));
}

function loadProtectedIds() {
  if (!fs.existsSync(IDS_FILE)) throw new Error(`Missing ${IDS_FILE}`);
  const data = JSON.parse(fs.readFileSync(IDS_FILE, "utf8"));
  const ids = Array.isArray(data.protectedBackendIds)
    ? data.protectedBackendIds.map(Number).filter(Number.isFinite)
    : [];
  return [...new Set(ids)];
}

function sqlIds(ids) {
  return ids.length ? ids.map(Number).filter(Number.isFinite).join(",") : "NULL";
}

function jsonReplacer(_k, v) {
  return typeof v === "bigint" ? v.toString() : v;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const keepIds = loadProtectedIds();

  console.log("============================================================");
  console.log(" KEEP 641 - SAFE DEVICE CLEANUP V4");
  console.log(" GATES COMPLETELY OUT OF SCOPE");
  console.log("============================================================");

  if (keepIds.length !== EXPECTED_KEEP) {
    throw new Error(`SAFETY STOP: protected IDs=${keepIds.length}, expected 641.`);
  }

  const keepCount = await prisma.device.count({
    where: { id: { in: keepIds }, assetType: "DEVICE" },
  });
  if (keepCount !== EXPECTED_KEEP) {
    throw new Error(`SAFETY STOP: protected DEVICE found=${keepCount}/641.`);
  }

  const allDevices = await prisma.device.findMany({
    where: { assetType: "DEVICE" },
    select: { id: true, deviceCode: true, ipAddress: true, serialNumber: true },
    orderBy: { id: "asc" },
  });

  const keepSet = new Set(keepIds.map(Number));
  const candidates = allDevices.filter((d) => !keepSet.has(Number(d.id)));
  const candidateIds = candidates.map((d) => Number(d.id));

  if (allDevices.length - candidateIds.length !== EXPECTED_KEEP) {
    throw new Error("SAFETY STOP: cleanup would not leave exactly 641 DEVICE.");
  }

  const gateBefore = await prisma.device.count({ where: { assetType: "GATE" } });

  const C = sqlIds(candidateIds);
  const K = sqlIds(keepIds);

  // Load exact dependent rows that block deletion.
  const statusHistory = await prisma.$queryRawUnsafe(`
    SELECT * FROM "DeviceStatusHistory"
    WHERE "deviceId" IN (${C})
  `);

  const morphoRepair = await prisma.$queryRawUnsafe(`
    SELECT * FROM "DeviceMorphoRepair"
    WHERE "deviceId" IN (${C})
  `);

  const replacements = await prisma.$queryRawUnsafe(`
    SELECT * FROM "DeviceReplacement"
    WHERE "oldDeviceId" IN (${C}) OR "newDeviceId" IN (${C})
  `);

  // Count protected dependent rows before. These must remain unchanged.
  const keepStatusBefore = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS count FROM "DeviceStatusHistory"
    WHERE "deviceId" IN (${K})
  `);

  const keepMorphoBefore = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS count FROM "DeviceMorphoRepair"
    WHERE "deviceId" IN (${K})
  `);

  const keepReplacementBefore = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS count FROM "DeviceReplacement"
    WHERE "oldDeviceId" IN (${K}) OR "newDeviceId" IN (${K})
  `);

  const ks = Number(keepStatusBefore[0]?.count || 0);
  const km = Number(keepMorphoBefore[0]?.count || 0);
  const kr = Number(keepReplacementBefore[0]?.count || 0);

  // Find whether any replacement row touches both a candidate and a KEEP device.
  const mixedReplacementRows = await prisma.$queryRawUnsafe(`
    SELECT *
    FROM "DeviceReplacement"
    WHERE
      ("oldDeviceId" IN (${C}) AND "newDeviceId" IN (${K}))
      OR
      ("oldDeviceId" IN (${K}) AND "newDeviceId" IN (${C}))
  `);

  console.log("");
  console.log("SAFETY CHECK");
  console.log("------------------------------------------------------------");
  console.log(`Protected KEEP DEVICE            : ${keepCount}`);
  console.log(`All DEVICE rows                  : ${allDevices.length}`);
  console.log(`Delete candidate DEVICE rows     : ${candidateIds.length}`);
  console.log(`Final DEVICE count               : ${allDevices.length - candidateIds.length}`);
  console.log(`GATE rows                        : ${gateBefore}`);
  console.log(`GATE rows to delete              : 0`);
  console.log("");
  console.log("BLOCKING DEPENDENCIES FOR 807");
  console.log(`DeviceStatusHistory rows         : ${statusHistory.length}`);
  console.log(`DeviceMorphoRepair rows          : ${morphoRepair.length}`);
  console.log(`DeviceReplacement rows           : ${replacements.length}`);
  console.log(`Replacement rows touching KEEP   : ${mixedReplacementRows.length}`);
  console.log("");

  if (mixedReplacementRows.length) {
    console.log("⚠️ NOTE: some DeviceReplacement history links a deleted DEVICE to a KEEP DEVICE.");
    console.log("   V4 will BACK UP those rows before deleting the replacement history row.");
  }

  if (!apply) {
    console.log("");
    console.log("============================================================");
    console.log(" DRY RUN ONLY ✅");
    console.log("============================================================");
    console.log(`KEEP DEVICE                      : 641`);
    console.log(`WOULD DELETE DEVICE              : ${candidateIds.length}`);
    console.log(`WOULD DELETE DeviceStatusHistory : ${statusHistory.length}`);
    console.log(`WOULD DELETE DeviceMorphoRepair  : ${morphoRepair.length}`);
    console.log(`WOULD DELETE DeviceReplacement   : ${replacements.length}`);
    console.log(`WOULD DELETE GATE                : 0`);
    console.log(`FINAL DEVICE COUNT               : 641`);
    console.log("");
    console.log("✅ NO DATABASE CHANGES WERE MADE.");
    console.log("To apply:");
    console.log("node scripts\\cleanup-devices-keep-641-v4.cjs --apply");
    return;
  }

  const backupDir = path.join(process.cwd(), "backup");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const backups = [
    ["device-candidates", candidates],
    ["device-status-history", statusHistory],
    ["device-morpho-repair", morphoRepair],
    ["device-replacement", replacements],
  ];

  for (const [name, rows] of backups) {
    const p = path.join(backupDir, `${name}-${stamp}.json`);
    fs.writeFileSync(p, JSON.stringify(rows, jsonReplacer, 2), "utf8");
    console.log(`Backup: ${p}`);
  }

  console.log("");
  console.log("FINAL GUARANTEE BEFORE DELETE");
  console.log("------------------------------------------------------------");
  console.log("KEEP DEVICE = 641");
  console.log(`DELETE DEVICE = ${candidateIds.length}`);
  console.log("DELETE GATE = 0");
  console.log("All blocking dependent rows are backed up first.");

  const confirm = await ask("Type KEEP-641-V4 to continue: ");
  if (confirm !== "KEEP-641-V4") {
    console.log("❌ Cancelled. NOTHING WAS DELETED.");
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const keepStart = await tx.device.count({
      where: { id: { in: keepIds }, assetType: "DEVICE" },
    });
    if (keepStart !== 641) throw new Error(`ROLLBACK: KEEP changed before delete (${keepStart}/641).`);

    const gateStart = await tx.device.count({ where: { assetType: "GATE" } });

    const delHist = await tx.$executeRawUnsafe(`
      DELETE FROM "DeviceStatusHistory"
      WHERE "deviceId" IN (${C})
    `);

    const delMorpho = await tx.$executeRawUnsafe(`
      DELETE FROM "DeviceMorphoRepair"
      WHERE "deviceId" IN (${C})
    `);

    const delReplacement = await tx.$executeRawUnsafe(`
      DELETE FROM "DeviceReplacement"
      WHERE "oldDeviceId" IN (${C}) OR "newDeviceId" IN (${C})
    `);

    const delDevices = await tx.device.deleteMany({
      where: {
        id: { in: candidateIds },
        assetType: "DEVICE",
        NOT: { id: { in: keepIds } },
      },
    });

    const remainingDevice = await tx.device.count({ where: { assetType: "DEVICE" } });
    const keepEnd = await tx.device.count({
      where: { id: { in: keepIds }, assetType: "DEVICE" },
    });
    const gateEnd = await tx.device.count({ where: { assetType: "GATE" } });

    const keepStatusAfter = await tx.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count FROM "DeviceStatusHistory"
      WHERE "deviceId" IN (${K})
    `);
    const keepMorphoAfter = await tx.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count FROM "DeviceMorphoRepair"
      WHERE "deviceId" IN (${K})
    `);

    const ksa = Number(keepStatusAfter[0]?.count || 0);
    const kma = Number(keepMorphoAfter[0]?.count || 0);

    if (Number(delHist) !== statusHistory.length)
      throw new Error(`ROLLBACK: history delete ${delHist}/${statusHistory.length}.`);
    if (Number(delMorpho) !== morphoRepair.length)
      throw new Error(`ROLLBACK: morpho delete ${delMorpho}/${morphoRepair.length}.`);
    if (Number(delReplacement) !== replacements.length)
      throw new Error(`ROLLBACK: replacement delete ${delReplacement}/${replacements.length}.`);
    if (delDevices.count !== candidateIds.length)
      throw new Error(`ROLLBACK: device delete ${delDevices.count}/${candidateIds.length}.`);
    if (remainingDevice !== 641)
      throw new Error(`ROLLBACK: remaining DEVICE=${remainingDevice}, expected 641.`);
    if (keepEnd !== 641)
      throw new Error(`ROLLBACK: KEEP after delete=${keepEnd}/641.`);
    if (gateEnd !== gateStart)
      throw new Error(`ROLLBACK: GATE changed ${gateStart}->${gateEnd}.`);
    if (ksa !== ks)
      throw new Error(`ROLLBACK: protected DeviceStatusHistory changed ${ks}->${ksa}.`);
    if (kma !== km)
      throw new Error(`ROLLBACK: protected DeviceMorphoRepair changed ${km}->${kma}.`);

    return {
      delHist: Number(delHist),
      delMorpho: Number(delMorpho),
      delReplacement: Number(delReplacement),
      delDevices: delDevices.count,
      remainingDevice,
      keepEnd,
      gateStart,
      gateEnd,
      keepReplacementBefore: kr,
      mixedReplacementRows: mixedReplacementRows.length,
    };
  }, { maxWait: 10000, timeout: 120000 });

  console.log("");
  console.log("============================================================");
  console.log(" CLEANUP SUCCESS ✅");
  console.log("============================================================");
  console.log(`Deleted DEVICE                : ${result.delDevices}`);
  console.log(`Remaining DEVICE              : ${result.remainingDevice}`);
  console.log(`Protected KEEP found          : ${result.keepEnd} / 641`);
  console.log(`Deleted DeviceStatusHistory   : ${result.delHist}`);
  console.log(`Deleted DeviceMorphoRepair    : ${result.delMorpho}`);
  console.log(`Deleted DeviceReplacement     : ${result.delReplacement}`);
  console.log(`Mixed replacement rows backed : ${result.mixedReplacementRows}`);
  console.log(`GATE before/after             : ${result.gateStart}/${result.gateEnd}`);
  console.log(`Deleted GATE                  : 0`);
  console.log("");
  console.log("✅ EXACTLY 641 DEVICE REMAIN.");
  console.log("✅ ALL 641 PROTECTED DEVICES REMAIN.");
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
