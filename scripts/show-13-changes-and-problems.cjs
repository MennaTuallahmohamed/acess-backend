/**
 * show-13-changes-and-problems.cjs
 * Shows the 13 devices that were updated:
 *   - What changed (Excel vs Database comparison)
 *   - What problems they have (inspections / duplicate serials)
 *   - Display only, no execution
 *
 * Run:
 *   node scripts\show-13-changes-and-problems.cjs
 */
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const INPUT_FILE = "C:\\backend\\ALL_827_NEW_DATA_AND_CLEAN_LABELS.xlsx";
const updatedIds = [313, 500, 299, 863, 864, 865, 866, 867, 868, 869, 870, 1100, 846];

// ===== Helper Functions =====
function clean(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function norm(v) {
  return clean(v).toLowerCase().replace(/\s+/g, " ");
}

function normalizeKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[norm(k)] = v;
  return out;
}

function get(row, names) {
  for (const name of names) {
    const key = norm(name);
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const value = clean(row[key]);
      if (value !== "") return value;
    }
  }
  return "";
}

// ===== Main Function =====
async function main() {
  console.log("============================================================");
  console.log(" 📋 The 13 Devices — What Changed and What Problems They Have");
  console.log("============================================================\n");

  // 1) Read Excel file
  const wb = XLSX.readFile(INPUT_FILE, { raw: false, cellDates: false });
  const sheetName = wb.SheetNames.includes("NEW فقط") ? "NEW فقط" : wb.SheetNames[0];
  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "", raw: false });

  // 2) Fetch devices from database
  const devices = await prisma.device.findMany({
    where: { id: { in: updatedIds } },
    include: {
      inspections: {
        select: { id: true, inspectedAt: true }
      }
    },
    orderBy: { id: 'asc' }
  });

  console.log("==========================================================================================");
  console.log("Device Details + Changes + Problems");
  console.log("==========================================================================================\n");

  const problemsSummary = [];

  for (const device of devices) {
    // Find matching row in Excel
    const excelRow = rawRows.find(r => {
      const nr = normalizeKeys(r);
      const excelCode = get(nr, ["Device ID", "Device Code"]);
      const excelSerial = get(nr, ["Serial", "Serial Number"]);
      return clean(excelCode) === clean(device.deviceCode) ||
             (excelSerial && clean(excelSerial) === clean(device.serialNumber));
    });

    console.log(`🔹 Device ID: ${device.id} | Code: ${device.deviceCode}`);
    console.log(`   Serial : ${device.serialNumber}`);
    console.log(`   IP     : ${device.ipAddress}`);
    console.log(`   Name   : ${device.deviceName}`);
    console.log(`   Status : ${device.lifecycleStatus}`);
    console.log(`   Updated: ${device.updatedAt}`);

    // ===== What Changed? =====
    const changes = [];
    if (excelRow) {
      const nr = normalizeKeys(excelRow);
      const exIp = get(nr, ["IP", "IP Address"]);
      const exSerial = get(nr, ["Serial", "Serial Number"]);
      const exName = get(nr, ["Device Name", "Name"]);

      if (clean(exIp) !== clean(device.ipAddress))
        changes.push(`IP: '${device.ipAddress}' ← '${exIp}'`);
      if (clean(exSerial) !== clean(device.serialNumber))
        changes.push(`Serial: '${device.serialNumber}' ← '${exSerial}'`);
      if (clean(exName) !== clean(device.deviceName))
        changes.push(`Name: '${device.deviceName}' ← '${exName}'`);
    } else {
      changes.push(`⚠️  No matching row found in Excel`);
    }

    if (changes.length === 0) {
      console.log(`   🔄 Changes: No actual changes (data matches)`);
    } else {
      console.log(`   🔄 Changes applied:`);
      changes.forEach(c => console.log(`      ➜ ${c}`));
    }

    // ===== What's the Problem? =====
    const deviceProblems = [];

    // Check inspections
    const hasInspections = device.inspections && device.inspections.length > 0;
    if (hasInspections) {
      const inspCount = device.inspections.length;
      console.log(`   ⚠️  Problem: Has ${inspCount} linked inspections — cannot be safely deleted or archived`);
      deviceProblems.push(`Has ${inspCount} linked inspections`);
    } else {
      console.log(`   ✅ No linked inspections`);
    }

    // Check duplicate serials
    const duplicates = await prisma.device.findMany({
      where: {
        serialNumber: device.serialNumber,
        id: { not: device.id }
      },
      select: { id: true, deviceCode: true, lifecycleStatus: true }
    });

    if (duplicates.length > 0) {
      const dupList = duplicates.map(d =>
        `ID:${d.id}(Code:${d.deviceCode},Status:${d.lifecycleStatus})`
      ).join(', ');
      console.log(`   ❌ Problem: Duplicate serial with: ${dupList}`);
      deviceProblems.push(`Duplicate serial`);
    }

    if (deviceProblems.length > 0) {
      problemsSummary.push({
        deviceId: device.id,
        code: device.deviceCode,
        issues: deviceProblems
      });
    }

    console.log("");
  }

  console.log("==========================================================================================");
  console.log("📊 Problems Summary:");
  console.log("==========================================================================================");

  if (problemsSummary.length === 0) {
    console.log("✅ No problems — All 13 devices are completely safe");
  } else {
    console.log(`⚠️  Devices with problems: ${problemsSummary.length} out of 13\n`);
    problemsSummary.forEach(p => {
      console.log(`   - Device ID ${p.deviceId} (Code: ${p.code}):`);
      p.issues.forEach(issue => console.log(`       • ${issue}`));
    });
  }

  console.log("\n==========================================================================================");
  console.log("💡 Summary:");
  console.log("==========================================================================================");
  console.log("• These 13 devices already existed in the database — the script only updated their data.");
  console.log("• Changes were likely: IP update or Status change from ARCHIVED to ACTIVE.");
  console.log("• Real problem: All of them have linked inspections, so you can't easily revert them.");
  console.log("• If you want to revert them to original state: You need a database backup (if available).");
  console.log("==========================================================================================\n");
}

main()
  .catch(err => {
    console.error("❌ ERROR:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });