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

async function main() {
  const apply = process.argv.includes("--apply");
  const protectedIds = loadProtectedIds();

  console.log("============================================================");
  console.log(" KEEP 641 - DELETE OTHER DEVICES ONLY");
  console.log(" GATES ARE COMPLETELY OUT OF SCOPE");
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
      `SAFETY STOP: only ${protectedRows.length} / ${EXPECTED_KEEP} protected DEVICE rows exist.`
    );
  }

  const allDevices = await prisma.device.findMany({
    where: {
      assetType: "DEVICE",
    },
    select: {
      id: true,
      deviceCode: true,
      ipAddress: true,
      serialNumber: true,
      assetType: true,
    },
    orderBy: { id: "asc" },
  });

  const gateCountBefore = await prisma.device.count({
    where: { assetType: "GATE" },
  });

  const protectedSet = new Set(protectedIds.map(Number));

  const candidates = allDevices.filter(
    (d) => !protectedSet.has(Number(d.id))
  );

  const accidentalProtected = candidates.filter((d) =>
    protectedSet.has(Number(d.id))
  );

  const nonDeviceCandidate = candidates.filter(
    (d) => d.assetType !== "DEVICE"
  );

  if (accidentalProtected.length) {
    throw new Error(
      `SAFETY STOP: protected row entered delete list.`
    );
  }

  if (nonDeviceCandidate.length) {
    throw new Error(
      `SAFETY STOP: non-DEVICE row entered delete list.`
    );
  }

  console.log("");
  console.log("SAFETY CHECK");
  console.log("------------------------------------------------------------");
  console.log(`Protected KEEP DEVICE      : ${protectedRows.length}`);
  console.log(`All DEVICE rows            : ${allDevices.length}`);
  console.log(`Delete other DEVICE rows   : ${candidates.length}`);
  console.log(`GATE rows                  : ${gateCountBefore}`);
  console.log(`GATE rows to delete        : 0`);
  console.log("");

  console.log(`Expected DEVICE after cleanup: ${allDevices.length - candidates.length}`);

  if (allDevices.length - candidates.length !== EXPECTED_KEEP) {
    throw new Error(
      `SAFETY STOP: cleanup would not leave exactly ${EXPECTED_KEEP} DEVICE rows.`
    );
  }

  console.log("");
  console.log("DELETE CANDIDATES (DEVICE ONLY)");
  console.log("------------------------------------------------------------");

  for (const [i, d] of candidates.entries()) {
    console.log(
      `${String(i + 1).padStart(4, " ")} / ${candidates.length}` +
      `  Backend ID=${d.id}` +
      `  DeviceCode=${d.deviceCode ?? "-"}` +
      `  IP=${d.ipAddress ?? "-"}`
    );
  }

  if (!apply) {
    console.log("");
    console.log("============================================================");
    console.log(" DRY RUN ONLY ✅");
    console.log("============================================================");
    console.log(`KEEP DEVICE                : ${EXPECTED_KEEP}`);
    console.log(`WOULD DELETE DEVICE        : ${candidates.length}`);
    console.log(`WOULD DELETE GATE          : 0`);
    console.log(`FINAL DEVICE COUNT         : ${EXPECTED_KEEP}`);
    console.log("");
    console.log("✅ NO DATABASE CHANGES WERE MADE.");
    console.log("To apply:");
    console.log("node scripts\\delete-other-devices-keep-641.cjs --apply");
    return;
  }

  const backupDir = path.join(process.cwd(), "backup");
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(
    backupDir,
    `device-delete-candidates-${stamp}.json`
  );

  fs.writeFileSync(
    backupPath,
    JSON.stringify(candidates, null, 2),
    "utf8"
  );

  console.log("");
  console.log(`Backup candidate list: ${backupPath}`);
  console.log("");
  console.log("FINAL GUARANTEE BEFORE DELETE:");
  console.log(`  KEEP DEVICE = ${EXPECTED_KEEP}`);
  console.log(`  DELETE DEVICE = ${candidates.length}`);
  console.log(`  DELETE GATE = 0`);
  console.log("");

  const confirm = await ask(
    "Type KEEP-641-DELETE-OTHER-DEVICES to continue: "
  );

  if (confirm !== "KEEP-641-DELETE-OTHER-DEVICES") {
    console.log("❌ Cancelled. NOTHING WAS DELETED.");
    return;
  }

  const candidateIds = candidates.map((d) => Number(d.id));

  const result = await prisma.$transaction(async (tx) => {
    // Re-check KEEP immediately inside the transaction.
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

    const deleted = await tx.device.deleteMany({
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

    if (deleted.count !== candidateIds.length) {
      throw new Error(
        `ROLLBACK: expected to delete ${candidateIds.length}, actually deleted ${deleted.count}.`
      );
    }

    if (remainingDevices !== EXPECTED_KEEP) {
      throw new Error(
        `ROLLBACK: remaining DEVICE count is ${remainingDevices}, expected ${EXPECTED_KEEP}.`
      );
    }

    if (keepAfter !== EXPECTED_KEEP) {
      throw new Error(
        `ROLLBACK: protected KEEP after delete is ${keepAfter}/${EXPECTED_KEEP}.`
      );
    }

    if (gateAfterTx !== gateBeforeTx) {
      throw new Error(
        `ROLLBACK: GATE count changed from ${gateBeforeTx} to ${gateAfterTx}.`
      );
    }

    return {
      deleted: deleted.count,
      remainingDevices,
      keepAfter,
      gateBeforeTx,
      gateAfterTx,
    };
  });

  console.log("");
  console.log("============================================================");
  console.log(" CLEANUP SUCCESS ✅");
  console.log("============================================================");
  console.log(`Deleted DEVICE             : ${result.deleted}`);
  console.log(`Remaining DEVICE           : ${result.remainingDevices}`);
  console.log(`Protected KEEP found       : ${result.keepAfter} / 641`);
  console.log(`GATE before                : ${result.gateBeforeTx}`);
  console.log(`GATE after                 : ${result.gateAfterTx}`);
  console.log(`Deleted GATE               : 0`);
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
