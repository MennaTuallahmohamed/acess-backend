/**
 * compare-all-sources.cjs
 * مقارنة شاملة بين 3 مصادر:
 *   1. ملف الإكسيل الجديد (827 جهاز)
 *   2. الداتابيز الحالية (Backend)
 *   3. ملف الـ 641 القديم
 * 
 * الهدف: إيجاد الـ 15 جهاز الناقصين وتحليل التكرارات والتشابهات
 * 
 * تشغيل:
 * node scripts\scripts\compare-all-sources.cjs
 */
const fs = require("fs");
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const EXCEL_827 = "C:\\backend\\ALL_827_NEW_DATA_AND_CLEAN_LABELS.xlsx";
const EXCEL_641 = "C:\\backend\\CORRECT_REMAINING_641_ (2).xlsx";
const REPORT_827 = "C:\\backend\\IMPORT_827_RENUMBER_REPORT.xlsx";

// ===== دوال مساعدة =====
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

function readExcel(filePath, sheetName = null) {
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  ملف غير موجود: ${filePath}`);
    return [];
  }
  const wb = XLSX.readFile(filePath, { raw: false, cellDates: false });
  const sheet = sheetName || wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: "", raw: false });
}

async function main() {
  console.log("============================================================");
  console.log(" 🔍 مقارنة شاملة: 827 إكسيل | Backend | 641 قديم");
  console.log("============================================================\n");

  // ===== 1) قراءة المصادر الثلاثة =====
  console.log(" جاري قراءة الملفات...\n");

  const excel827 = readExcel(EXCEL_827, "NEW فقط");
  console.log(`✅ ملف 827 الجديد: ${excel827.length} صف`);

  const excel641 = readExcel(EXCEL_641);
  console.log(`✅ ملف 641 القديم: ${excel641.length} صف`);

  const dbDevices = await prisma.device.findMany({
    select: {
      id: true,
      deviceCode: true,
      deviceName: true,
      serialNumber: true,
      ipAddress: true,
      lifecycleStatus: true,
      createdAt: true,
      updatedAt: true
    }
  });
  console.log(`✅ الداتابيز الحالية: ${dbDevices.length} جهاز\n`);

  // ===== 2) بناء خرائط البحث =====
  const dbBySerial = new Map();
  const dbByCode = new Map();
  dbDevices.forEach(d => {
    if (d.serialNumber) dbBySerial.set(clean(d.serialNumber).toLowerCase(), d);
    if (d.deviceCode) dbByCode.set(clean(d.deviceCode), d);
  });

  const old641BySerial = new Map();
  const old641ByCode = new Map();
  excel641.forEach((row, idx) => {
    const r = normalizeKeys(row);
    const serial = get(r, ["Serial", "Serial Number"]);
    const code = get(r, ["Device ID", "Device Code"]);
    if (serial) old641BySerial.set(clean(serial).toLowerCase(), { ...r, _row: idx + 2 });
    if (code) old641ByCode.set(clean(code), { ...r, _row: idx + 2 });
  });

  // ===== 3) تحليل ملف 827 =====
  const inExcel827 = [];
  const missingFromDB = [];
  const duplicatesInExcel = new Map();

  for (let i = 0; i < excel827.length; i++) {
    const r = normalizeKeys(excel827[i]);
    const code = get(r, ["Device ID", "Device Code"]);
    const serial = get(r, ["Serial", "Serial Number"]);
    const ip = get(r, ["IP", "IP Address"]);
    const name = get(r, ["Device Name", "Name"]);
    const excelRow = i + 2;

    const serialLower = clean(serial).toLowerCase();
    
    // تتبع التكرارات في الإكسيل نفسه
    if (serialLower) {
      if (duplicatesInExcel.has(serialLower)) {
        duplicatesInExcel.get(serialLower).push({ excelRow, code, serial, ip, name });
      } else {
        duplicatesInExcel.set(serialLower, [{ excelRow, code, serial, ip, name }]);
      }
    }

    // البحث في الداتابيز
    const foundBySerial = dbBySerial.get(serialLower);
    const foundByCode = dbByCode.get(clean(code));
    const found = foundBySerial || foundByCode;

    if (found) {
      inExcel827.push({
        excelRow, code, serial, ip, name,
        dbId: found.id,
        dbStatus: found.lifecycleStatus,
        matchType: foundBySerial ? "Serial" : "Code"
      });
    } else {
      missingFromDB.push({ excelRow, code, serial, ip, name });
    }
  }

  // ===== 4) عرض النتائج =====
  console.log("\n==========================================================================================");
  console.log(" 📊 الملخص العام");
  console.log("==========================================================================================");
  console.log(`📄 ملف 827 الجديد       : ${excel827.length} جهاز`);
  console.log(`💾 الداتابيز الحالية    : ${dbDevices.length} جهاز`);
  console.log(`📄 ملف 641 القديم       : ${excel641.length} جهاز`);
  console.log(`✅ موجود في 827 + DB   : ${inExcel827.length} جهاز`);
  console.log(`⚠️  في 827 لكن مش في DB : ${missingFromDB.length} جهاز  ← دول الناقصين!`);
  console.log(`🔁 تكرارات في 827       : ${duplicatesInExcel.size} سيريال مكرر`);
  console.log("==========================================================================================\n");

  // ===== 5) الأجهزة الناقصة (الموجودة في 827 لكن غير موجودة في الداتابيز) =====
  if (missingFromDB.length > 0) {
    console.log("⚠️  الأجهزة الناقصة (في 827 لكن مش في الداتابيز):");
    console.log("------------------------------------------------------------------------------------------");
    console.log("Excel Row | Code  | Serial               | IP               | Name          | في 641 القديم؟");
    console.log("------------------------------------------------------------------------------------------");
    
    missingFromDB.forEach(d => {
      const serialLower = clean(d.serial).toLowerCase();
      const inOld641 = old641BySerial.has(serialLower) || old641ByCode.has(clean(d.code));
      const in641Str = inOld641 ? "✅ نعم" : "❌ لا";
      
      console.log(
        `${String(d.excelRow).padEnd(9)} | ` +
        `${String(d.code).padEnd(5)} | ` +
        `${String(d.serial).padEnd(20)} | ` +
        `${String(d.ip).padEnd(16)} | ` +
        `${String(d.name).padEnd(13)} | ` +
        `${in641Str}`
      );
    });
    console.log("------------------------------------------------------------------------------------------\n");
  }

  // ===== 6) التكرارات في ملف 827 =====
  if (duplicatesInExcel.size > 0) {
    console.log("🔁 التكرارات في ملف 827 (نفس السيريال ظاهر أكثر من مرة):");
    console.log("------------------------------------------------------------------------------------------");
    
    for (const [serial, rows] of duplicatesInExcel) {
      console.log(`\n سيريال: ${serial}`);
      rows.forEach(r => {
        console.log(`   Row ${r.excelRow} | Code: ${r.code} | IP: ${r.ip} | Name: ${r.name}`);
      });
    }
    console.log("\n------------------------------------------------------------------------------------------\n");
  }

  // ===== 7) أجهزة في الداتابيز لكن مش في 827 =====
  const inDBNotIn827 = dbDevices.filter(d => {
    const serialLower = clean(d.serialNumber).toLowerCase();
    const code = clean(d.deviceCode);
    const inExcel = excel827.some(row => {
      const r = normalizeKeys(row);
      const exSerial = get(r, ["Serial", "Serial Number"]);
      const exCode = get(r, ["Device ID", "Device Code"]);
      return clean(exSerial).toLowerCase() === serialLower || clean(exCode) === code;
    });
    return !inExcel;
  });

  if (inDBNotIn827.length > 0) {
    console.log(`📦 أجهزة في الداتابيز لكن مش في ملف 827 (${inDBNotIn827.length} جهاز):`);
    console.log("------------------------------------------------------------------------------------------");
    console.log("DB ID   | Code  | Serial               | IP               | Status");
    console.log("------------------------------------------------------------------------------------------");
    
    inDBNotIn827.slice(0, 30).forEach(d => {
      console.log(
        `${String(d.id).padEnd(7)} | ` +
        `${String(d.deviceCode).padEnd(5)} | ` +
        `${String(d.serialNumber || "N/A").padEnd(20)} | ` +
        `${String(d.ipAddress || "N/A").padEnd(16)} | ` +
        `${d.lifecycleStatus}`
      );
    });
    
    if (inDBNotIn827.length > 30) {
      console.log(`... و ${inDBNotIn827.length - 30} جهاز آخر`);
    }
    console.log("------------------------------------------------------------------------------------------\n");
  }

  // ===== 8) تحليل مفصل للـ 15 جهاز الناقصين =====
  console.log("==========================================================================================");
  console.log(" 🔬 تحليل مفصل للأجهزة الناقصة");
  console.log("==========================================================================================\n");

  if (missingFromDB.length === 0) {
    console.log("✅ لا توجد أجهزة ناقصة — جميع أجهزة 827 موجودة في الداتابيز!\n");
  } else {
    console.log(`📊 عدد الأجهزة الناقصة: ${missingFromDB.length}\n`);
    
    missingFromDB.forEach((d, idx) => {
      console.log(`${idx + 1}. Row ${d.excelRow} | Code: ${d.code} | Serial: ${d.serial}`);
      console.log(`   IP: ${d.ip} | Name: ${d.name}`);
      
      const serialLower = clean(d.serial).toLowerCase();
      const inOld641 = old641BySerial.get(serialLower) || old641ByCode.get(clean(d.code));
      
      if (inOld641) {
        console.log(`   ✅ موجود في ملف 641 القديم (Row ${inOld641._row})`);
      } else {
        console.log(`   ❌ غير موجود في ملف 641 القديم`);
      }
      
      // البحث عن تشابه في السيريال
      const similarSerials = Array.from(dbBySerial.keys()).filter(s => 
        s.includes(serialLower) || serialLower.includes(s)
      );
      
      if (similarSerials.length > 0) {
        console.log(`   🔍 سيريالات مشابهة في الداتابيز: ${similarSerials.slice(0, 3).join(", ")}`);
      }
      
      console.log("");
    });
  }

  // ===== 9) الخلاصة والتوصيات =====
  console.log("==========================================================================================");
  console.log(" 💡 الخلاصة والتوصيات");
  console.log("==========================================================================================\n");
  
  console.log("1️  الأجهزة الناقصة تحتاج إلى:");
  console.log("   - التأكد من صحة السيريال والكود في ملف 827");
  console.log("   - إذا كانت صحيحة: شغّل safe-upsert-827-import.cjs --apply لرفعها");
  console.log("   - إذا كانت خاطئة: عدّلها في الإكسيل ثم ارفع\n");
  
  console.log("2️⃣  التكرارات في 827:");
  console.log("   - راجع الصفوف المكررة وصحّح السيريالات\n");
  
  console.log("3️⃣  الأجهزة في الداتابيز لكن مش في 827:");
  console.log("   - هذه أجهزة قديمة لم تُدرج في ملف 827 الجديد");
  console.log("   - قد تكون مؤرشفة أو محذوفة\n");

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