/**
 * rename-14-devices.cjs
 * يغير Serial و Code لأول 14 جهاز من قائمة Updated
 * حتى يعتبرهم السكريبت أجهزة جديدة عند إعادة الرفع
 * 
 * تشغيل:
 * node scripts\rename-14-devices.cjs
 */
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const REPORT_FILE = "C:\\backend\\SAFE_IMPORT_827_REPORT.xlsx";

async function main() {
  console.log("============================================================");
  console.log(" تغيير Serial و Code لأول 14 جهاز من قائمة Updated");
  console.log("============================================================\n");

  // 1) قراءة التقرير
  const wb = XLSX.readFile(REPORT_FILE, { raw: false, cellDates: false });
  const updatedSheet = wb.Sheets["Updated"];
  const updatedDevices = updatedSheet ? XLSX.utils.sheet_to_json(updatedSheet) : [];
  
  console.log(`✅ إجمالي الأجهزة في قائمة Updated: ${updatedDevices.length}\n`);

  // 2) أخذ أول 14 جهاز
  const targetDevices = updatedDevices.slice(0, 14);
  
  console.log("📋 الأجهزة التي سيتم تغييرها:");
  console.log("--------------------------------------------------------------------------------");
  console.log("DB ID   | Code");
  console.log("--------------------------------------------------------------------------------");
  targetDevices.forEach((d, idx) => {
    console.log(`${idx + 1}. ${String(d.deviceId).padEnd(7)} | ${d.code}`);
  });
  console.log("--------------------------------------------------------------------------------\n");

  // 3) تغيير Serial و Code
  let successCount = 0;
  let failedCount = 0;

  for (const device of targetDevices) {
    try {
      const dbId = Number(device.deviceId);
      const oldCode = device.code;
      
      console.log(`🔹 Device ID: ${dbId} | Code القديم: ${oldCode}`);

      // جلب البيانات الحالية
      const currentDevice = await prisma.device.findUnique({
        where: { id: dbId },
        select: {
          serialNumber: true,
          deviceCode: true,
          deviceName: true
        }
      });

      if (!currentDevice) {
        console.log(`   ⚠️  الجهاز غير موجود — متخطي.\n`);
        continue;
      }

      // توليد Serial و Code جديدين
      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 10000);
      const newSerial = `OLD_${currentDevice.serialNumber || "NOSERIAL"}_${timestamp}_${random}`;
      const newCode = `OLD_${oldCode}_${timestamp}`;
      const newBarcode = `OLD_${currentDevice.deviceCode || oldCode}_${timestamp}`;

      console.log(`   Serial القديم: ${currentDevice.serialNumber || "N/A"}`);
      console.log(`   Serial الجديد: ${newSerial}`);
      console.log(`   Code الجديد: ${newCode}\n`);

      // تحديث الجهاز
      await prisma.device.update({
        where: { id: dbId },
        data: {
          serialNumber: newSerial,
          deviceCode: newCode,
          barcode: newBarcode
        }
      });

      console.log(`   ✅ تم التغيير بنجاح.\n`);
      successCount++;
    } catch (error) {
      console.error(`   ❌ فشل: ${error.message}\n`);
      failedCount++;
    }
  }

  console.log("============================================================");
  console.log(" RESULT");
  console.log("============================================================");
  console.log(`✅ تم تغيير: ${successCount} / 14`);
  console.log(`❌ فشل: ${failedCount}`);
  
  console.log("\n💡 الخطوة التالية:");
  console.log("1. شغّل أمر الرفع مرة أخرى:");
  console.log("   node scripts\\safe-upsert-827-import.cjs --apply");
  console.log("2. النتيجة: سيتم اعتبار الـ 14 جهاز كأجهزة جديدة (Inserted)");
  console.log("3. العدد سيزيد بـ 14 جهاز ✅");
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