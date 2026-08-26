/**
 * find-serial-conflict.cjs
 *
 * بيدوّر على قيمة الـ Serial بتاعة صف معين في الإكسيل (اللي فشل)
 * ويقولك مين الجهاز التاني في الداتابيز الماسك نفس السيريال ده.
 *
 * تشغيل:
 *   node scripts\find-serial-conflict.cjs 389
 * (389 = رقم الصف في الإكسيل اللي فشل، من عمود "Excel Row" في شيت Failed)
 */

const fs = require("fs");
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const INPUT_FILE = "C:\\backend\\ALL_827_NEW_DATA_AND_CLEAN_LABELS.xlsx";

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

async function main() {
  const targetRow = Number(process.argv[2]);
  if (!targetRow) {
    console.error("Usage: node find-serial-conflict.cjs <excelRowNumber>");
    process.exit(1);
  }

  const wb = XLSX.readFile(INPUT_FILE, { raw: false, cellDates: false });
  const sheetName = wb.SheetNames.includes("NEW فقط") ? "NEW فقط" : wb.SheetNames[0];
  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "", raw: false });

  const rowIndex = targetRow - 2; // excelRow = index + 2
  if (rowIndex < 0 || rowIndex >= rawRows.length) {
    throw new Error(`Row ${targetRow} out of range.`);
  }

  const r = normalizeKeys(rawRows[rowIndex]);
  const deviceCode = get(r, ["Device ID", "Device Code"]);
  const serial = get(r, ["Serial", "Serial Number"]);
  const ip = get(r, ["IP", "IP Address"]);

  console.log(`Excel Row ${targetRow}:`);
  console.log(`  Device ID (excel): ${deviceCode}`);
  console.log(`  Serial (excel)   : ${serial}`);
  console.log(`  IP (excel)       : ${ip}`);
  console.log("");

  if (!serial) {
    console.log("الصف ده مفيهوش سيريال — المشكلة مش هنا، راجع رسالة الخطأ تاني.");
    return;
  }

  const conflict = await prisma.device.findUnique({
    where: { serialNumber: serial },
    select: {
      id: true,
      deviceCode: true,
      deviceName: true,
      lifecycleStatus: true,
      ipAddress: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!conflict) {
    console.log("مفيش جهاز تاني ماسك السيريال ده دلوقتي — ممكن يكون اتحل لوحده، جرب تشغل الاستيراد تاني.");
    return;
  }

  console.log("الجهاز الماسك نفس السيريال دلوقتي في الداتابيز:");
  console.log(`  Device ID (DB) : ${conflict.id}`);
  console.log(`  Device Code    : ${conflict.deviceCode}`);
  console.log(`  Device Name    : ${conflict.deviceName}`);
  console.log(`  Status         : ${conflict.lifecycleStatus}`);
  console.log(`  IP             : ${conflict.ipAddress || "-"}`);
  console.log(`  Created At     : ${conflict.createdAt}`);
  console.log(`  Updated At     : ${conflict.updatedAt}`);
  console.log("");
  console.log(
    conflict.deviceCode === deviceCode
      ? "⚠️  ملاحظة: نفس الـ Device Code! يبدو الصف ده مكرر بشكل غريب."
      : "الجهازين مختلفين في الكود — يبدو نفس السيريال اتكتب غلط لجهازين مختلفين في الإكسيل."
  );
}

main()
  .catch(err => {
    console.error("❌ ERROR:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
