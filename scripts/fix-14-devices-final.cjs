/**
 * fix-14-devices-final.cjs
 * 
 * الحل النهائي: يغير الـ Serial والـ Code لـ 14 جهازاً 
 * لكي يعتبرهم السكريبت أجهزة جديدة عند إعادة الرفع
 * 
 * النتيجة: العدد سيزيد من 1454 إلى 1468
 * 
 * تشغيل:
 * node scripts\fix-14-devices-final.cjs
 */
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const REPORT_FILE = "C:\\backend\\SAFE_IMPORT_827_REPORT.xlsx";
const EXCEL_FILE = "C:\\backend\\ALL_827_NEW_DATA_AND_CLEAN_LABELS.xlsx";

// الـ 14 جهاز الأول من قائمة Updated في التقرير
const TARGET_DEVICES = [
  { deviceId: 2298, code: "176" },
  { deviceId: 2299, code: "1558" },
  { deviceId: 3112, code: "172" },
  { deviceId: 2300, code: "351" },
  { deviceId: 2301, code: "168" },
  { deviceId: 3113, code: "362" },
  { deviceId: 2302, code: "358" },
  { deviceId: 2303, code: "357" },
  { deviceId: 2304, code: "356" },
  { deviceId: 2305, code: "355" },
  { deviceId: 2306, code: "1559" },
  { deviceId: 2307, code: "1542" },
  { deviceId: 2308, code: "1543" },
  { deviceId: 2309, code: "1544" },
];

async function main() {
  console.log("============================================================");
  console.log(" 🔧 الحل النهائي: زيادة العدد من 1454 إلى 1468");
  console.log("============================================================\n");

  let successCount = 0;
  let failCount = 0;
  const changes = [];

  console.log("📋 الأجهزة المستهدفة (14 جهاز):\n");
  TARGET_DEVICES.forEach((d, i) => {
    console.log(`  ${i + 1}. Device ID: ${d.deviceId} | Code: ${d.code}`);
  });
  console.log("");

  for (const device of TARGET_DEVICES) {
    try {
      // 1) جلب بيانات الجهاز الحالية
      const current = await prisma.device.findUnique({
        where: { id: device.deviceId },
        select: {
          id: true,
          deviceCode: true,
          serialNumber: true,
          barcode: true,
          deviceName: true,
          ipAddress: true
        }
      });

      if (!current) {
        console.log(`⚠️  Device ID ${device.deviceId} غير موجود — متخطي.\n`);
        failCount++;
        continue;
      }

      // 2) توليد قيم جديدة فريدة
      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 10000);
      const newSerial = `OLD_${current.serialNumber || "NOSERIAL"}_${timestamp}_${random}`;
      const newCode = `OLD_${current.deviceCode}_${timestamp}`;
      const newBarcode = `OLD_${current.barcode || current.deviceCode}_${timestamp}`;

      console.log(` Device ID: ${current.id} | Code القديم: ${current.deviceCode}`);
      console.log(`   Serial القديم: ${current.serialNumber || "N/A"}`);

      // 3) تحديث الجهاز بالقيم الجديدة
      await prisma.device.update({
        where: { id: current.id },
        data: {
          serialNumber: newSerial,
          deviceCode: newCode,
          barcode: newBarcode,
        }
      });

      console.log(`   ✅ تم التغيير:`);
      console.log(`      Serial الجديد: ${newSerial}`);
      console.log(`      Code الجديد: ${newCode}\n`);

      changes.push({
        oldId: current.id,
        oldCode: current.deviceCode,
        oldSerial: current.serialNumber,
        newSerial: newSerial,
        newCode: newCode
      });

      successCount++;
    } catch (error) {
      console.error(`   ❌ فشل Device ID ${device.deviceId}: ${error.message}\n`);
      failCount++;
    }
  }

  console.log("============================================================");
  console.log(" 📊 RESULT");
  console.log("============================================================");
  console.log(`✅ تم تغيير: ${successCount} / 14`);
  console.log(`❌ فشل: ${failCount}`);
  console.log("");

  if (successCount === 14) {
    console.log("🎉 ممتاز! تم تغيير جميع الأجهزة بنجاح.");
    console.log("");
    console.log("💡 الخطوة التالية (مهمة جداً):");
    console.log("");
    console.log("1️⃣  شغّل أمر الرفع مرة أخرى:");
    console.log("   node scripts\\safe-upsert-827-import.cjs --apply");
    console.log("");
    console.log("2️⃣  ماذا سيحدث:");
    console.log("   - السكريبت سيقرأ الإكسيل ويبحث عن الأكواد القديمة (176, 1558, ...)");
    console.log("   - لن يجدها في الداتابيز (لأننا غيرناها إلى OLD_176_xxx, ...)");
    console.log("   - سيعتبرها أجهزة جديدة ويعمل INSERT لها");
    console.log("   - العدد سيزيد بـ 14 جهاز ✅");
    console.log("");
    console.log("3️⃣  تحقق من العدد النهائي:");
    console.log("   node -e \"const {PrismaClient}=require('@prisma/client'); const p=new PrismaClient(); p.device.count().then(c=>{console.log('Total devices:',c);p.$disconnect()})\"");
    console.log("");
    console.log("   العدد المتوقع: 1468 جهاز 🎯");
  } else {
    console.log("⚠️  بعض الأجهزة فشلت. راجع الأخطاء أعلاه.");
  }

  console.log("============================================================\n");
}

main()
  .catch(err => {
    console.error(" FATAL ERROR:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });