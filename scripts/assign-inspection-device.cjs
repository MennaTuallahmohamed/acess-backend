/**
 * assign-inspection-device.cjs
 *
 * بعد ما تحدد يدويًا (من MISSING_DEVICES_REPORT.xlsx) إن تفتيش رقم X
 * يخص جهاز رقم Y (Device.id في الداتابيز — الجهاز لازم يكون اتضاف
 * بالفعل، يعني بعد ما ترفع الـ827 بسكريبت safe-upsert-827-import.cjs)،
 * شغّل السكريبت ده عشان يربطهم ويملأ الـ snapshot مرة واحدة.
 *
 * تشغيل:
 *   node assign-inspection-device.cjs <inspectionId> <deviceId>
 *
 * مثال:
 *   node assign-inspection-device.cjs 6120 845
 */

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const [inspectionIdRaw, deviceIdRaw] = process.argv.slice(2);

  if (!inspectionIdRaw || !deviceIdRaw) {
    console.error("Usage: node assign-inspection-device.cjs <inspectionId> <deviceId>");
    process.exit(1);
  }

  const inspectionId = Number(inspectionIdRaw);
  const deviceId = Number(deviceIdRaw);

  const inspection = await prisma.inspection.findUnique({ where: { id: inspectionId } });
  if (!inspection) throw new Error(`Inspection ${inspectionId} not found.`);

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    include: { deviceType: true },
  });
  if (!device) throw new Error(`Device ${deviceId} not found.`);

  if (inspection.deviceId !== null) {
    console.warn(
      `⚠️  Inspection ${inspectionId} already has deviceId=${inspection.deviceId}. Overwriting.`
    );
  }

  await prisma.inspection.update({
    where: { id: inspectionId },
    data: {
      deviceId,
      deviceCodeSnapshot: device.deviceCode,
      deviceNameSnapshot: device.deviceName,
      deviceSerialSnapshot: device.serialNumber,
      deviceTypeSnapshot: device.deviceType?.name ?? null,
    },
  });

  console.log(`✅ Inspection ${inspectionId} linked to Device ${deviceId} (${device.deviceCode}).`);
}

main()
  .catch(err => {
    console.error("❌ ERROR:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
