/**
 * upsert-csv-devices.cjs
 * يقرأ CSV ويعمل upsert (update if exists, insert if not)
 * 
 * تشغيل:
 * node scripts\upsert-csv-devices.cjs
 */
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const CSV_FILE = "C:\\backend\\devices_fixed.csv";

function clean(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function parseCSV(content) {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  
  const headers = lines[0].split(",").map(h => clean(h).toLowerCase());
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = clean(values[idx] || "");
    });
    rows.push(row);
  }
  
  return { headers, rows };
}

function getVal(row, names) {
  for (const name of names) {
    const key = name.toLowerCase();
    if (row[key] !== undefined && row[key] !== "") return row[key];
  }
  return "";
}

async function main() {
  console.log("============================================================");
  console.log(" UPSERT الأجهزة من CSV (تحديث + إضافة)");
  console.log("============================================================\n");

  if (!fs.existsSync(CSV_FILE)) {
    console.error(`❌ الملف غير موجود: ${CSV_FILE}`);
    process.exit(1);
  }

  const content = fs.readFileSync(CSV_FILE, "utf8");
  const { headers, rows } = parseCSV(content);
  
  console.log(` عدد الصفوف: ${rows.length}`);
  console.log(`📋 الأعمدة: ${headers.join(", ")}\n`);

  const defaultType = await prisma.deviceType.findFirst();
  const defaultLoc = await prisma.location.findFirst();

  if (!defaultType || !defaultLoc) {
    console.error("❌ لم يتم العثور على DeviceType أو Location");
    process.exit(1);
  }
  console.log(`✅ DeviceType ID: ${defaultType.id} | Location ID: ${defaultLoc.id}\n`);

  let updated = 0;
  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const code = getVal(row, ["device id", "device code", "code"]);
    const serial = getVal(row, ["serial", "serial number"]);
    const ip = getVal(row, ["ip", "ip address"]);
    const cluster = getVal(row, ["cluster"]);
    const building = getVal(row, ["building"]);
    const zone = getVal(row, ["zone"]);
    const lane = getVal(row, ["lane"]);
    const direction = getVal(row, ["direction"]);
    const secretCode = getVal(row, ["secret code"]);

    if (!code && !serial) {
      skipped++;
      continue;
    }

    // تنظيف السيريال إذا كان "مهنجة" أو غير صالح
    let cleanSerial = serial;
    if (serial.includes("مهنج") || serial === "-" || serial === "_" || serial === "") {
      cleanSerial = null;
    }

    try {
      // البحث عن الجهاز الموجود
      const existing = await prisma.device.findFirst({
        where: {
          OR: [
            code ? { deviceCode: code } : null,
            cleanSerial ? { serialNumber: cleanSerial } : null
          ].filter(Boolean)
        }
      });

      const barcode = `${code || "NOCODE"}-${cleanSerial || "NOSERIAL"}-${building || "NOBUILDING"}-${lane || "NOLANE"}`;

      if (existing) {
        // UPDATE
        await prisma.device.update({
          where: { id: existing.id },
          data: {
            deviceCode: code || existing.deviceCode,
            serialNumber: cleanSerial,
            ipAddress: ip || null,
            secretCode: secretCode || null,
            gateCluster: cluster || null,
            gateBuilding: building || null,
            gateZone: zone || null,
            lane: lane || null,
            gateDirection: direction || null,
            barcode: barcode,
            currentStatus: "active"
          }
        });
        console.log(`✅ Row ${rowNum}: تم تحديث الجهاز (Code: ${code})`);
        updated++;
      } else {
        // INSERT
        await prisma.device.create({
          data: {
            deviceCode: code || null,
            serialNumber: cleanSerial,
            deviceName: building || null,
            ipAddress: ip || null,
            barcode: barcode,
            gateCluster: cluster || null,
            gateBuilding: building || null,
            gateZone: zone || null,
            lane: lane || null,
            gateDirection: direction || null,
            secretCode: secretCode || null,
            currentStatus: "active",
            deviceTypeId: defaultType.id,
            locationId: defaultLoc.id
          }
        });
        console.log(`✅ Row ${rowNum}: تم إضافة جهاز جديد (Code: ${code})`);
        inserted++;
      }
    } catch (error) {
      const msg = error.message || "";
      console.error(`❌ Row ${rowNum}: فشل - ${msg.substring(0, 100)}`);
      failed++;
      errors.push({ rowNum, code, serial, error: msg.substring(0, 150) });
    }
  }

  console.log("\n============================================================");
  console.log(" 📊 RESULT");
  console.log("============================================================");
  console.log(`✅ تم التحديث (Updated) : ${updated}`);
  console.log(`✅ تم الإضافة (Inserted): ${inserted}`);
  console.log(`⚠️  تم التخطي (Skipped) : ${skipped}`);
  console.log(`❌ فشل (Failed)         : ${failed}`);
  console.log(` إجمالي الصفوف        : ${rows.length}`);

  if (errors.length > 0) {
    console.log("\n⚠️  تفاصيل الأخطاء:");
    console.log("--------------------------------------------------------------------------------");
    errors.forEach(e => {
      console.log(`Row ${e.rowNum} | Code: ${e.code} | Serial: ${e.serial}`);
      console.log(`  Error: ${e.error}`);
      console.log("");
    });
  }

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