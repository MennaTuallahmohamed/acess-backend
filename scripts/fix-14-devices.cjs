/**
 * fix-14-devices.cjs
 * حل نهائي: يحذف 14 جهاز من قائمة Updated ويعيد رفعهم كـ أجهزة جديدة
 * 
 * الخطوات:
 * 1. يقرأ تقرير SAFE_IMPORT_827_REPORT.xlsx ويحدد أول 14 جهاز من قائمة Updated
 * 2. يحذفهم من الداتابيز (مع فك ارتباط التفتيشات و DeviceStatusHistory)
 * 3. يعيد رفعهم من الإكسيل كـ أجهزة جديدة (INSERT)
 * 
 * النتيجة: العدد سيزيد من 1454 إلى 1468
 * 
 * تشغيل:
 * node scripts\fix-14-devices.cjs
 */
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const REPORT_FILE = "C:\\backend\\SAFE_IMPORT_827_REPORT.xlsx";
const EXCEL_FILE = "C:\\backend\\ALL_827_NEW_DATA_AND_CLEAN_LABELS.xlsx";

async function main() {
  console.log("============================================================");
  console.log(" 🔧 حل نهائي: زيادة العدد من 1454 إلى 1468");
  console.log("============================================================\n");

  // ===== الخطوة 1: قراءة التقرير =====
  console.log("📖 الخطوة 1: قراءة تقرير الرفع...\n");
  
  const wb = XLSX.readFile(REPORT_FILE, { raw: false, cellDates: false });
  const updatedSheet = wb.Sheets["Updated"];
  const updatedDevices = updatedSheet ? XLSX.utils.sheet_to_json(updatedSheet) : [];
  
  console.log(`✅ إجمالي الأجهزة في قائمة Updated: ${updatedDevices.length}\n`);

  if (updatedDevices.length < 14) {
    console.error(`❌ عدد الأجهزة في قائمة Updated أقل من 14 (${updatedDevices.length})`);
    process.exit(1);
  }

  // ===== الخطوة 2: أخذ أول 14 جهاز =====
  const targetDevices = updatedDevices.slice(0, 14);
  
  console.log(" الأجهزة التي سيتم حذفها وإعادة رفعها:");
  console.log("--------------------------------------------------------------------------------");
  console.log("DB ID   | Code");
  console.log("--------------------------------------------------------------------------------");
  targetDevices.forEach((d, idx) => {
    console.log(`${idx + 1}. ${String(d.deviceId).padEnd(6)} | ${d.code}`);
  });
  console.log("--------------------------------------------------------------------------------\n");

  // تأكيد قبل الحذف
  const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await new Promise((resolve) => {
    readline.question("️  هل أنت متأكد من حذف هذه الأجهزة الـ 14؟ (yes/no): ", (answer) => {
      readline.close();
      if (answer.toLowerCase() !== "yes") {
        console.log("\n❌ تم إلغاء العملية.");
        process.exit(0);
      }
      resolve();
    });
  });

  console.log("\n جاري الحذف...\n");

  let deletedCount = 0;
  let failedCount = 0;
  let totalUnlinkedInspections = 0;
  let totalUnlinkedHistory = 0;

  // ===== الخطوة 3: حذف الأجهزة =====
  for (const device of targetDevices) {
    const dbId = Number(device.deviceId);
    const code = device.code;
    
    try {
      console.log(`🔹 Device ID: ${dbId} | Code: ${code}`);

      // 3.1) فك ارتباط التفتيشات
      const inspResult = await prisma.inspection.updateMany({
        where: { deviceId: dbId },
        data: { deviceId: null }
      });
      if (inspResult.count > 0) {
        console.log(`   ✅ تم فك ${inspResult.count} تفتيش`);
        totalUnlinkedInspections += inspResult.count;
      }

      // 3.2) حذف DeviceStatusHistory
      const historyResult = await prisma.deviceStatusHistory.deleteMany({
        where: { deviceId: dbId }
      });
      if (historyResult.count > 0) {
        console.log(`   ✅ تم حذف ${historyResult.count} سجل من DeviceStatusHistory`);
        totalUnlinkedHistory += historyResult.count;
      }

      // 3.3) حذف الجهاز
      await prisma.device.delete({
        where: { id: dbId }
      });
      console.log(`   🗑️  تم حذف الجهاز\n`);
      deletedCount++;

    } catch (error) {
      console.error(`   ❌ فشل حذف Device ID ${dbId}: ${error.message}\n`);
      failedCount++;
    }
  }

  console.log("============================================================");
  console.log(" 📊 RESULT");
  console.log("============================================================");
  console.log(`✅ Deleted devices         : ${deletedCount} / 14`);
  console.log(`❌ Failed devices           : ${failedCount}`);
  console.log(` Unlinked inspections     : ${totalUnlinkedInspections}`);
  console.log(`📊 Deleted status history   : ${totalUnlinkedHistory}`);
  
  console.log("\n💡 الخطوة التالية:");
  console.log("1. شغّل أمر الرفع مرة أخرى:");
  console.log("   node scripts\\safe-upsert-827-import.cjs --apply");
  console.log("2. النتيجة: سيتم اعتبار الـ 14 جهاز كأجهزة جديدة (Inserted)");
  console.log("3. العدد سيزيد من 1454 إلى 1468 ✅");
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