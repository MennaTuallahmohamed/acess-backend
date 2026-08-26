/**
 * rename-old-devices.cjs
 * يغير Serial و Code للأجهزة القديمة في الداتابيز
 * التي لها نفس الأكواد الموجودة في الإكسيل
 * 
 * الهدف: عندما نعيد الرفع، السكريبت لن يجد تطابقاً
 * وسيعمل INSERT للأجهزة من الإكسيل كجديدة
 */
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const EXCEL_FILE = "C:\\backend\\ALL_827_NEW_DATA_AND_CLEAN_LABELS.xlsx";

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

async function main() {
  console.log("============================================================");
  console.log(" تغيير Serial و Code للأجهزة القديمة");
  console.log("============================================================\n");

  // 1) قراءة الإكسيل
  const wb = XLSX.readFile(EXCEL_FILE, { raw: false, cellDates: false });
  const sheetName = wb.SheetNames.includes("NEW فقط") ? "NEW فقط" : wb.SheetNames[0];
  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "", raw: false });
  
  console.log(`✅ ملف الإكسيل: ${rawRows.length} صف\n`);

  // 2) جمع جميع الأكواد والسيريالات من الإكسيل
  const excelCodes = new Set();
  const excelSerials = new Set();
  
  for (const row of rawRows) {
    const r = normalizeKeys(row);
    const code = get(r, ["Device ID", "Device Code"]);
    const serial = get(r, ["Serial", "Serial Number"]);
    if (code) excelCodes.add(clean(code));
    if (serial) excelSerials.add(clean(serial).toLowerCase());
  }

  console.log(`📊 أكواد فريدة في الإكسيل: ${excelCodes.size}`);
  console.log(`📊 سيريالات فريدة في الإكسيل: ${excelSerials.size}\n`);

  // 3) جلب جميع الأجهزة من الداتابيز
  const dbDevices = await prisma.device.findMany({
    select: {
      id: true,
      deviceCode: true,
      serialNumber: true,
      deviceName: true,
      ipAddress: true
    }
  });

  console.log(`💾 أجهزة في الداتابيز: ${dbDevices.length}\n`);

  // 4) إيجاد الأجهزة التي لها نفس الأكواد أو السيريالات
  const devicesToRename = [];
  
  for (const device of dbDevices) {
    const codeMatch = excelCodes.has(clean(device.deviceCode));
    const serialMatch = device.serialNumber && 
                        excelSerials.has(clean(device.serialNumber).toLowerCase());
    
    if (codeMatch || serialMatch) {
      devicesToRename.push({
        ...device,
        matchType: codeMatch && serialMatch ? "Both" : 
                   codeMatch ? "Code" : "Serial"
      });
    }
  }

  console.log(`🔍 أجهزة مطابقة للإكسيل: ${devicesToRename.length}\n`);

  if (devicesToRename.length === 0) {
    console.log("✅ لا توجد أجهزة مطابقة - لا حاجة للتغيير");
    return;
  }

  // 5) تأكيد
  const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log("📋 أول 20 جهاز سيتم تغييرهم:");
  console.log("--------------------------------------------------------------------------------");
  devicesToRename.slice(0, 20).forEach((d, i) => {
    console.log(`${i + 1}. ID: ${d.id} | Code: ${d.deviceCode} | Serial: ${d.serialNumber} | Match: ${d.matchType}`);
  });
  if (devicesToRename.length > 20) {
    console.log(`... و ${devicesToRename.length - 20} جهاز آخر`);
  }
  console.log("--------------------------------------------------------------------------------\n");

  await new Promise((resolve) => {
    readline.question(`⚠️  هل أنت متأكد من تغيير ${devicesToRename.length} جهاز؟ (yes/no): `, (answer) => {
      readline.close();
      if (answer.toLowerCase() !== "yes") {
        console.log("\n❌ تم إلغاء العملية.");
        process.exit(0);
      }
      resolve();
    });
  });

  console.log("\n جاري التغيير...\n");

  let successCount = 0;
  let failCount = 0;

  // 6) تغيير Serial و Code
  for (const device of devicesToRename) {
    try {
      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 10000);
      const newSerial = `OLD_${device.serialNumber || "NOSERIAL"}_${timestamp}_${random}`;
      const newCode = `OLD_${device.deviceCode}_${timestamp}`;

      await prisma.device.update({
        where: { id: device.id },
        data: {
          serialNumber: newSerial,
          deviceCode: newCode,
          barcode: newCode
        }
      });

      console.log(`✅ ID: ${device.id} | Old Code: ${device.deviceCode} → New Code: ${newCode}`);
      successCount++;
    } catch (error) {
      console.error(`❌ ID: ${device.id} - ${error.message}`);
      failCount++;
    }
  }

  console.log("\n============================================================");
  console.log(" 📊 RESULT");
  console.log("============================================================");
  console.log(`✅ تم تغيير: ${successCount} / ${devicesToRename.length}`);
  console.log(`❌ فشل: ${failCount}`);
  console.log("\n💡 الخطوة التالية:");
  console.log("   node scripts\\safe-upsert-827-import.cjs --apply");
  console.log("============================================================\n");
}

main()
  .catch(err => {
    console.error("❌ FATAL ERROR:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });