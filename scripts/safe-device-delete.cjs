const fs = require("fs");
const path = require("path");
const readline = require("readline");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const EXPECTED_PROTECTED = 641;
const DEFAULT_PROTECTED_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\PROTECTED_641_IDS.json";

// We store only the SHA-256 hash, not the plain password.
const PASSWORD_SHA256 = "066eb9499d0c877ad509017a03718871db6b34db291a34bd8bab5dcda35b6be8";

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function askHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      const rl = readline.createInterface({ input: stdin, output: stdout });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
      return;
    }

    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";

    const onData = (ch) => {
      if (ch === "\r" || ch === "\n") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        stdout.write("\n");
        resolve(value);
        return;
      }

      if (ch === "\u0003") {
        stdin.setRawMode(false);
        stdin.pause();
        process.exit(130);
      }

      if (ch === "\u007f" || ch === "\b") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          stdout.write("\b \b");
        }
        return;
      }

      value += ch;
      stdout.write("*");
    };

    stdin.on("data", onData);
  });
}

function loadProtectedIds(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Protected IDs file not found: ${filePath}`);
  }

  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const ids = Array.isArray(data.protectedBackendIds)
    ? data.protectedBackendIds.map(Number).filter(Number.isFinite)
    : [];

  const unique = [...new Set(ids)];

  if (unique.length !== EXPECTED_PROTECTED) {
    throw new Error(
      `SAFETY STOP: expected exactly ${EXPECTED_PROTECTED} protected DB IDs, ` +
      `but file contains ${unique.length}. Nothing will be deleted.`
    );
  }

  return unique;
}

async function getAllDeviceIds() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT "id", "deviceCode", "ipAddress", "serialNumber", "secretCode"
    FROM "Device"
    WHERE "assetType"::text = 'DEVICE'
    ORDER BY "id"
  `);
  return rows;
}

async function deleteUnprotected(protectedIds, apply) {
  const allDevices = await getAllDeviceIds();
  const protectedSet = new Set(protectedIds);

  const keep = allDevices.filter((d) => protectedSet.has(Number(d.id)));
  const remove = allDevices.filter((d) => !protectedSet.has(Number(d.id)));

  console.log("============================================================");
  console.log(" SAFE DEVICE CLEANUP");
  console.log("============================================================");
  console.log(`Backend DEVICE total      : ${allDevices.length}`);
  console.log(`Protected KEEP            : ${keep.length}`);
  console.log(`Unprotected candidates    : ${remove.length}`);
  console.log("");

  if (keep.length !== EXPECTED_PROTECTED) {
    console.log("❌ SAFETY STOP.");
    console.log(`Only ${keep.length} / ${EXPECTED_PROTECTED} protected IDs currently exist in DB.`);
    console.log("NO DATABASE CHANGES WERE MADE.");
    process.exitCode = 3;
    return;
  }

  console.log("Protected IDs are LOCKED.");
  console.log("Normal cleanup can NEVER delete them.");
  console.log("");

  remove.forEach((d, i) => {
    console.log(
      `DELETE CANDIDATE ${String(i + 1).padStart(4, " ")} / ${remove.length}` +
      `  Backend ID: ${d.id}  DeviceCode: ${d.deviceCode ?? "-"}` +
      `  IP: ${d.ipAddress ?? "-"}`
    );
  });

  console.log("");

  if (!apply) {
    console.log("DRY RUN ONLY ✅");
    console.log("NO DATABASE CHANGES WERE MADE.");
    console.log("");
    console.log("To delete ONLY the unprotected DEVICE rows:");
    console.log("  node scripts\\safe-device-delete.cjs --apply");
    return;
  }

  console.log("============================================================");
  console.log(" APPLY MODE");
  console.log("============================================================");
  console.log(`Will delete ${remove.length} UNPROTECTED DEVICE rows.`);
  console.log(`Will keep   ${keep.length} PROTECTED DEVICE rows.`);
  console.log("");

  const confirmation = await askHidden(
    `Type DELETE-UNPROTECTED to continue: `
  );

  if (confirmation !== "DELETE-UNPROTECTED") {
    console.log("❌ Cancelled. Nothing was deleted.");
    return;
  }

  const idsToDelete = remove.map((d) => Number(d.id));

  if (idsToDelete.some((id) => protectedSet.has(id))) {
    throw new Error("SAFETY ERROR: protected ID entered deletion list.");
  }

  if (!idsToDelete.length) {
    console.log("Nothing to delete.");
    return;
  }

  // Deletion only of IDs that are NOT protected.
  // Transaction rolls back if a FK constraint or any other error occurs.
  const result = await prisma.$transaction(async (tx) => {
    const deleted = await tx.device.deleteMany({
      where: {
        id: { in: idsToDelete },
        assetType: "DEVICE",
      },
    });

    return deleted.count;
  });

  console.log("");
  console.log(`✅ Deleted unprotected DEVICE rows: ${result}`);
  console.log(`✅ Protected DEVICE rows kept     : ${EXPECTED_PROTECTED}`);
}

