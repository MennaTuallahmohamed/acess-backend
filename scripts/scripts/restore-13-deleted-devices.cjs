
/**
 * restore-13-deleted-devices.cjs (النسخة النهائية المصححة)
 * يستعيد بيانات الأجهزة المحذوفة ويدع قاعدة البيانات تولد الـ ID تلقائياً
 */
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const BACKUP_FILE = path.join(__dirname, "deleted-devices-backup.json");

async function main() {
  console.log("============================================================");
  console.log(" RESTORE DELETED DEVICES (FINAL FIX)");
  console.log("============================================================\n");

  if (!fs.existsSync(BACKUP_FILE)) {
    console.error(`❌ ملف الـ backup مش موجود: ${BACKUP_FILE}`);
    process.exit(1);
  }

  const deletedDevices = JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8"));
  console.log(`✅ تم قراءة ${deletedDevices.length} جهاز من ملف backup\n`);

  // جلب قيم افتراضية للحقول الإلزامية
  const defaultDeviceType = await prisma.deviceType.findFirst();
  const defaultLocation = await prisma.location.findFirst();

  if (!defaultDeviceType || !defaultLocation) {
    console.error("❌ لم يتم العثور على DeviceType أو Location في الداتابيز.");
    process.exit(1);
  }

  let restoredCount = 0;
  let failedCount = 0;

  for (const deviceData of deletedDevices) {
    try {
      // التحقق من وجود الجهاز بناءً على السيريال أو الكود (لأن الـ ID سيتغير)
      const existing = await prisma.device.findFirst({
        where: {
          OR: [
            { serialNumber: deviceData.serialNumber },
            { deviceCode: deviceData.deviceCode }
          ]
        }
      });

      if (existing) {
        console.log(`⚠️  الجهاز (Code: ${deviceData.deviceCode}) موجود أصلاً — متخطي.\n`);
        continue;
      }

      console.log(`🔹 استعادة الجهاز: Code: ${deviceData.deviceCode} | Serial: ${deviceData.serialNumber}`);

      // ✅ الحل: حذف id, createdAt, updatedAt والسماح للداتابيز بتوليدها
      await prisma.device.create({
        data: {
          deviceCode: deviceData.deviceCode,
          deviceName: deviceData.deviceName,
          serialNumber: deviceData.serialNumber,
          ipAddress: deviceData.ipAddress,
          lifecycleStatus: deviceData.lifecycleStatus,
          barcode: deviceData.barcode,
          deviceType: {
            connect: { id: defaultDeviceType.id }
          },
          location: {
            connect: { id: defaultLocation.id }
          }
        }
      });

      console.log(`   ✅ تم استعادة الجهاز بنجاح (تم تعيين ID جديد تلقائياً).\n`);
      restoredCount++;

    } catch (error) {
      console.error(`   ❌ فشل استعادة الجهاز (Code: ${deviceData.deviceCode}): ${error.message}\n`);
      failedCount++;
    }
  }

  console.log("============================================================");
  console.log(" RESULT");
  console.log("============================================================");
  console.log(`✅ Restored devices : ${restoredCount}`);
  console.log(`❌ Failed devices   : ${failedCount}`);
  
  console.log("\n💡 الخطوة التالية (مهمة جداً):");
  console.log("1. تأكد من أن العدد زاد:");
  console.log('   node -e "const {PrismaClient}=require(\'@prisma/client\'); const p=new PrismaClient(); p.device.count().then(c=>{console.log(\'Total devices:\',c);p.$disconnect()})"');
  console.log("2. اذهب للمدير واحصل على بيانات الـ 13 جهاز الصحيحة (Serial & Code الجديدين).");
  console.log("3. افتح ملف الإكسيل ALL_827_NEW_DATA_AND_CLEAN_LABELS.xlsx وعدّل بيانات هذه الأجهزة.");
  console.log("4. شغل أمر الرفع: node scripts\\safe-upsert-827-import.cjs --apply");
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