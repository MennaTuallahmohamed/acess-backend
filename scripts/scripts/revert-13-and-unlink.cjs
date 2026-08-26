/**
 * revert-13-and-unlink.cjs
 * 1. يحفظ البيانات الأصلية للـ 13 جهاز في ملف JSON
 * 2. يفك ارتباط التفتيشات + DeviceStatusHistory
 * 3. يحذف الأجهزة من الداتابيز
 *
 * تشغيل:
 * node scripts\scripts\revert-13-and-unlink.cjs
 */
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const targetDeviceIds = [299, 313, 500, 846, 863, 864, 865, 866, 867, 868, 869, 870, 1100];

async function main() {
  console.log("============================================================");
  console.log(" REVERT 13 DEVICES — SAVE + UNLINK + DELETE");
  console.log("============================================================\n");

  // 1) جلب وحفظ البيانات الأصلية
  console.log("⏳ جاري جلب البيانات الأصلية للأجهزة...\n");
  
  const originalDevices = await prisma.device.findMany({
    where: { id: { in: targetDeviceIds } },
    select: {
      id: true,
      deviceCode: true,
      deviceName: true,
      serialNumber: true,
      ipAddress: true,
      lifecycleStatus: true,
      barcode: true,
      createdAt: true,
      updatedAt: true
    }
  });

  // حفظ البيانات في ملف JSON
  const backupFile = path.join(__dirname, "deleted-devices-backup.json");
  fs.writeFileSync(backupFile, JSON.stringify(originalDevices, null, 2), "utf8");
  console.log(`✅ تم حفظ البيانات الأصلية في: ${backupFile}\n`);

  console.log("📋 الأجهزة اللي هتتحذف (احفظ البيانات دي):");
  console.log("--------------------------------------------------------------------------------");
  console.log("ID    | Code  | Serial               | IP               | Status");
  console.log("--------------------------------------------------------------------------------");
  originalDevices.forEach(d => {
    console.log(
      `${String(d.id).padEnd(5)} | ${String(d.deviceCode).padEnd(5)} | ` +
      `${String(d.serialNumber || "N/A").padEnd(20)} | ` +
      `${String(d.ipAddress || "N/A").padEnd(16)} | ${d.lifecycleStatus}`
    );
  });
  console.log("--------------------------------------------------------------------------------\n");

  // 2) حذف الأجهزة مع فك الارتباطات
  let totalUnlinkedInspections = 0;
  let totalUnlinkedHistory = 0;
  let totalDeleted = 0;

  for (const deviceId of targetDeviceIds) {
    try {
      const device = originalDevices.find(d => d.id === deviceId);
      
      if (!device) {
        console.log(`⚠️  Device ID ${deviceId} مش موجود — متخطي.\n`);
        continue;
      }

      console.log(` Device ID: ${device.id} | Code: ${device.deviceCode}`);

      // فك ارتباط التفتيشات
      const inspResult = await prisma.inspection.updateMany({
        where: { deviceId: deviceId },
        data: { deviceId: null }
      });
      if (inspResult.count > 0) {
        console.log(`   ✅ تم فك ${inspResult.count} تفتيش.`);
        totalUnlinkedInspections += inspResult.count;
      }

      // حذف سجلات DeviceStatusHistory
      const historyResult = await prisma.deviceStatusHistory.deleteMany({
        where: { deviceId: deviceId }
      });
      if (historyResult.count > 0) {
        console.log(`   ✅ تم حذف ${historyResult.count} سجل من DeviceStatusHistory.`);
        totalUnlinkedHistory += historyResult.count;
      }

      // حذف الجهاز
      await prisma.device.delete({
        where: { id: deviceId }
      });
      console.log(`   🗑️  تم حذف الجهاز.\n`);
      totalDeleted++;

    } catch (error) {
      console.error(`   ❌ فشل Device ID ${deviceId}: ${error.message}\n`);
    }
  }

  console.log("============================================================");
  console.log(" RESULT");
  console.log("============================================================");
  console.log(`✅ Deleted devices         : ${totalDeleted} / 13`);
  console.log(`✅ Unlinked inspections     : ${totalUnlinkedInspections}`);
  console.log(`✅ Deleted status history   : ${totalUnlinkedHistory}`);
  console.log(`💾 Backup file             : ${backupFile}`);
  console.log("\n💡 الخطوة التالية:");
  console.log("1. افتح ملف الإكسيل ALL_827_NEW_DATA_AND_CLEAN_LABELS.xlsx");
  console.log("2. عدّل الـ Serial و Code للـ 13 جهاز بالأرقام الجديدة");
  console.log("3. شغل: node scripts\\safe-upsert-827-import.cjs --apply");
  console.log("4. النتيجة: هيتعاملوا كأجهزة جديدة والعدد هيزيد! ");
  console.log("\n ملاحظة: البيانات الأصلية محفوظة في الملف JSON لو احتجتها");
  console.log("============================================================\n");
}

main()
  .catch(err => {
    console.error("❌ FATAL:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });