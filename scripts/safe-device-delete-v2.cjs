const fs = require("fs");
const path = require("path");
const readline = require("readline");
const crypto = require("crypto");
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const EXPECTED_KEEP_ROWS = 641;
const DEFAULT_IDS_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\PROTECTED_641_IDS.json";
const DEFAULT_REPORT_FILE =
  "C:\\Users\\Mena\\Desktop\\Devices\\PROTECTED_641_DRY_RUN.csv";

const PASSWORD_SHA256 = "066eb9499d0c877ad509017a03718871db6b34db291a34bd8bab5dcda35b6be8";

function clean(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function upper(v) {
  return clean(v).toUpperCase();
}

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

function loadIds(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`IDs file not found: ${filePath}`);
  }

  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const ids = Array.isArray(data.protectedBackendIds)
    ? data.protectedBackendIds.map(Number).filter(Number.isFinite)
    : [];

  return [...new Set(ids)];
}

function loadReport(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Report file not found: ${filePath}`);
  }

  const workbook = XLSX.readFile(filePath, { raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

function reservedKey(row) {
  return {
    deviceCode: clean(row.INPUT_DEVICE_CODE),
    secretCode: upper(row.INPUT_SECRET),
    ip: clean(row.INPUT_IP),
    serial: upper(row.INPUT_SERIAL),
    cluster: clean(row.INPUT_CLUSTER),
    building: clean(row.INPUT_BUILDING),
    zone: clean(row.INPUT_ZONE),
    lane: clean(row.INPUT_LANE),
    direction: upper(row.INPUT_DIRECTION),
  };
}

function matchesReservedDevice(dbRow, reserved) {
  // Only DEVICE rows are passed into this function.
  // Strong keys only. Never protect by IP alone because the same IP may exist on a GATE.
  if (reserved.deviceCode && clean(dbRow.deviceCode) === reserved.deviceCode) {
    return true;
  }

  if (
    reserved.secretCode &&
    upper(dbRow.secretCode) === reserved.secretCode
  ) {
    return true;
  }

  if (
    reserved.ip &&
    reserved.serial &&
    clean(dbRow.ipAddress) === reserved.ip &&
    upper(dbRow.serialNumber) === reserved.serial
  ) {
    return true;
  }

  return false;
}

async function getAllDevices() {
  return prisma.$queryRawUnsafe(`
    SELECT
      d."id",
      d."deviceCode",
      d."serialNumber",
      d."ipAddress",
      d."secretCode",
      d."assetType"::text AS "assetType"
    FROM "Device" d
    WHERE d."assetType"::text = 'DEVICE'
    ORDER BY d."id"
  `);
}

function buildProtection(ids, reportRows) {
  if (reportRows.length !== EXPECTED_KEEP_ROWS) {
    throw new Error(
      `SAFETY STOP: protection report must contain exactly ${EXPECTED_KEEP_ROWS} rows, ` +
      `but it contains ${reportRows.length}.`
    );
  }

  const ambiguous = reportRows.filter((r) => upper(r.STATUS) === "AMBIGUOUS");
  const duplicates = reportRows.filter((r) => upper(r.STATUS) === "DUPLICATE_MATCH");
  const protectedRows = reportRows.filter((r) => upper(r.STATUS) === "PROTECTED");
  const missingRows = reportRows.filter((r) => upper(r.STATUS) === "NOT_FOUND");
  const unexpected = reportRows.filter(
    (r) => !["PROTECTED", "NOT_FOUND", "AMBIGUOUS", "DUPLICATE_MATCH"].includes(upper(r.STATUS))
  );

  if (ambiguous.length || duplicates.length || unexpected.length) {
    throw new Error(
      `SAFETY STOP: report contains unresolved rows. ` +
      `AMBIGUOUS=${ambiguous.length}, DUPLICATE_MATCH=${duplicates.length}, ` +
      `UNEXPECTED=${unexpected.length}.`
    );
  }

  if (protectedRows.length + missingRows.length !== EXPECTED_KEEP_ROWS) {
    throw new Error("SAFETY STOP: report statuses do not total 641.");
  }

  if (ids.length !== protectedRows.length) {
    throw new Error(
      `SAFETY STOP: JSON has ${ids.length} protected DB IDs, ` +
      `but CSV has ${protectedRows.length} PROTECTED rows.`
    );
  }

  const reserved = missingRows.map(reservedKey);

  return {
    ids: new Set(ids.map(Number)),
    protectedRows,
    reserved,
    missingRows,
  };
}

async function main() {
  const args = process.argv.slice(2);

  const idsFileIndex = args.indexOf("--ids-file");
  const reportFileIndex = args.indexOf("--report-file");

  const idsFile =
    idsFileIndex >= 0 && args[idsFileIndex + 1]
      ? path.resolve(args[idsFileIndex + 1])
      : DEFAULT_IDS_FILE;

  const reportFile =
    reportFileIndex >= 0 && args[reportFileIndex + 1]
      ? path.resolve(args[reportFileIndex + 1])
      : DEFAULT_REPORT_FILE;

  const ids = loadIds(idsFile);
  const reportRows = loadReport(reportFile);
  const protection = buildProtection(ids, reportRows);

  const allDevices = await getAllDevices();

  const protectedExisting = [];
  const unprotected = [];

  for (const d of allDevices) {
    const byId = protection.ids.has(Number(d.id));
    const byReserved = protection.reserved.some((r) =>
      matchesReservedDevice(d, r)
    );

    if (byId || byReserved) {
      protectedExisting.push({
        ...d,
        protectedBy: byId ? "BACKEND_ID" : "RESERVED_FINGERPRINT",
      });
    } else {
      unprotected.push(d);
    }
  }

  const protectedExistingIds = new Set(
    protectedExisting.map((d) => Number(d.id))
  );

  console.log("============================================================");
  console.log(" PROTECTED 641 LOCK - STATUS");
  console.log("============================================================");
  console.log(`Protection list rows      : ${reportRows.length} / 641`);
  console.log(`Protected DB IDs in file  : ${ids.length}`);
  console.log(`Reserved missing entries  : ${protection.reserved.length}`);
  console.log(`Protected currently in DB : ${protectedExisting.length}`);
  console.log(`Backend DEVICE total      : ${allDevices.length}`);
  console.log(`Unprotected candidates    : ${unprotected.length}`);
  console.log("");

  if (protection.reserved.length) {
    console.log("RESERVED / CURRENTLY MISSING FROM BACKEND:");
    protection.reserved.forEach((r, i) => {
      console.log(
        `  ${i + 1}) DeviceCode=${r.deviceCode || "-"}  ` +
        `IP=${r.ip || "-"}  Serial=${r.serial || "-"}  ` +
        `Secret=${r.secretCode || "-"}`
      );
    });
    console.log("");
  }

  console.log("✅ The 641 KEEP list is accepted.");
  console.log(
    `✅ ${protectedExisting.length} protected DEVICE row(s) physically exist now.`
  );

  if (protection.reserved.length) {
    console.log(
      `✅ ${protection.reserved.length} missing KEEP row(s) are RESERVED and will auto-lock ` +
      `if they appear later by DeviceCode / Secret / IP+Serial.`
    );
  }

  console.log("");
  console.log("Normal cleanup can NEVER delete a protected row through this script.");
  console.log("");

  const deleteProtectedIndex = args.indexOf("--delete-protected");

  if (deleteProtectedIndex >= 0) {
    const raw = args[deleteProtectedIndex + 1];

    if (!raw) {
      throw new Error(
        'Usage: node scripts\\safe-device-delete-v2.cjs --delete-protected "841"'
      );
    }

    const requestedIds = raw
      .split(",")
      .map((v) => Number(v.trim()))
      .filter(Number.isFinite);

    if (!requestedIds.length) {
      throw new Error("No valid Backend IDs supplied.");
    }

    const notProtected = requestedIds.filter(
      (id) => !protectedExistingIds.has(id)
    );

    if (notProtected.length) {
      throw new Error(
        `These Backend IDs are NOT currently protected: ${notProtected.join(", ")}`
      );
    }

    console.log("============================================================");
    console.log(" ⚠️  PROTECTED DELETE REQUEST");
    console.log("============================================================");
    console.log(`Protected Backend IDs: ${requestedIds.join(", ")}`);
    console.log("Password is required.");
    console.log("");

    const password = await askHidden("Password: ");

    if (sha256(password) !== PASSWORD_SHA256) {
      console.log("❌ WRONG PASSWORD.");
      console.log("❌ NOTHING WAS DELETED.");
      return;
    }

    const expectedPhrase = `DELETE-PROTECTED-${requestedIds.length}`;
    const phrase = await askHidden(
      `Type ${expectedPhrase} to confirm: `
    );

    if (phrase !== expectedPhrase) {
      console.log("❌ Confirmation failed.");
      console.log("❌ NOTHING WAS DELETED.");
      return;
    }

    const count = await prisma.$transaction(async (tx) => {
      const result = await tx.device.deleteMany({
        where: {
          id: { in: requestedIds },
          assetType: "DEVICE",
        },
      });
      return result.count;
    });

    console.log(`⚠️ Deleted protected DEVICE rows: ${count}`);
    return;
  }

  // Default behavior = dry run cleanup preview.
  unprotected.forEach((d, i) => {
    console.log(
      `DELETE CANDIDATE ${String(i + 1).padStart(4, " ")} / ${unprotected.length}` +
      `  Backend ID: ${d.id}` +
      `  DeviceCode: ${d.deviceCode ?? "-"}` +
      `  IP: ${d.ipAddress ?? "-"}`
    );
  });

  const apply = args.includes("--apply");

  if (!apply) {
    console.log("");
    console.log("============================================================");
    console.log(" DRY RUN ONLY ✅");
    console.log("============================================================");
    console.log("NO DATABASE CHANGES WERE MADE.");
    console.log("");
    console.log("Do NOT use --apply until you review this list.");
    return;
  }

  console.log("");
  console.log("============================================================");
  console.log(" APPLY MODE - UNPROTECTED ONLY");
  console.log("============================================================");
  console.log(`Will delete : ${unprotected.length} unprotected DEVICE rows`);
  console.log(`Will keep   : ${protectedExisting.length} protected DEVICE rows`);
  console.log(`Reserved    : ${protection.reserved.length} missing KEEP row(s)`);
  console.log("");

  const confirmation = await askHidden(
    "Type DELETE-UNPROTECTED to continue: "
  );

  if (confirmation !== "DELETE-UNPROTECTED") {
    console.log("❌ Cancelled. NOTHING WAS DELETED.");
    return;
  }

  const idsToDelete = unprotected.map((d) => Number(d.id));

  // Last safety assertion immediately before DELETE.
  const accidentalProtected = idsToDelete.filter((id) =>
    protectedExistingIds.has(id)
  );

  if (accidentalProtected.length) {
    throw new Error(
      `SAFETY ERROR: protected IDs entered deletion list: ${accidentalProtected.join(", ")}`
    );
  }

  const deletedCount = await prisma.$transaction(async (tx) => {
    const result = await tx.device.deleteMany({
      where: {
        id: { in: idsToDelete },
        assetType: "DEVICE",
      },
    });
    return result.count;
  });

  console.log("");
  console.log(`✅ Deleted unprotected DEVICE rows: ${deletedCount}`);
  console.log(`✅ Protected existing DEVICE rows : ${protectedExisting.length}`);
  console.log(`✅ Reserved missing KEEP rows      : ${protection.reserved.length}`);
}

main()
  .catch((err) => {
    console.error("");
    console.error("❌ ERROR:", err.message || err);
    console.error("❌ NOTHING ELSE SHOULD BE DONE UNTIL THIS IS CHECKED.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
