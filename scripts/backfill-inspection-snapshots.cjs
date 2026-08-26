/**
 * backfill-inspection-snapshots.cjs
 *
 * لازم تشغل ده بعد ما تعمل الـ migration (01_prisma_schema_diff.md).
 *
 * 1) لكل Inspection لسه مرتبط بجهاز حي (deviceId != null):
 *    بينسخ اسم/نوع/كود/سيريال الجهاز داخل أعمدة الـ snapshot.
 *    ده بيحمي كل الداتا الحالية من مشكلة "Unknown Device" مستقبلاً،
 *    حتى لو الجهاز اتمسح بعد كده.
 *
 * 2) لكل Inspection يتيم (deviceId == null) — زي الـ8 بتوعك:
 *    بيحاول يقرأ نوع الجهاز من نص "Problem / Notes" (مثال:
 *    "نوع الجهاز: Morpho md") ويحطه في deviceTypeSnapshot، عشان
 *    الواجهة تعرض حاجة مفيدة بدل "Unknown Device" لحد ما تتعمل
 *    المطابقة اليدوية الكاملة بسكريبت find-missing-devices-report.cjs.
 *
 * تشغيل:
 *   node backfill-inspection-snapshots.cjs
 */

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const BATCH_SIZE = 200;

async function backfillValid() {
  const total = await prisma.inspection.count({
    where: { deviceId: { not: null } },
  });
  console.log(`Inspections with a live device: ${total}`);

  let processed = 0;
  let updated = 0;
  let cursor = undefined;

  while (true) {
    const batch = await prisma.inspection.findMany({
      where: { deviceId: { not: null } },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      include: {
        device: { include: { deviceType: true } },
      },
    });

    if (batch.length === 0) break;

    for (const insp of batch) {
      if (insp.device) {
        await prisma.inspection.update({
          where: { id: insp.id },
          data: {
            deviceCodeSnapshot: insp.device.deviceCode,
            deviceNameSnapshot: insp.device.deviceName,
            deviceSerialSnapshot: insp.device.serialNumber,
            deviceTypeSnapshot: insp.device.deviceType?.name ?? null,
          },
        });
        updated++;
      }
      processed++;
    }

    cursor = batch[batch.length - 1].id;
    console.log(`  ...processed ${processed}/${total}`);
  }

  console.log(`✅ Backfilled snapshots for ${updated} inspections.\n`);
}

function parseDeviceTypeFromNotes(notes) {
  if (!notes) return null;
  // يدور على "نوع الجهاز: XXXX" لحد أول فاصلة أو نهاية السطر
  const m = notes.match(/نوع\s*الجهاز\s*[:٫]\s*([^,،\n]+)/);
  if (m && m[1]) return m[1].trim();
  return null;
}

async function backfillOrphaned() {
  const orphaned = await prisma.inspection.findMany({
    where: { deviceId: null },
    select: { id: true, notes: true },
  });

  console.log(`Orphaned inspections (deviceId = NULL): ${orphaned.length}`);

  let parsed = 0;

  for (const insp of orphaned) {
    const type = parseDeviceTypeFromNotes(insp.notes);
    if (type) {
      await prisma.inspection.update({
        where: { id: insp.id },
        data: { deviceTypeSnapshot: type },
      });
      parsed++;
    }
  }

  console.log(`✅ Parsed device type from notes for ${parsed} orphaned inspections.`);
  console.log(`⚠️  Still fully unidentified: ${orphaned.length - parsed} (need manual match — see find-missing-devices-report.cjs)\n`);
}

async function main() {
  console.log("============================================================");
  console.log(" BACKFILL INSPECTION DEVICE SNAPSHOTS");
  console.log("============================================================\n");

  await backfillValid();
  await backfillOrphaned();

  console.log("Done.");
}

main()
  .catch(err => {
    console.error("❌ ERROR:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
