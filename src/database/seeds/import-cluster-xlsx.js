const path = require('path');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const filePath = path.join(__dirname, 'cluster .xlsx M.xlsx ALL.xlsx');

function clean(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function normalizeStatus(status) {
  const s = clean(status)?.toUpperCase();

  if (!s) return 'OK';

  if (['OK', 'NOT_OK', 'PARTIAL', 'NOT_REACHABLE'].includes(s)) {
    return s;
  }

  if (s === 'NOT OK') return 'NOT_OK';
  if (s === 'NOT REACHABLE') return 'NOT_REACHABLE';
  if (s === 'PARTIAL ') return 'PARTIAL';

  return 'OK';
}

async function upsertDeviceType(type) {
  if (!type) return null;

  return prisma.deviceType.upsert({
    where: { name: type },
    update: {},
    create: { name: type },
  });
}

async function upsertLocation(cluster, building, zone, lane, direction) {
  const excelId = [cluster, building, zone, lane, direction]
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
    .map((v) => String(v).trim())
    .join('_');

  if (!excelId) return null;

  return prisma.location.upsert({
    where: { excelId },
    update: {
      cluster: cluster || null,
      building: building || null,
      zone: zone || null,
      lane: lane || null,
      direction: direction || null,
    },
    create: {
      excelId,
      cluster: cluster || null,
      building: building || null,
      zone: zone || null,
      lane: lane || null,
      direction: direction || null,
    },
  });
}

async function upsertDevice(row) {
  const cluster = clean(row['Cluster']);
  const building = clean(row['Building']);
  const zone = clean(row['Zone']);
  const type = clean(row['Type']);
  const ipAddress = clean(row['IP ADDRESS']);
  const lane =
    row['Lane'] !== null && row['Lane'] !== undefined && row['Lane'] !== ''
      ? String(row['Lane']).trim()
      : null;
  const direction = clean(row['Direction']) || clean(row[' Direction']);
  const backendId =
    row['ID'] !== null && row['ID'] !== undefined && row['ID'] !== ''
      ? String(row['ID']).trim()
      : row[' ID'] !== null && row[' ID'] !== undefined && row[' ID'] !== ''
      ? String(row[' ID']).trim()
      : null;

  const serialNumber = clean(row['Serial NO.']);
  const firmware =
    row['Firmware'] !== null && row['Firmware'] !== undefined && row['Firmware'] !== ''
      ? String(row['Firmware']).trim()
      : null;
  const status = normalizeStatus(row['Status']);
  const comment = clean(row['Comment']);

  if (!serialNumber) {
    return { status: 'skipped', reason: 'Serial NO. is empty' };
  }

  const deviceTypeRecord = await upsertDeviceType(type);
  const locationRecord = await upsertLocation(
    cluster,
    building,
    zone,
    lane,
    direction,
  );

  await prisma.device.upsert({
    where: { serialNumber },
    update: {
      deviceCode: backendId || serialNumber,
      deviceName: type || serialNumber,
      barcode: backendId || serialNumber,
      currentStatus: status,
      firmware: firmware || null,
      notes: comment || null,
      ipAddress: ipAddress || null,
      deviceTypeId: deviceTypeRecord ? deviceTypeRecord.id : null,
      locationId: locationRecord ? locationRecord.id : null,
    },
    create: {
      serialNumber,
      deviceCode: backendId || serialNumber,
      deviceName: type || serialNumber,
      barcode: backendId || serialNumber,
      currentStatus: status,
      firmware: firmware || null,
      notes: comment || null,
      ipAddress: ipAddress || null,
      deviceTypeId: deviceTypeRecord ? deviceTypeRecord.id : null,
      locationId: locationRecord ? locationRecord.id : null,
    },
  });

  return {
    status: 'imported',
    serialNumber,
  };
}

async function main() {
  const workbook = XLSX.readFile(filePath);
  const sheetName = 'Sheet2';

  if (!workbook.Sheets[sheetName]) {
    console.log('Available sheets:', workbook.SheetNames);
    throw new Error(`Sheet "${sheetName}" not found`);
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    defval: null,
  });

  console.log(`Rows found in ${sheetName}: ${rows.length}`);

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const result = await upsertDevice(row);

      if (result.status === 'skipped') {
        skipped++;
        console.log(`Skipped row: ${result.reason}`);
        continue;
      }

      imported++;
      console.log(`Imported: ${result.serialNumber}`);
    } catch (err) {
      failed++;
      console.error('Failed row:', row);
      console.error(err.message);
    }
  }

  console.log('----------------------------');
  console.log('Imported:', imported);
  console.log('Skipped:', skipped);
  console.log('Failed:', failed);
}

main()
  .catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });