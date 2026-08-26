/**
 * delete-14-devices.cjs
 * يحذف أول 14 جهاز من قائمة Updated في تقرير SAFE_IMPORT_827_REPORT.xlsx
 * مع فك ارتباط التفتيشات (Inspections) و DeviceStatusHistory
 * 
 * الهدف: عند إعادة الرفع، سيعتبر النظام هذه الأجهزة أجهزة جديدة (INSERT)
 *        وبالتالي سيزيد العدد من 1454 إلى 1468
 * 
 * تشغيل:
 * node scripts\delete-14-devices.cjs
 */
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const REPORT_FILE = "C:\\backend\\SAFE_IMPORT_827_REPORT.xlsx";

async function main() {
  console.log("============================================================");
  console.log(" حذف أول 14 جهاز من قائمة Updated");
  console.log("============================================================\n");

  // 1) قراءة التقرير
  const wb = XLSX.readFile(REPORT_FILE, { raw: false, cellDates: false });
  const updatedSheet = wb.Sheets["Updated"];
  const updatedDevices = updatedSheet ? XLSX.utils.sheet_to_json(updatedSheet) : [];
  
  console.log(`✅ إجمالي الأجهزة في قائمة Updated: ${updatedDevices.length}\n`);

  if (updatedDevices.length < 14) {
    console.error(`❌ عدد الأجهزة في قائمة Updated أقل من 14 (${updatedDevices.length})`);
    process.exit(1);
  }

  // 2) أخذ أول 14 جهاز
  const targetDevices = updatedDevices.slice(0, 14);
  
  console.log("📋 الأجهزة التي سيتم حذفها:");
  console.log("--------------------------------------------------------------------------------");
  console.log("DB ID   | Code");
  console.log("--------------------------------------------------------------------------------");
  targetDevices.forEach(d => {
    console.log(`${String(d.deviceId).padEnd(7)} | ${d.code}`);
  });
  console.log("--------------------------------------------------------------------------------\n");

  // تأكيد قبل الحذف
  const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await new Promise((resolve) => {
    readline.question("⚠️  هل أنت متأكد من حذف هذه الأجهزة الـ 14؟ (yes/no): ", (answer) => {
      readline.close();
      if (answer.toLowerCase() !== "yes") {
        console.log("\n❌ تم إلغاء العملية.");
        process.exit(0);
      }
      resolve();
    });
  });

  console.log("\n⏳ جاري الحذف...\n");

  let deletedCount = 0;
  let failedCount = 0;
  let totalUnlinkedInspections = 0;
  let totalUnlinkedHistory = 0;

  // 3) حذف الأجهزة
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
  console.log(" RESULT");
  console.log("============================================================");
  console.log(`✅ Deleted devices         : ${deletedCount} / 14`);
  console.log(`❌ Failed devices           : ${failedCount}`);
  console.log(`🔗 Unlinked inspections     : ${totalUnlinkedInspections}`);
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