async function deleteProtectedExplicitly(protectedIds, rawIds) {
  const ids = rawIds
    .split(",")
    .map((v) => Number(v.trim()))
    .filter(Number.isFinite);

  if (!ids.length) {
    throw new Error("No protected IDs supplied.");
  }

  const protectedSet = new Set(protectedIds);
  const invalid = ids.filter((id) => !protectedSet.has(id));

  if (invalid.length) {
    throw new Error(
      `These IDs are NOT in the protected 641 list: ${invalid.join(", ")}`
    );
  }

  console.log("============================================================");
  console.log(" ⚠️  PROTECTED DEVICE DELETE REQUEST");
  console.log("============================================================");
  console.log(`Protected IDs requested: ${ids.join(", ")}`);
  console.log("");
  console.log("These IDs are part of the protected 641.");
  console.log("Password is required.");
  console.log("");

  const password = await askHidden("Password: ");

  if (sha256(password) !== PASSWORD_SHA256) {
    console.log("❌ WRONG PASSWORD.");
    console.log("❌ Protected devices were NOT deleted.");
    process.exitCode = 4;
    return;
  }

  const phrase = await askHidden(
    `Type DELETE-PROTECTED-${ids.length} to confirm: `
  );

  if (phrase !== `DELETE-PROTECTED-${ids.length}`) {
    console.log("❌ Confirmation failed.");
    console.log("❌ Protected devices were NOT deleted.");
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const deleted = await tx.device.deleteMany({
      where: {
        id: { in: ids },
        assetType: "DEVICE",
      },
    });

    return deleted.count;
  });

  console.log(`⚠️ Deleted protected DEVICE rows: ${result}`);
}

async function main() {
  const args = process.argv.slice(2);
  const protectedFileArgIndex = args.indexOf("--protected-file");
  const protectedFile =
    protectedFileArgIndex >= 0 && args[protectedFileArgIndex + 1]
      ? path.resolve(args[protectedFileArgIndex + 1])
      : DEFAULT_PROTECTED_FILE;

  const protectedIds = loadProtectedIds(protectedFile);

  console.log(`Protected file: ${protectedFile}`);
  console.log(`Protected IDs : ${protectedIds.length} / ${EXPECTED_PROTECTED} ✅`);
  console.log("");

  const protectedDeleteIndex = args.indexOf("--delete-protected");

  if (protectedDeleteIndex >= 0) {
    const value = args[protectedDeleteIndex + 1];
    if (!value) {
      throw new Error(
        'Usage: node scripts\\safe-device-delete.cjs --delete-protected "123,456"'
      );
    }
    await deleteProtectedExplicitly(protectedIds, value);
    return;
  }

  const apply = args.includes("--apply");
  await deleteUnprotected(protectedIds, apply);
}

main()
  .catch((err) => {
    console.error("");
    console.error("❌ ERROR:", err.message || err);
    console.error("❌ NO FURTHER ACTION SHOULD BE TAKEN UNTIL THIS IS FIXED.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
