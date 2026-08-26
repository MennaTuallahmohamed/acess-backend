/**
 * revert-13-updated.cjs
 * يعرض الـ 13 جهازاً الذين تم تحديثهم + مشاكلهم + خيارات للتصرف
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

const updatedIds = [313, 500, 299, 863, 864, 865, 866, 867, 868, 869, 870, 1100, 846];

async function main() {
  console.log("============================================================");
  console.log(" فحص الـ 13 جهازاً الذين تم تحديثهم");
  console.log("============================================================\n");

  const devices = await prisma.device.findMany({
    where: { id: { in: updatedIds } },
    include: {
      inspections: {
        select: { id: true, inspectedAt: true }
      }
    }
  });

  console.log("==========================================================================================");
  console.log("تفاصيل الأجهزة:");
  console.log("==========================================================================================\n");

  const problems = [];

  for (const device of devices) {
    console.log(`🔹 Device ID: ${device.id}`);
    console.log(`   Code: ${device.deviceCode}`);
    console.log(`   Serial: ${device.serialNumber}`);
    console.log(`   IP: ${device.ipAddress}`);
    console.log(`   Name: ${device.deviceName}`);
    console.log(`   Status: ${device.lifecycleStatus}`);
    console.log(`   Updated: ${device.updatedAt}`);
    
    // فحص التفتيشات
    const hasInspections = device.inspections && device.inspections.length > 0;
    if (hasInspections) {
      console.log(`   ⚠️  تفتيشات مرتبطة: ${device.inspections.length}`);
      problems.push({
        deviceId: device.id,
        issue: `لديه ${device.inspections.length} تفتيش مرتبط`
      });
    } else {
      console.log(`   ✅ لا توجد تفتيشات`);
    }

    // فحص تكرار السيريال
    const duplicates = await prisma.device.findMany({
      where: {
        serialNumber: device.serialNumber,
        id: { not: device.id }
      },
      select: { id: true, deviceCode: true }
    });

    if (duplicates.length > 0) {
      const dupList = duplicates.map(d => `ID:${d.id}(Code:${d.deviceCode})`).join(', ');
      console.log(`   ❌ سيريال مكرر مع: ${dupList}`);
      problems.push({
        deviceId: device.id,
        issue: `السيريال مكرر`
      });
    }

    console.log("");
  }

  console.log("==========================================================================================");
  console.log("ملخص المشاكل:");
  console.log("==========================================================================================");
  
  if (problems.length === 0) {
    console.log("✅ لا توجد مشاكل - جميع الأجهزة آمنة");
  } else {
    console.log(`⚠️  عدد الأجهزة التي بها مشاكل: ${problems.length}`);
    problems.forEach(p => {
      console.log(`   - Device ID ${p.deviceId}: ${p.issue}`);
    });
  }

  console.log("\n==========================================================================================");
  console.log("الخيارات:");
  console.log("==========================================================================================");
  console.log("1. حذف الأجهزة الآمنة فقط (اللي مفيش لها تفتيشات)");
  console.log("2. أرشفة جميع الأجهزة (تغيير Status إلى ARCHIVED)");
  console.log("3. عدم فعل شيء (خروج)");
  console.log("");

  readline.question('اختر رقم (1/2/3): ', async (answer) => {
    readline.close();

    if (answer === '1') {
      const safeToDelete = devices.filter(d => !d.inspections || d.inspections.length === 0);
      
      if (safeToDelete.length === 0) {
        console.log("\n❌ لا يمكن حذف أي جهاز - جميعهم لديهم تفتيشات");
        return;
      }

      console.log(`\n⏳ جاري حذف ${safeToDelete.length} جهازاً...`);
      
      for (const device of safeToDelete) {
        await prisma.device.delete({ where: { id: device.id } });
        console.log(`   ✅ تم حذف Device ID: ${device.id}`);
      }

      const notDeleted = devices.length - safeToDelete.length;
      if (notDeleted > 0) {
        console.log(`\n⚠️  لم يتم حذف ${notDeleted} جهازاً (لديهم تفتيشات)`);
      }

      console.log("\n✅ تم - يمكنك إعادة الرفع الآن");

    } else if (answer === '2') {
      console.log(`\n⏳ جاري أرشفة ${devices.length} جهازاً...`);
      
      for (const device of devices) {
        await prisma.device.update({
          where: { id: device.id },
          data: { lifecycleStatus: 'ARCHIVED' }
        });
        console.log(`   ✅ تم أرشفة Device ID: ${device.id}`);
      }

      console.log("\n✅ تم الأرشفة - يمكنك إعادة الرفع الآن");

    } else {
      console.log("\n✅ لم يتم تنفيذ أي شيء");
    }
  });
}

main()
  .catch(err => {
    console.error("❌ ERROR:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });