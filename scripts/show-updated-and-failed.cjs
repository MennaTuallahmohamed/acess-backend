/**
 * show-updated-and-failed.cjs
 *
 * بيقرا تقرير SAFE_IMPORT_827_REPORT.xlsx (اللي طلع من safe-upsert-827-import.cjs)
 * ويطلعلك في التيرمينال:
 *   1) الأجهزة اللي اتحدّثت (Updated) — كانوا موجودين بالفعل، اتحدثت بياناتهم بس،
 *      نفس الـ id، الاسم متلمسش.
 *   2) الجهاز/الأجهزة اللي فشلت (Failed) + رسالة الخطأ بالظبط.
 *
 * كمان بيتأكد من الداتابيز الحالية إن كل جهاز Updated لسه موجود فعلاً.
 *
 * تشغيل:
 *   node scripts\show-updated-and-failed.cjs
 */

const fs = require("fs");
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const REPORT_FILE = "C:\\backend\\SAFE_IMPORT_827_REPORT.xlsx";

function readSheet(wb, name) {
  if (!wb.SheetNames.includes(name)) return [];
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" });
}

async function main() {
  if (!fs.existsSync(REPORT_FILE)) {
    throw new Error(`مش لاقي التقرير: ${REPORT_FILE}\nشغّل safe-upsert-827-import.cjs --apply الأول.`);
  }

  const wb = XLSX.readFile(REPORT_FILE);
  const updated = readSheet(wb, "Updated").filter(r => r.Result !== "none");
  const failed = readSheet(wb, "Failed").filter(r => r.Result !== "none");

  console.log("============================================================");
  console.log(` الأجهزة اللي اتحدّثت (Updated) — العدد: ${updated.length}`);
  console.log("============================================================");

  for (const row of updated) {
    const deviceId = row.deviceId;
    const code = row.code;

    // نتأكد إنه لسه موجود فعلاً في الداتابيز دلوقتي
    const live = await prisma.device.findUnique({
      where: { id: Number(deviceId) },
      select: { id: true, deviceCode: true, deviceName: true, lifecycleStatus: true, updatedAt: true },
    });

    if (live) {
      console.log(
        `✅ Device ID (DB)=${live.id} | Code=${live.deviceCode} | Name=${live.deviceName} | Status=${live.lifecycleStatus} | آخر تحديث=${live.updatedAt}`
      );
    } else {
      console.log(`⚠️  Device ID=${deviceId} (Code=${code}) — مش موجود دلوقتي في الداتابيز! محتاج مراجعة.`);
    }
  }

  console.log("");
  console.log("============================================================");
  console.log(` الأجهزة اللي فشلت (Failed) — العدد: ${failed.length}`);
  console.log("============================================================");

  if (!failed.length) {
    console.log("مفيش فشل 🎉");
  } else {
    for (const row of failed) {
      console.log(`❌ Code=${row.code || "?"} | Excel Row=${row.excelRow || "-"} | السبب: ${row.error}`);
    }
  }

  console.log("");
}

main()
  .catch(err => {
    console.error("❌ ERROR:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
