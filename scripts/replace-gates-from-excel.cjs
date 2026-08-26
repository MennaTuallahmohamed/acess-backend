/* eslint-disable no-console */

/**
 * استبدال بيانات جدول Gate من ملف Excel بطريقة آمنة.
 *
 * التشغيل التجريبي (لا يعدّل قاعدة البيانات):
 *   node scripts/replace-gates-from-excel.cjs --file "C:\\backend\\imports\\Gates_Only_With_Secret_Codes.xlsx"
 *
 * التنفيذ الحقيقي بعد مراجعة الـ Preview:
 *   node scripts/replace-gates-from-excel.cjs --file "C:\\backend\\imports\\Gates_Only_With_Secret_Codes.xlsx" --apply
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function clean(value) {
  return String(value ?? '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalized(value) {
  return clean(value).toLocaleLowerCase('en-US');
}

function buildKey(...parts) {
  return parts.map(normalized).join('||');
}

function stableId(prefix, value) {
  const digest = crypto
    .createHash('sha256')
    .update(String(value), 'utf8')
    .digest('hex')
    .slice(0, 28)
    .toUpperCase();

  return `${prefix}-${digest}`;
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function parseGateNumber(gateNo) {
  const value = clean(gateNo).toUpperCase();
  const match = value.match(/^(\d+)\s*(IN|OUT)$/i);

  if (!match) {
    throw new Error(
      `Gate Number غير صحيح: "${gateNo}". المطلوب مثل 1 IN أو 8 OUT.`,
    );
  }

  const laneNumber = Number(match[1]);
  const direction = match[2].toUpperCase();

  if (!Number.isInteger(laneNumber) || laneNumber < 1 || laneNumber > 8) {
    throw new Error(`رقم البوابة يجب أن يكون من 1 إلى 8: "${gateNo}".`);
  }

  return {
    gateNo: `${laneNumber} ${direction}`,
    lane: String(laneNumber),
    direction,
  };
}

function parseExcel(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`ملف Excel غير موجود: ${filePath}`);
  }

  const workbook = XLSX.readFile(filePath, {
    cellDates: false,
    raw: false,
  });

  const sheetName = workbook.SheetNames.includes('Gate_Codes')
    ? 'Gate_Codes'
    : workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error('ملف Excel لا يحتوي على أي Sheet.');
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    defval: '',
    raw: false,
  });

  if (rows.length === 0) {
    throw new Error(`Sheet ${sheetName} فارغ.`);
  }

  const parsed = rows.map((row, index) => {
    const excelRow = index + 2;

    const cluster = clean(row.Cluster);
    const building = clean(row['Ministry / Building']);
    const zone = clean(row.Zone);
    const rawGateNo = clean(row['Gate Number']);
    const secretCode = clean(row['Secret Code']).toUpperCase();

    const missing = [];
    if (!cluster) missing.push('Cluster');
    if (!building) missing.push('Ministry / Building');
    if (!zone) missing.push('Zone');
    if (!rawGateNo) missing.push('Gate Number');
    if (!secretCode) missing.push('Secret Code');

    if (missing.length > 0) {
      throw new Error(
        `صف Excel رقم ${excelRow} ناقص: ${missing.join(', ')}`,
      );
    }

    if (!/^GSC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(secretCode)) {
      throw new Error(
        `Secret Code غير صحيح في صف ${excelRow}: ${secretCode}`,
      );
    }

    const parsedGateNo = parseGateNumber(rawGateNo);
    const groupKey = buildKey(cluster, building, zone);
    const gateKey = buildKey(cluster, building, zone, parsedGateNo.gateNo);

    return {
      excelRow,
      cluster,
      building,
      zone,
      gateNo: parsedGateNo.gateNo,
      lane: parsedGateNo.lane,
      direction: parsedGateNo.direction,
      secretCode,
      groupKey,
      gateKey,
      locationExcelId: stableId('GATELOC', groupKey),
      gateExcelId: stableId('GATE', gateKey),
    };
  });

  const secretCodes = new Set();
  const gateKeys = new Set();

  for (const row of parsed) {
    if (secretCodes.has(row.secretCode)) {
      throw new Error(`Secret Code مكرر داخل Excel: ${row.secretCode}`);
    }
    secretCodes.add(row.secretCode);

    if (gateKeys.has(row.gateKey)) {
      throw new Error(
        `بوابة مكررة داخل Excel: ${row.building} / ${row.zone} / ${row.gateNo}`,
      );
    }
    gateKeys.add(row.gateKey);
  }

  const groups = new Map();
  for (const row of parsed) {
    if (!groups.has(row.groupKey)) groups.set(row.groupKey, []);
    groups.get(row.groupKey).push(row);
  }

  const invalidGroups = [];

  for (const groupRows of groups.values()) {
    const expected = new Set([
      '1 IN',
      '2 IN',
      '3 IN',
      '4 IN',
      '5 IN',
      '6 IN',
      '7 IN',
      '8 IN',
    ]);

    const actual = new Set(groupRows.map((row) => row.gateNo));
    const missing = [...expected].filter((value) => !actual.has(value));
    const extra = [...actual].filter((value) => !expected.has(value));

    if (groupRows.length !== 8 || missing.length > 0 || extra.length > 0) {
      invalidGroups.push({
        building: groupRows[0]?.building,
        cluster: groupRows[0]?.cluster,
        zone: groupRows[0]?.zone,
        count: groupRows.length,
        missing,
        extra,
      });
    }
  }

  if (invalidGroups.length > 0) {
    console.error('\n❌ جهات لا تحتوي على 8 بوابات صحيحة من 1 IN إلى 8 IN:');
    console.table(invalidGroups.slice(0, 30));
    throw new Error('فشل التحقق من عدد البوابات لكل جهة.');
  }

  return {
    sheetName,
    rows: parsed,
    groupCount: groups.size,
  };
}

async function getDependencyCounts() {
  const [inspections, tasks, taskItems, activityLogs] = await Promise.all([
    prisma.inspection.count({ where: { gateId: { not: null } } }),
    prisma.inspectionTask.count({ where: { gateId: { not: null } } }),
    prisma.inspectionTaskItem.count({ where: { gateId: { not: null } } }),
    prisma.technicianActivityLog.count({ where: { gateId: { not: null } } }),
  ]);

  return {
    inspections,
    tasks,
    taskItems,
    activityLogs,
    total: inspections + tasks + taskItems + activityLogs,
  };
}

async function createBackup(oldGates, dependencyCounts) {
  const backupDir = path.resolve(process.cwd(), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(
    backupDir,
    `gates-before-replace-${stamp}.json`,
  );

  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        dependencyCounts,
        gates: oldGates,
      },
      null,
      2,
    ),
    'utf8',
  );

  return backupPath;
}

async function main() {
  const fileArg = readArg('--file');
  const apply = hasFlag('--apply');

  if (!fileArg) {
    throw new Error(
      'اكتبي مسار الملف بعد --file، مثال:\n' +
        'node scripts/replace-gates-from-excel.cjs --file "C:\\backend\\imports\\Gates_Only_With_Secret_Codes.xlsx"',
    );
  }

  const filePath = path.resolve(fileArg);
  const excel = parseExcel(filePath);

  const [oldGates, dependencyCounts, allLocations] = await Promise.all([
    prisma.gate.findMany({ orderBy: { id: 'asc' } }),
    getDependencyCounts(),
    prisma.location.findMany({
      select: {
        id: true,
        building: true,
        cluster: true,
        zone: true,
        excelId: true,
      },
      orderBy: { id: 'asc' },
    }),
  ]);

  const locationMap = new Map();
  const duplicateLocationKeys = new Set();

  for (const location of allLocations) {
    const key = buildKey(location.cluster, location.building, location.zone);

    if (!locationMap.has(key)) {
      locationMap.set(key, location);
    } else {
      duplicateLocationKeys.add(key);
    }
  }

  const uniqueGroups = new Map();
  for (const row of excel.rows) {
    if (!uniqueGroups.has(row.groupKey)) uniqueGroups.set(row.groupKey, row);
  }

  const missingLocationRows = [...uniqueGroups.values()].filter(
    (row) => !locationMap.has(row.groupKey),
  );

  console.log('\n================ GATES REPLACE PREVIEW ================');
  console.log(`Excel file              : ${filePath}`);
  console.log(`Excel sheet             : ${excel.sheetName}`);
  console.log(`Excel gate rows         : ${excel.rows.length}`);
  console.log(`Ministry/location groups: ${excel.groupCount}`);
  console.log(`Expected 8 per group    : OK`);
  console.log(`Current Gate rows       : ${oldGates.length}`);
  console.log(`Missing Locations       : ${missingLocationRows.length}`);
  console.log(`Duplicate location keys : ${duplicateLocationKeys.size}`);
  console.log('Gate dependencies       :', dependencyCounts);
  console.log(`Mode                    : ${apply ? 'APPLY' : 'PREVIEW ONLY'}`);
  console.log('=======================================================\n');

  console.table(
    excel.rows.slice(0, 8).map((row) => ({
      cluster: row.cluster,
      building: row.building,
      zone: row.zone,
      gateNo: row.gateNo,
      secretCode: row.secretCode,
    })),
  );

  if (!apply) {
    console.log('\n✅ Preview انتهى بدون أي تعديل على قاعدة البيانات.');
    console.log('للتنفيذ الحقيقي أعيدي نفس الأمر مع --apply');
    return;
  }

  if (dependencyCounts.total > 0) {
    throw new Error(
      'تم إلغاء التنفيذ لحماية تاريخ التفتيش والمهام. يوجد Gate مرتبط بسجلات قديمة. ' +
        'لا تستخدمي TRUNCATE CASCADE. أرسلي نتيجة الـ Preview لعمل نقل غير مدمّر.',
    );
  }

  const backupPath = await createBackup(oldGates, dependencyCounts);
  console.log(`✅ Backup created: ${backupPath}`);

  const result = await prisma.$transaction(
    async (tx) => {
      const deleted = await tx.gate.deleteMany({});

      const txLocations = await tx.location.findMany({
        select: {
          id: true,
          building: true,
          cluster: true,
          zone: true,
          excelId: true,
        },
        orderBy: { id: 'asc' },
      });

      const txLocationMap = new Map();
      for (const location of txLocations) {
        const key = buildKey(location.cluster, location.building, location.zone);
        if (!txLocationMap.has(key)) txLocationMap.set(key, location);
      }

      let createdLocations = 0;

      for (const groupRow of uniqueGroups.values()) {
        if (txLocationMap.has(groupRow.groupKey)) continue;

        const created = await tx.location.upsert({
          where: { excelId: groupRow.locationExcelId },
          update: {
            building: groupRow.building,
            cluster: groupRow.cluster,
            zone: groupRow.zone,
            type: 'GATE',
          },
          create: {
            excelId: groupRow.locationExcelId,
            building: groupRow.building,
            cluster: groupRow.cluster,
            zone: groupRow.zone,
            type: 'GATE',
          },
          select: {
            id: true,
            building: true,
            cluster: true,
            zone: true,
            excelId: true,
          },
        });

        txLocationMap.set(groupRow.groupKey, created);
        createdLocations += 1;
      }

      const gateData = excel.rows.map((row) => {
        const location = txLocationMap.get(row.groupKey);

        if (!location) {
          throw new Error(
            `تعذر إيجاد/إنشاء Location للجهة: ${row.building} / ${row.zone}`,
          );
        }

        return {
          gateNo: row.gateNo,
          secretCode: row.secretCode,
          cluster: row.cluster,
          building: row.building,
          zone: row.zone,
          direction: row.direction,
          lane: row.lane,
          type: 'GATE',
          excelId: row.gateExcelId,
          locationId: location.id,
          notes: `Imported from ${path.basename(filePath)}`,
        };
      });

      const inserted = await tx.gate.createMany({
        data: gateData,
      });

      return {
        deleted: deleted.count,
        inserted: inserted.count,
        createdLocations,
      };
    },
    {
      maxWait: 10_000,
      timeout: 120_000,
    },
  );

  const [finalCount, uniqueSecretCount, firstRows] = await Promise.all([
    prisma.gate.count(),
    prisma.gate.groupBy({
      by: ['secretCode'],
      _count: { secretCode: true },
    }),
    prisma.gate.findMany({
      orderBy: [{ building: 'asc' }, { zone: 'asc' }, { gateNo: 'asc' }],
      take: 8,
      select: {
        id: true,
        cluster: true,
        building: true,
        zone: true,
        gateNo: true,
        secretCode: true,
        locationId: true,
      },
    }),
  ]);

  const duplicatedSecrets = uniqueSecretCount.filter(
    (item) => item._count.secretCode > 1,
  );

  if (finalCount !== excel.rows.length) {
    throw new Error(
      `عدد Gate النهائي غير صحيح. Expected=${excel.rows.length}, Actual=${finalCount}`,
    );
  }

  if (duplicatedSecrets.length > 0) {
    throw new Error('ظهر Secret Code مكرر بعد الحفظ، وهذا غير متوقع.');
  }

  console.log('\n==================== SUCCESS ====================');
  console.log(`Deleted old gates : ${result.deleted}`);
  console.log(`Inserted new gates: ${result.inserted}`);
  console.log(`Created locations : ${result.createdLocations}`);
  console.log(`Final gate count  : ${finalCount}`);
  console.log(`Secret codes      : UNIQUE`);
  console.log(`Backup            : ${backupPath}`);
  console.log('=================================================\n');
  console.table(firstRows);
}

main()
  .catch((error) => {
    console.error('\n❌ ERROR:', error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });