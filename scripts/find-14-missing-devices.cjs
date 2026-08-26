/**
 * find-14-missing-devices.cjs
 * يقارن بين ملف الإكسيل (827 جهاز) والداتابيز (1454 جهاز)
 * ويحدد الأجهزة الناقصة التي يجب إضافتها لزيادة العدد إلى 1468
 * 
 * تشغيل:
 * node scripts\find-14-missing-devices.cjs
 */
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const EXCEL_FILE = "C:\\backend\\ALL_827_NEW_DATA_AND_CLEAN_LABELS.xlsx";
const REPORT_FILE = "C:\\backend\\SAFE_IMPORT_827_REPORT.xlsx";

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
  console.log(" 🔍 تحديد الـ 14 جهاز الناقصة");
  console.log("============================================================\n");

  // 1) قراءة الإكسيل
  const wb = XLSX.readFile(EXCEL_FILE, { raw: false, cellDates: false });
  const sheetName = wb.SheetNames.includes("NEW فقط") ? "NEW فقط" : wb.SheetNames[0];
  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "", raw: false });
  console.log(`✅ ملف الإكسيل: ${rawRows.length} صف\n`);

  // 2) قراءة الداتابيز
  const dbDevices = await prisma.device.findMany({
    select: {
      id: true,
      deviceCode: true,
      deviceName: true,
      serialNumber: true,
      ipAddress: true,
      lifecycleStatus: true
    }
  });
  console.log(`✅ الداتابيز: ${dbDevices.length} جهاز\n`);

  // 3) بناء خرائط البحث للداتابيز
  const dbBySerial = new Map();
  const dbByCode = new Map();
  dbDevices.forEach(d => {
    if (d.serialNumber) dbBySerial.set(clean(d.serialNumber).toLowerCase(), d);
    if (d.deviceCode) dbByCode.set(clean(d.deviceCode), d);
  });

  // 4) قراءة التقرير لتحديد الأجهزة التي تم تحديثها
  const wbReport = XLSX.readFile(REPORT_FILE, { raw: false, cellDates: false });
  const updatedSheet = wbReport.Sheets["Updated"];
  const updatedDevices = updatedSheet ? XLSX.utils.sheet_to_json(updatedSheet) : [];
  console.log(`✅ الأجهزة التي تم تحديثها (Updated): ${updatedDevices.length}\n`);

  // 5) بناء Map للأجهزة المحدّثة
  const updatedByDbId = new Map();
  updatedDevices.forEach(d => {
    updatedByDbId.set(Number(d.deviceId), d);
  });

  // 6) البحث عن الأجهزة في الإكسيل التي تم تحديثها (موجودة في الداتابيز مسبقاً)
  const updatedInExcel = [];
  const missingFromDB = [];

  for (let i = 0; i < rawRows.length; i++) {
    const r = normalizeKeys(rawRows[i]);
    const code = get(r, ["Device ID", "Device Code"]);
    const serial = get(r, ["Serial", "Serial Number"]);
    const ip = get(r, ["IP", "IP Address"]);
    const name = get(r, ["Device Name", "Name"]);
    const excelRow = i + 2;

    const serialLower = clean(serial).toLowerCase();
    const foundBySerial = dbBySerial.get(serialLower);
    const foundByCode = dbByCode.get(clean(code));
    const found = foundBySerial || foundByCode;

    if (found && updatedByDbId.has(found.id)) {
      // هذا الجهاز تم تحديثه (موجود مسبقاً)
      updatedInExcel.push({
        excelRow,
        code,
        serial,
        ip,
        name,
        dbId: found.id,
        dbCode: found.deviceCode,
        dbSerial: found.serialNumber,
        dbIp: found.ipAddress,
        dbStatus: found.lifecycleStatus
      });
    } else if (!found) {
      // هذا الجهاز غير موجود في الداتابيز
      missingFromDB.push({
        excelRow,
        code,
        serial,
        ip,
        name
      });
    }
  }

  console.log("==========================================================================================");
  console.log("  التحليل:");
  console.log("==========================================================================================");
  console.log(`✅ أجهزة تم تحديثها (موجودة مسبقاً): ${updatedInExcel.length}`);
  console.log(`️  أجهزة غير موجودة في الداتابيز: ${missingFromDB.length}`);
  console.log(`🎯 العدد الحالي في الداتابيز: ${dbDevices.length}`);
  console.log(` العدد المطلوب: 1468`);
  console.log(`🎯 الفرق: ${1468 - dbDevices.length} جهاز\n`);

  // 7) عرض أول 14 جهاز من قائمة Updated (التي تم تحديثها بدلاً من إضافتها)
  const targetDevices = updatedInExcel.slice(0, 14);

  console.log("==========================================================================================");
  console.log(" 🔍 أول 14 جهاز من قائمة Updated (يمكن تحويلها إلى أجهزة جديدة):");
  console.log("==========================================================================================\n");

  for (let i = 0; i < targetDevices.length; i++) {
    const d = targetDevices[i];
    console.log(`${i + 1}. Excel Row: ${d.excelRow} | Code: ${d.code} | DB ID: ${d.dbId}`);
    console.log(`   📄 من الإكسيل:`);
    console.log(`      Serial: ${d.serial}`);
    console.log(`      IP: ${d.ip}`);
    console.log(`      Name: ${d.name}`);
    console.log(`   💾 من الداتابيز:`);
    console.log(`      Serial: ${d.dbSerial}`);
    console.log(`      IP: ${d.dbIp}`);
    console.log(`      Status: ${d.dbStatus}`);
    console.log(`   🔍 التشابه:`);
    if (clean(d.serial).toLowerCase() === clean(d.dbSerial).toLowerCase()) {
      console.log(`      ✅ نفس السيريال`);
    } else {
      console.log(`      ⚠️  سيريال مختلف`);
    }
    if (clean(d.code) === clean(d.dbCode)) {
      console.log(`      ✅ نفس الكود`);
    } else {
      console.log(`      ⚠️  كود مختلف`);
    }
    console.log("");
  }

  console.log("==========================================================================================");
  console.log(" 💡 الحل:");
  console.log("==========================================================================================");
  console.log("لزيادة العدد من 1454 إلى 1468، يجب:");
  console.log("1. اختيار 14 جهاز من القائمة أعلاه");
  console.log("2. حذفهم من الداتابيز (مع فك ارتباط التفتيشات)");
  console.log("3. إعادة رفعهم من الإكسيل كـ أجهزة جديدة (INSERT)");
  console.log("");
  console.log("أو:");
  console.log("1. تعديل Serial Number و Device Code لهذه الأجهزة في الإكسيل");
  console.log("2. إعادة الرفع ليعتبرهم النظام أجهزة جديدة");
  console.log("==========================================================================================\n");
}

main()
  .catch(err => {
    console.error("❌ FATAL ERROR:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });