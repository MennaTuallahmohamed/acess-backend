/**
 * safe-upsert-827-import-FIXED.cjs
 * النسخة النهائية المصححة تماماً (تم إزالة حقول غير موجودة مثل lane)
 * 
 * التشغيل:
 * node scripts\\safe-upsert-827-import-FIXED.cjs --apply
 */
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const EXCEL_FILE = "C:\\backend\\ALL_827_NEW_DATA_AND_CLEAN_LABELS.xlsx";
const REPORT_FILE = "C:\\backend\\SAFE_IMPORT_827_REPORT.xlsx";

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

function makeBarcode(row, usedBarcodes) {
  const code = get(row, ["Device ID", "Device Code"]);
  const serial = get(row, ["Serial", "Serial Number"]);
  const cluster = get(row, ["Cluster"]);
  const building = get(row, ["Building"]);
  const zone = get(row, ["Zone"]);
  
  let base = `${code}-${serial}-${cluster}-${building}-${zone}`;
  let barcode = base;
  let counter = 1;
  
  while (usedBarcodes.has(barcode)) {
    barcode = `${base}-${counter}`;
    counter++;
  }
  
  usedBarcodes.add(barcode);
  return barcode;
}

async function main() {
  const mode = process.argv.includes("--apply") ? "APPLY" : "DRY-RUN";
  
  console.log("============================================================");
  console.log(" SAFE UPSERT IMPORT — FINAL FIXED VERSION");
  console.log("============================================================");
  console.log(`MODE: ${mode}\n`);
  
  // 1) قراءة الإكسيل
  const wb = XLSX.readFile(EXCEL_FILE, { raw: false, cellDates: false });
  const sheetName = wb.SheetNames.includes("NEW فقط") ? "NEW فقط" : wb.SheetNames[0];
  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "", raw: false });
  
  console.log(`Excel rows: ${rawRows.length}`);
  
  // 2) جلب الأجهزة الموجودة (بدون حقول غير موجودة مثل lane)
  const existingDevices = await prisma.device.findMany({
    select: {
      id: true,
      deviceCode: true,
      serialNumber: true,
      barcode: true,
      deviceName: true,
      ipAddress: true,
      lifecycleStatus: true,
      secretCode: true,
      gateCluster: true,
      gateBuilding: true,
      gateZone: true,
      gateDirection: true
    }
  });
  
  console.log(`Current DEVICE rows: ${existingDevices.length}\n`);
  
  // 3) بناء خرائط البحث
  const byCode = new Map();
  const bySerial = new Map();
  
  for (const d of existingDevices) {
    if (d.deviceCode) byCode.set(norm(d.deviceCode), d);
    if (d.serialNumber) bySerial.set(norm(d.serialNumber), d);
  }
  
  // 4) تحليل الخطة
  const usedBarcodes = new Set(existingDevices.map(d => d.barcode).filter(Boolean));
  const plan = { updates: [], inserts: [], archives: [], failed: [] };
  const excelCodeSet = new Set();
  
  for (let i = 0; i < rawRows.length; i++) {
    const row = normalizeKeys(rawRows[i]);
    const code = get(row, ["Device ID", "Device Code"]);
    const serial = get(row, ["Serial", "Serial Number"]);
    
    if (!code) {
      plan.failed.push({ excelRow: i + 2, code: "", error: "Missing Device ID" });
      continue;
    }
    
    excelCodeSet.add(norm(code));
    const existing = byCode.get(norm(code));
    
    if (existing) {
      plan.updates.push({ row, index: i, existing });
    } else {
      plan.inserts.push({ row, index: i });
    }
  }
  
  // ARCHIVE
  for (const d of existingDevices) {
    if (!excelCodeSet.has(norm(d.deviceCode))) {
      plan.archives.push(d);
    }
  }
  
  console.log("PLAN");
  console.log("------------------------------------------------------------");
  console.log(`Will UPDATE (existing, same id, name kept)  : ${plan.updates.length}`);
  console.log(`Will INSERT (brand new devices)              : ${plan.inserts.length}`);
  console.log(`Will ARCHIVE (in DB, not in new excel)        : ${plan.archives.length}`);
  console.log(`Final active DEVICE count after apply         : ${plan.updates.length + plan.inserts.length}`);
  console.log();
  
  if (mode === "APPLY") {
    const readline = require("readline").createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    await new Promise((resolve) => {
      readline.question("Type SAFE-IMPORT-827 to continue: ", (answer) => {
        readline.close();
        if (answer !== "SAFE-IMPORT-827") {
          console.log("\n Cancelled.");
          process.exit(0);
        }
        resolve();
      });
    });
    
    console.log();
    
    let updatedCount = 0;
    let insertedCount = 0;
    let archivedCount = 0;
    let failedCount = 0;
    
    // UPDATE
    for (const { row, existing } of plan.updates) {
      try {
        const serial = get(row, ["Serial", "Serial Number"]);
        const cluster = get(row, ["Cluster"]);
        const building = get(row, ["Building"]);
        const zone = get(row, ["Zone"]);
        const direction = get(row, ["Direction"]);
        const ip = get(row, ["IP", "IP Address"]);
        const secretCode = get(row, ["Secret Code"]);
        
        await prisma.device.update({
          where: { id: existing.id },
          data: {
            serialNumber: serial || null,
            ipAddress: ip || null,
            lifecycleStatus: "active",
            secretCode: secretCode || null,
            gateCluster: cluster || null,
            gateBuilding: building || null,
            gateZone: zone || null,
            gateDirection: direction || null
          }
        });
        
        updatedCount++;
        if (updatedCount % 100 === 0) {
          console.log(`  ...processing ${updatedCount}/${plan.updates.length}`);
        }
      } catch (err) {
        plan.failed.push({
          code: existing.deviceCode,
          excelRow: "-",
          error: err.message
        });
        failedCount++;
      }
    }
    
    // INSERT
    for (const { row, index } of plan.inserts) {
      try {
        const code = get(row, ["Device ID", "Device Code"]);
        const serial = get(row, ["Serial", "Serial Number"]);
        const cluster = get(row, ["Cluster"]);
        const building = get(row, ["Building"]);
        const zone = get(row, ["Zone"]);
        const direction = get(row, ["Direction"]);
        const ip = get(row, ["IP", "IP Address"]);
        const secretCode = get(row, ["Secret Code"]);
        
        const existingBySerial = bySerial.get(norm(serial));
        if (existingBySerial && serial) {
          throw new Error(`Duplicate serial number: ${serial} (exists in device ${existingBySerial.deviceCode})`);
        }
        
        const barcode = makeBarcode(row, usedBarcodes);
        
        await prisma.device.create({
          data: {
            deviceCode: code,
            serialNumber: serial || null,
            barcode,
            ipAddress: ip || null,
            lifecycleStatus: "active",
            secretCode: secretCode || null,
            gateCluster: cluster || null,
            gateBuilding: building || null,
            gateZone: zone || null,
            gateDirection: direction || null
          }
        });
        
        insertedCount++;
        if (insertedCount % 100 === 0) {
          console.log(`  ...processing ${insertedCount}/${plan.inserts.length}`);
        }
      } catch (err) {
        plan.failed.push({
          code: get(row, ["Device ID", "Device Code"]),
          excelRow: index + 2,
          error: err.message
        });
        failedCount++;
      }
    }
    
    // ARCHIVE
    console.log("\nARCHIVING devices not present in new excel...");
    for (const d of plan.archives) {
      try {
        await prisma.device.update({
          where: { id: d.id },
          data: { lifecycleStatus: "archived" }
        });
        archivedCount++;
      } catch (err) {
        plan.failed.push({
          code: d.deviceCode,
          excelRow: "-",
          error: err.message
        });
        failedCount++;
      }
    }
    
    // كتابة التقرير
    const wbReport = XLSX.utils.book_new();
    
    const updatedData = plan.updates.map(({ existing }) => ({
      deviceId: existing.id,
      code: existing.deviceCode
    }));
    XLSX.utils.book_append_sheet(wbReport, XLSX.utils.json_to_sheet(updatedData), "Updated");
    
    const insertedData = plan.inserts.map(({ row, index }) => ({
      deviceId: "NEW",
      code: get(row, ["Device ID", "Device Code"]),
      excelRow: index + 2
    }));
    XLSX.utils.book_append_sheet(wbReport, XLSX.utils.json_to_sheet(insertedData), "Inserted");
    
    const archivedData = plan.archives.map(d => ({
      deviceId: d.id,
      code: d.deviceCode
    }));
    XLSX.utils.book_append_sheet(wbReport, XLSX.utils.json_to_sheet(archivedData), "Archived");
    
    XLSX.utils.book_append_sheet(wbReport, XLSX.utils.json_to_sheet(plan.failed), "Failed");
    XLSX.writeFile(wbReport, REPORT_FILE);
    
    console.log("\n============================================================");
    console.log(" DONE");
    console.log("============================================================");
    console.log(`Updated : ${updatedCount}`);
    console.log(`Inserted: ${insertedCount}`);
    console.log(`Archived: ${archivedCount}`);
    console.log(`Failed  : ${failedCount}`);
    console.log(`Report  : ${REPORT_FILE}`);
    
    if (failedCount > 0) {
      console.log("\n⚠️  فيه صفوف فشلت — راجع ملف التقرير لإصلاحها.");
    }
  } else {
    console.log("\n This is a DRY-RUN. Add --apply to actually execute.");
  }
}

main()
  .catch(err => {
    console.error("❌ FATAL ERROR:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });