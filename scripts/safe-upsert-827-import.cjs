/**
 * safe-upsert-827-import.cjs
 *
 * بديل آمن لـ replace-with-827-auto-renumber.cjs.
 *
 * الفرق الجوهري:
 *   - مفيش DELETE للأجهزة الموجودة خالص.
 *   - جهاز موجود بالفعل (نفس Device ID) => UPDATE بس (نفس الـ id يفضل
 *     زي ما هو => كل التفتيشات القديمة تفضل مربوطة بيه عادي، واسم
 *     الجهاز (deviceName) متتغيرش، بيتسيب زي ما هو).
 *   - جهاز جديد مش موجود => INSERT.
 *   - جهاز موجود في الداتابيز ومش موجود في الإكسيل الجديد => يتحول
 *     lifecycleStatus = ARCHIVED بس، مفيش أي حذف.
 *   - Idempotent: تقدر تعيد تشغيله أكتر من مرة براحتك، مش هيكرر ولا
 *     يبوظ حاجة.
 *   - كل صف بيتعالج لوحده (مش جوه transaction عملاقة واحدة) عشان لو
 *     حصل قطع في النص، تقدر تكمل من غير ما تخسر اللي خلص فعلاً.
 *
 * تشغيل (Dry run الأول، زي القديم):
 *   node safe-upsert-827-import.cjs
 * لما تتأكد من التقرير:
 *   node safe-upsert-827-import.cjs --apply
 */

const fs = require("fs");
const crypto = require("crypto");
const readline = require("readline");
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const INPUT_FILE = "C:\\backend\\ALL_827_NEW_DATA_AND_CLEAN_LABELS.xlsx";
const REPORT_FILE = "C:\\backend\\SAFE_IMPORT_827_REPORT.xlsx";
const EXPECTED_ROWS = 827;

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
function normalizeLane(v) {
  const s = clean(v);
  if (/^-?\d+\.0+$/.test(s)) return String(parseInt(s, 10));
  return s;
}
function validIPv4(v) {
  const s = clean(v);
  if (!s) return "";
  const p = s.split(".");
  if (p.length !== 4) return "";
  if (!p.every(x => /^\d{1,3}$/.test(x) && Number(x) >= 0 && Number(x) <= 255)) return "";
  return s;
}
function validSerial(v) {
  const s = clean(v);
  if (!s) return "";
  return /^[A-Za-z0-9._-]{5,}$/.test(s) ? s : "";
}
function generateSecret(used) {
  while (true) {
    const h = crypto.randomBytes(8).toString("hex").toUpperCase();
    const value = `DSC-${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}`;
    if (!used.has(norm(value))) {
      used.add(norm(value));
      return value;
    }
  }
}
function makeBarcode(row, used) {
  const base =
    "DEV827-" +
    clean(row.finalDeviceCode) +
    "-" +
    crypto
      .createHash("sha1")
      .update(`${row.finalDeviceCode}|${row.finalSecretCode}|${row.ipAddress}|${row.serialNumber}`)
      .digest("hex")
      .slice(0, 10)
      .toUpperCase();
  let value = base;
  let n = 1;
  while (used.has(norm(value))) value = `${base}-${n++}`;
  used.add(norm(value));
  return value;
}
function locationKey(row) {
  return [norm(row.cluster), norm(row.building), norm(row.zone), norm(row.lane), norm(row.direction)].join("|");
}
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, a => { rl.close(); resolve(String(a || "").trim()); }));
}

function readAndPrepareExcel() {
  if (!fs.existsSync(INPUT_FILE)) throw new Error(`Excel file not found: ${INPUT_FILE}`);

  const wb = XLSX.readFile(INPUT_FILE, { raw: false, cellDates: false });
  const sheetName = wb.SheetNames.includes("NEW فقط") ? "NEW فقط" : wb.SheetNames[0];
  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "", raw: false });

  const rows = rawRows
    .map((raw, index) => {
      const r = normalizeKeys(raw);
      const rawDeviceCode = get(r, ["Device ID", "Device Code"]);
      const ipRaw = get(r, ["IP", "IP Address"]);
      const serialRaw = get(r, ["Serial", "Serial Number"]);
      return {
        excelRow: index + 2,
        originalDeviceCode: rawDeviceCode,
        finalDeviceCode: rawDeviceCode,
        originalSecretCode: get(r, ["Secret Code", "Secret"]),
        finalSecretCode: "",
        ipRaw,
        ipAddress: validIPv4(ipRaw),
        serialRaw,
        serialNumber: validSerial(serialRaw),
        cluster: get(r, ["Cluster"]),
        building: get(r, ["Building", "اسم الوزارة / الجهة"]),
        zone: get(r, ["Zone"]),
        lane: normalizeLane(get(r, ["Lane"])),
        direction: get(r, ["Direction"]).toUpperCase(),
      };
    })
    .filter(r =>
      [r.originalDeviceCode, r.originalSecretCode, r.ipRaw, r.serialRaw, r.cluster, r.building, r.zone, r.lane, r.direction].some(Boolean)
    );

  if (rows.length !== EXPECTED_ROWS) {
    throw new Error(`SAFETY STOP: expected ${EXPECTED_ROWS} Excel rows, found ${rows.length}.`);
  }

  // --- dedupe Device ID within the excel file itself ---
  const numericIds = rows.map(r => Number(clean(r.originalDeviceCode))).filter(Number.isFinite);
  let nextId = numericIds.length ? Math.max(...numericIds) + 1 : 1;
  const usedDeviceCodes = new Set();
  const idChanges = [];

  for (const row of rows) {
    const original = clean(row.originalDeviceCode);
    const key = norm(original);
    if (original && !usedDeviceCodes.has(key)) {
      row.finalDeviceCode = original;
      usedDeviceCodes.add(key);
      continue;
    }
    while (usedDeviceCodes.has(norm(String(nextId)))) nextId++;
    const newId = String(nextId++);
    row.finalDeviceCode = newId;
    usedDeviceCodes.add(norm(newId));
    idChanges.push({ excelRow: row.excelRow, old: original || "(BLANK)", new: newId });
  }

  // --- dedupe Serial within the excel file itself ---
  const usedSerials = new Set();
  for (const row of rows) {
    const raw = clean(row.serialRaw);
    const valid = validSerial(raw);
    if (!raw) { row.serialNumber = null; continue; }
    if (!valid || usedSerials.has(norm(valid))) { row.serialNumber = null; continue; }
    row.serialNumber = valid;
    usedSerials.add(norm(valid));
  }

  // --- dedupe Secret Code within the excel file itself ---
  const usedSecrets = new Set();
  for (const row of rows) {
    const original = clean(row.originalSecretCode);
    if (original && !usedSecrets.has(norm(original))) {
      row.finalSecretCode = original;
      usedSecrets.add(norm(original));
      continue;
    }
    row.finalSecretCode = generateSecret(usedSecrets);
  }

  for (const row of rows) {
    if (row.ipRaw && !row.ipAddress) row.ipAddress = null;
    else if (!row.ipRaw) row.ipAddress = null;
  }

  return { sheetName, rows, idChanges };
}

async function preloadLocations(rows) {
  const cache = new Map();
  const existing = await prisma.location.findMany();
  for (const loc of existing) {
    const key = [norm(loc.cluster), norm(loc.building), norm(loc.zone), norm(loc.lane), norm(loc.direction)].join("|");
    cache.set(key, loc.id);
  }

  for (const row of rows) {
    const key = locationKey(row);
    if (cache.has(key)) continue;

    const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 16).toUpperCase();
    let excelId = `FINAL827-${hash}`;
    const collision = await prisma.location.findFirst({ where: { excelId } });
    if (collision) excelId = `${excelId}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;

    const loc = await prisma.location.create({
      data: {
        cluster: row.cluster,
        building: row.building,
        zone: row.zone,
        lane: row.lane,
        direction: row.direction,
        excelId,
        type: "DEVICE",
      },
    });
    cache.set(key, loc.id);
  }

  return cache;
}

async function main() {
  const apply = process.argv.includes("--apply");

  console.log("============================================================");
  console.log(" SAFE UPSERT IMPORT — NO DELETE, KEEPS ALL EXISTING LINKS");
  console.log("============================================================");
  console.log(apply ? "MODE: APPLY" : "MODE: DRY RUN");
  console.log("");

  const prepared = readAndPrepareExcel();
  console.log(`Excel rows: ${prepared.rows.length}`);
  console.log(`Device ID renumbered within excel: ${prepared.idChanges.length}`);

  const currentDevices = await prisma.device.findMany({
    where: { assetType: "DEVICE" },
    select: { id: true, deviceCode: true, deviceName: true, lifecycleStatus: true },
  });
  const currentByCode = new Map(currentDevices.map(d => [norm(d.deviceCode), d]));
  console.log(`Current DEVICE rows: ${currentDevices.length}`);

  const deviceTypeIds = [...new Set(currentDevices.length ? await prisma.device.findMany({
    where: { assetType: "DEVICE" }, select: { deviceTypeId: true },
  }).then(r => r.map(x => x.deviceTypeId)) : [])];
  const defaultDeviceTypeId = deviceTypeIds[0];
  if (!defaultDeviceTypeId) throw new Error("Could not determine a default deviceTypeId.");

  const excelCodes = new Set(prepared.rows.map(r => norm(r.finalDeviceCode)));
  const toArchive = currentDevices.filter(d => !excelCodes.has(norm(d.deviceCode)) && d.lifecycleStatus !== "ARCHIVED");

  const willUpdate = prepared.rows.filter(r => currentByCode.has(norm(r.finalDeviceCode)));
  const willInsert = prepared.rows.filter(r => !currentByCode.has(norm(r.finalDeviceCode)));

  console.log("");
  console.log("PLAN");
  console.log("------------------------------------------------------------");
  console.log(`Will UPDATE (existing, same id, name kept)  : ${willUpdate.length}`);
  console.log(`Will INSERT (brand new devices)              : ${willInsert.length}`);
  console.log(`Will ARCHIVE (in DB, not in new excel)        : ${toArchive.length}`);
  console.log(`Final active DEVICE count after apply         : ${prepared.rows.length}`);
  console.log("");

  if (!apply) {
    console.log("DRY RUN ONLY — no changes made. Re-run with --apply to execute.");
    return;
  }

  const confirm = await ask("Type SAFE-IMPORT-827 to continue: ");
  if (confirm !== "SAFE-IMPORT-827") {
    console.log("❌ Cancelled. NO DATABASE CHANGES WERE MADE.");
    return;
  }

  const locationCache = await preloadLocations(prepared.rows);

  const usedBarcodes = new Set(
    (await prisma.device.findMany({ select: { barcode: true } })).map(d => norm(d.barcode))
  );

  const results = { updated: [], inserted: [], failed: [] };

  let i = 0;
  for (const row of prepared.rows) {
    i++;
    if (i % 100 === 0) console.log(`  ...processing ${i}/${prepared.rows.length}`);

    const locationId = locationCache.get(locationKey(row));

    try {
      const existing = currentByCode.get(norm(row.finalDeviceCode));

      if (existing) {
        // UPDATE — نفس الـ id، الاسم متغيرش
        await prisma.device.update({
          where: { id: existing.id },
          data: {
            ipAddress: row.ipAddress || null,
            serialNumber: row.serialNumber || null,
            secretCode: row.finalSecretCode,
            locationId,
            lifecycleStatus: "ACTIVE",
            // deviceName عمدًا متلمسوش — بيفضل زي ما هو
          },
        });
        results.updated.push({ deviceId: existing.id, code: row.finalDeviceCode });
      } else {
        // INSERT جديد
        const barcode = makeBarcode(row, usedBarcodes);
        const created = await prisma.device.create({
          data: {
            deviceCode: row.finalDeviceCode,
            deviceName: `Device ${row.finalDeviceCode}`,
            barcode,
            ipAddress: row.ipAddress || null,
            serialNumber: row.serialNumber || null,
            secretCode: row.finalSecretCode,
            assetType: "DEVICE",
            currentStatus: "OK",
            lifecycleStatus: "ACTIVE",
            deviceTypeId: defaultDeviceTypeId,
            locationId,
            notes: "Imported from safe-upsert-827-import.",
          },
        });
        results.inserted.push({ deviceId: created.id, code: row.finalDeviceCode });
      }
    } catch (err) {
      results.failed.push({ code: row.finalDeviceCode, excelRow: row.excelRow, error: err.message });
    }
  }

  console.log("");
  console.log("ARCHIVING devices not present in new excel...");
  for (const d of toArchive) {
    try {
      await prisma.device.update({ where: { id: d.id }, data: { lifecycleStatus: "ARCHIVED" } });
    } catch (err) {
      results.failed.push({ code: d.deviceCode, error: `archive failed: ${err.message}` });
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(results.updated.length ? results.updated : [{ Result: "none" }]), "Updated");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(results.inserted.length ? results.inserted : [{ Result: "none" }]), "Inserted");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toArchive.length ? toArchive.map(d => ({ deviceId: d.id, code: d.deviceCode })) : [{ Result: "none" }]), "Archived");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(results.failed.length ? results.failed : [{ Result: "none" }]), "Failed");
  XLSX.writeFile(wb, REPORT_FILE);

  console.log("");
  console.log("============================================================");
  console.log(" DONE");
  console.log("============================================================");
  console.log(`Updated : ${results.updated.length}`);
  console.log(`Inserted: ${results.inserted.length}`);
  console.log(`Archived: ${toArchive.length}`);
  console.log(`Failed  : ${results.failed.length}`);
  console.log(`Report  : ${REPORT_FILE}`);
  if (results.failed.length) {
    console.log("");
    console.log("⚠️  فيه صفوف فشلت — السكريبت idempotent، تقدر تصلح المشكلة وتعيد تشغيله براحتك.");
  }
}

main()
  .catch(err => {
    console.error("❌ ERROR:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
