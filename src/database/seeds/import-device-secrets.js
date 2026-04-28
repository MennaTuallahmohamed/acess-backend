const { PrismaClient } = require('@prisma/client');
const XLSX = require('xlsx');
const path = require('path');

const prisma = new PrismaClient();

function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/\s*\/\s*/g, '/')
    .trim();
}

function getValue(row, keys) {
  for (const key of keys) {
    if (
      row[key] !== undefined &&
      row[key] !== null &&
      String(row[key]).trim() !== ''
    ) {
      return clean(row[key]);
    }
  }
  return '';
}

function sameValue(a, b) {
  return normalize(a) === normalize(b);
}

async function findDeviceByExcelRow(row) {
  const cluster = getValue(row, ['Cluster', 'cluster', 'CLUSTER']);
  const building = getValue(row, ['Building', 'building', 'BUILDING']);
  const zone = getValue(row, ['Zone', 'zone', 'ZONE']);
  const lane = getValue(row, ['Lane', 'lane', 'LANE']);
  const direction = getValue(row, ['Direction', 'direction', 'DIRECTION']);

  const devices = await prisma.device.findMany({
    include: {
      location: true,
      deviceType: true,
    },
  });

  const matchedDevices = devices.filter((device) => {
    const location = device.location;

    if (!location) return false;

    const clusterMatch = sameValue(location.cluster, cluster);
    const buildingMatch = sameValue(location.building, building);
    const zoneMatch = zone ? sameValue(location.zone, zone) : true;
    const laneMatch = lane ? sameValue(location.lane, lane) : true;
    const directionMatch = direction
      ? sameValue(location.direction, direction)
      : true;

    return (
      clusterMatch &&
      buildingMatch &&
      zoneMatch &&
      laneMatch &&
      directionMatch
    );
  });

  return matchedDevices;
}

async function main() {
  const filePath = path.join(__dirname, 'secret-codes.xlsx');

  console.log('Reading Excel:', filePath);

  const workbook = XLSX.readFile(filePath);

  console.log('Sheets:', workbook.SheetNames);

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  console.log('Using sheet:', sheetName);

  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: '',
  });

  console.log('Rows count:', rows.length);

  let linked = 0;
  let skipped = 0;
  let failed = 0;
  let notFound = 0;
  let manyMatches = 0;
  let duplicateSecret = 0;
  let alreadyLinkedToSameDevice = 0;

  for (const row of rows) {
    try {
      const cluster = getValue(row, ['Cluster', 'cluster', 'CLUSTER']);
      const building = getValue(row, ['Building', 'building', 'BUILDING']);
      const zone = getValue(row, ['Zone', 'zone', 'ZONE']);
      const lane = getValue(row, ['Lane', 'lane', 'LANE']);
      const direction = getValue(row, ['Direction', 'direction', 'DIRECTION']);

      const secretCode = getValue(row, [
        'secrt',
        'secret',
        'Secret',
        'SECRET',
        'secret code',
        'Secret Code',
        'SECRET CODE',
        'secretCode',
        'SecretCode',
      ]);

      if (!cluster || !building || !secretCode) {
        skipped++;
        console.log('Skipped row because required data is empty:', row);
        continue;
      }

      const existingSecret = await prisma.device.findFirst({
        where: {
          secretCode: secretCode,
        },
      });

      if (existingSecret) {
        duplicateSecret++;
        console.log(
          `Secret already exists: ${secretCode} on deviceId=${existingSecret.id}`
        );
        continue;
      }

      const matchedDevices = await findDeviceByExcelRow(row);

      if (matchedDevices.length === 0) {
        notFound++;
        console.log('No device found for:', {
          cluster,
          building,
          zone,
          lane,
          direction,
          secretCode,
        });
        continue;
      }

      if (matchedDevices.length > 1) {
        manyMatches++;
        console.log('Many devices found for:', {
          cluster,
          building,
          zone,
          lane,
          direction,
          secretCode,
        });

        console.log(
          matchedDevices.map((device) => ({
            id: device.id,
            deviceCode: device.deviceCode,
            barcode: device.barcode,
            serialNumber: device.serialNumber,
            location: {
              cluster: device.location?.cluster,
              building: device.location?.building,
              zone: device.location?.zone,
              lane: device.location?.lane,
              direction: device.location?.direction,
            },
          }))
        );

        continue;
      }

      const device = matchedDevices[0];

      if (device.secretCode === secretCode) {
        alreadyLinkedToSameDevice++;
        console.log(
          `Already linked to same device: deviceId=${device.id}, secretCode=${secretCode}`
        );
        continue;
      }

      await prisma.device.update({
        where: {
          id: device.id,
        },
        data: {
          secretCode: secretCode,
        },
      });

      linked++;

      console.log(
        `Linked secretCode=${secretCode} to deviceId=${device.id}, deviceCode=${device.deviceCode}`
      );
    } catch (error) {
      failed++;
      console.error('Failed row:', row);
      console.error(error.message);
    }
  }

  console.log('--------------------------------');
  console.log('Linked:', linked);
  console.log('Already Linked To Same Device:', alreadyLinkedToSameDevice);
  console.log('Skipped Empty:', skipped);
  console.log('Not Found:', notFound);
  console.log('Many Matches:', manyMatches);
  console.log('Duplicate Secret:', duplicateSecret);
  console.log('Failed:', failed);
  console.log('--------------------------------');
}

main()
  .catch((error) => {
    console.error('Import failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });