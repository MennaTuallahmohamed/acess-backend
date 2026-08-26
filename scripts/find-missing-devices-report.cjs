/**
 * find-missing-devices-report.cjs
 *
 * بيقارن ملف الإكسيل القديم (اللي فيه الأجهزة الأصلية قبل ما الـ8 يتمسحوا)
 * بالأجهزة الموجودة دلوقتي في الداتابيز، ويطلعلك تقرير Excel فيه شيتين:
 *
 *   1) "Missing Devices"      -> الأجهزة اللي كانت في الإكسيل القديم
 *                                ومش موجودة دلوقتي (المفروض يطلع فيهم الـ8).
 *   2) "Orphaned Inspections" -> كل تفتيش deviceId بتاعه NULL، مع الفني
 *                                والتاريخ والموقع والملاحظات، عشان تقارن
 *                                يدويًا مين بيخص مين.
 *
 * عدّل OLD_EXCEL_FILE تحت لمسار ملف الإكسيل القديم بتاعك، وبعدين شغّل:
 *   node find-missing-devices-report.cjs
 */

const fs = require("fs");
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ⚠️ غيّر ده لمسار ملف الإكسيل القديم اللي فيه الأجهزة الأصلية (قبل حذف الـ8)
const OLD_EXCEL_FILE = "C:\\backend\\OLD_DEVICES_BEFORE_DELETE.xlsx";

const OUTPUT_FILE = "C:\\backend\\MISSING_DEVICES_REPORT.xlsx";

function clean(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}
function norm(v) {
  return clean(v).toLowerCase().replace(/\s+/g, " ");
}
function normalizeKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[norm(k)] = v;
  return out;
}
function get(row, names) {
  for (const name of names) {
    const key = norm(name);
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const value = clean(row[key]);
      if (value !== "") return value;
    }
  }
  return "";
}

function readOldExcel() {
  if (!fs.existsSync(OLD_EXCEL_FILE)) {
    throw new Error(
      `مش لاقي الملف: ${OLD_EXCEL_FILE}\nعدّل قيمة OLD_EXCEL_FILE في أول السكريبت.`
    );
  }
  const wb = XLSX.readFile(OLD_EXCEL_FILE, { raw: false, cellDates: false });
  const sheetName = wb.SheetNames[0];
  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    defval: "",
    raw: false,
  });

  return rawRows.map((raw, index) => {
    const r = normalizeKeys(raw);
    return {
      excelRow: index + 2,
      deviceCode: get(r, ["Device ID", "Device Code"]),
      serial: get(r, ["Serial", "Serial Number"]),
      ip: get(r, ["IP", "IP Address"]),
      cluster: get(r, ["Cluster"]),
      building: get(r, ["Building", "اسم الوزارة / الجهة"]),
      zone: get(r, ["Zone"]),
      lane: get(r, ["Lane"]),
      direction: get(r, ["Direction"]),
    };
  });
}

async function main() {
  console.log("============================================================");
  console.log(" FIND MISSING DEVICES + ORPHANED INSPECTIONS");
  console.log("============================================================\n");

  const oldRows = readOldExcel();
  console.log(`Old Excel rows: ${oldRows.length}`);

  const currentDevices = await prisma.device.findMany({
    where: { assetType: "DEVICE" },
    select: { id: true, deviceCode: true, serialNumber: true },
  });

  const currentCodes = new Set(currentDevices.map(d => norm(d.deviceCode)));
  const currentSerials = new Set(
    currentDevices.filter(d => d.serialNumber).map(d => norm(d.serialNumber))
  );

  const missing = oldRows.filter(r => {
    const codeMatch = r.deviceCode && currentCodes.has(norm(r.deviceCode));
    const serialMatch = r.serial && currentSerials.has(norm(r.serial));
    // موجود لو الكود أو السيريال لسه موجودين دلوقتي
    return !codeMatch && !serialMatch;
  });

  console.log(`Missing devices (not found in current DB): ${missing.length}`);

  const orphanedInspections = await prisma.inspection.findMany({
    where: { deviceId: null },
    include: {
      technician: { select: { fullName: true, username: true } },
      images: { select: { imageUrl: true } },
    },
    orderBy: { inspectedAt: "asc" },
  });

  console.log(`Orphaned inspections: ${orphanedInspections.length}\n`);

  const missingSheet = missing.map(r => ({
    "Excel Row": r.excelRow,
    "Device ID (old)": r.deviceCode,
    Serial: r.serial,
    IP: r.ip,
    Cluster: r.cluster,
    Building: r.building,
    Zone: r.zone,
    Lane: r.lane,
    Direction: r.direction,
  }));

  const orphanedSheet = orphanedInspections.map(i => ({
    "Inspection ID": i.id,
    Technician: i.technician?.fullName || i.technician?.username || "",
    "Inspected At": i.inspectedAt,
    Status: i.inspectionStatus,
    "Location Text": i.locationText || "",
    Latitude: i.latitude || "",
    Longitude: i.longitude || "",
    "Notes / Problem": i.notes || "",
    "Image Count": i.images.length,
    "Suggested Device ID (fill manually)": "",
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(missingSheet.length ? missingSheet : [{ Result: "No missing devices found" }]),
    "Missing Devices"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(orphanedSheet.length ? orphanedSheet : [{ Result: "No orphaned inspections" }]),
    "Orphaned Inspections"
  );

  XLSX.writeFile(wb, OUTPUT_FILE);

  console.log(`✅ Report written to: ${OUTPUT_FILE}`);
  console.log("");
  console.log("افتح الملف وقارن الشيتين يدويًا: الفني/التاريخ/الموقع/الملاحظات");
  console.log("في 'Orphaned Inspections' بيرشدوك لمين من 'Missing Devices' يخصه.");
  console.log("لو الصور بتوضح سيريال/رقم على الجهاز، افتحها كمان للمقارنة.");
  console.log("بعد ما تحدد، استخدم assign-inspection-device.cjs للربط.");
}

main()
  .catch(err => {
    console.error("❌ ERROR:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
