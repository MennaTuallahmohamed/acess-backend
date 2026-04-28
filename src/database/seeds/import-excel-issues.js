const path = require('path');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const FILE_PATH = path.join(
  process.cwd(),
  'src',
  'database',
  'seeds',
  'cluster .xlsx M.xlsx ALL.xlsx'
);

const SHEET_NAME = 'Sheet2';


const SYSTEM_USER_ID = 19;

function cleanValue(value) {
  if (value === undefined || value === null) return null;

  const text = String(value).trim();

  if (!text) return null;
  if (text === '-') return null;
  if (text === '_') return null;
  if (text.toLowerCase() === 'null') return null;
  if (text.toLowerCase() === 'undefined') return null;

  return text;
}

function getVal(row, ...keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const value = cleanValue(row[key]);
      if (value !== null) return value;
    }
  }

  const normalizedEntries = Object.entries(row).map(([k, v]) => [
    String(k).trim(),
    v,
  ]);

  for (const key of keys) {
    const found = normalizedEntries.find(([k]) => k === String(key).trim());
    if (found) {
      const value = cleanValue(found[1]);
      if (value !== null) return value;
    }
  }

  return null;
}

function normalizeText(value) {
  const cleaned = cleanValue(value);

  if (!cleaned) return null;

  return String(cleaned).trim().replace(/\s+/g, ' ');
}

function normalizeStatus(status) {
  if (status === false) {
    return 'NOT_OK';
  }

  const raw = cleanValue(status);

  if (!raw) {
    return null;
  }

  const normalized = raw.toUpperCase().trim();

  if (normalized === 'OK') {
    return 'OK';
  }

  if (
    normalized === 'FALSE' ||
    normalized === 'FAULSE' ||
    normalized === 'FAULT' ||
    normalized === 'NOT OK' ||
    normalized === 'NOT_OK' ||
    normalized === 'BAD' ||
    normalized === 'ERROR'
  ) {
    return 'NOT_OK';
  }

  if (normalized.includes('MAINT')) {
    return 'NOT_OK';
  }

  if (normalized.includes('OUT') || normalized.includes('SERVICE')) {
    return 'NOT_REACHABLE';
  }

  return 'NOT_OK';
}

function isProblemRow(status, comment) {
  const normalizedStatus = normalizeStatus(status);
  const cleanComment = normalizeText(comment);

  if (normalizedStatus && normalizedStatus !== 'OK') return true;

  if (cleanComment) return true;

  return false;
}

function buildIssueTitle(status, comment) {
  const cleanComment = normalizeText(comment);

  if (cleanComment) return cleanComment;

  const normalizedStatus = normalizeStatus(status);

  if (normalizedStatus === 'NOT_REACHABLE') {
    return 'الجهاز غير متاح';
  }

  return 'عطل غير محدد من ملف الإكسيل';
}

function buildIssueCode(title, deviceTypeId) {
  let hash = 0;
  const text = `${String(title || 'UNKNOWN_ISSUE')}|${String(deviceTypeId || '0')}`;

  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }

  const safeHash = Math.abs(hash).toString(36).toUpperCase();

  return `XLS-${safeHash}`;
}

async function getSystemUser() {
  const user = await prisma.user.findUnique({
    where: {
      id: SYSTEM_USER_ID,
    },
  });

  if (!user) {
    throw new Error(
      `SYSTEM_USER_ID=${SYSTEM_USER_ID} مش موجود في جدول User. افتحي User في Prisma Studio وغيري الرقم.`
    );
  }

  return user;
}

async function getOrCreateCategory() {
  const existingByName = await prisma.issueCategory.findUnique({
    where: {
      name: 'Excel Imported Issues',
    },
  });

  if (existingByName) return existingByName;

  const existingByCode = await prisma.issueCategory.findFirst({
    where: {
      code: 'EXCEL_IMPORTED',
    },
  });

  if (existingByCode) return existingByCode;

  return prisma.issueCategory.create({
    data: {
      name: 'Excel Imported Issues',
      code: 'EXCEL_IMPORTED',
      description:
        'Problems imported automatically from Excel file comments/status',
    },
  });
}

async function getDeviceByExcelRow(row) {
  const deviceCode = getVal(row, 'ID', ' ID');
  const serialNumber = getVal(row, 'Serial NO.', ' Serial NO.', 'Serial NO');
  const ipAddress = getVal(row, 'IP ADDRESS', ' IP ADDRESS', 'IP');

  const orConditions = [];

  if (deviceCode) {
    orConditions.push({
      deviceCode: String(deviceCode),
    });
  }

  if (serialNumber) {
    orConditions.push({
      serialNumber: String(serialNumber),
    });
  }

  if (ipAddress) {
    orConditions.push({
      ipAddress: String(ipAddress),
    });
  }

  if (orConditions.length === 0) {
    return null;
  }

  return prisma.device.findFirst({
    where: {
      OR: orConditions,
    },
    include: {
      deviceType: true,
      location: true,
    },
  });
}

async function alreadyImportedIssueForDevice(deviceId, issueId) {
  const existing = await prisma.inspectionIssue.findFirst({
    where: {
      issueId,
      inspection: {
        deviceId,
        notes: {
          contains: 'Imported from Excel',
        },
      },
    },
    select: {
      id: true,
    },
  });

  return Boolean(existing);
}

async function main() {
  console.log('Reading Excel from:', FILE_PATH);

  await getSystemUser();

  const category = await getOrCreateCategory();

  const workbook = XLSX.readFile(FILE_PATH);
  const worksheet = workbook.Sheets[SHEET_NAME];

  if (!worksheet) {
    throw new Error(`Sheet "${SHEET_NAME}" not found in ${FILE_PATH}`);
  }

  const rows = XLSX.utils.sheet_to_json(worksheet, {
    defval: null,
  });

  console.log('Rows found:', rows.length);

  let totalRows = 0;
  let problemRows = 0;
  let devicesUpdated = 0;
  let inspectionsCreated = 0;
  let issuesCreatedOrFound = 0;
  let inspectionIssuesCreated = 0;
  let skippedOk = 0;
  let skippedNoDevice = 0;
  let skippedDuplicate = 0;
  let failed = 0;

  for (const row of rows) {
    totalRows += 1;

    try {
      const status = getVal(row, 'Status', ' STATUS');
      const comment = getVal(row, 'Comment', ' COMMENT');

      if (!isProblemRow(status, comment)) {
        skippedOk += 1;
        continue;
      }

      problemRows += 1;

      const device = await getDeviceByExcelRow(row);

      if (!device) {
        skippedNoDevice += 1;
        console.log('No device found for row:', {
          id: getVal(row, 'ID', ' ID'),
          serialNumber: getVal(row, 'Serial NO.', ' Serial NO.', 'Serial NO'),
          ipAddress: getVal(row, 'IP ADDRESS', ' IP ADDRESS', 'IP'),
          status,
          comment,
        });
        continue;
      }

      const issueTitle = buildIssueTitle(status, comment);
      const issueCode = buildIssueCode(issueTitle, device.deviceTypeId);

      const issue = await prisma.issue.upsert({
        where: {
          issueCode,
        },
        update: {
          title: issueTitle,
          description: `Imported from Excel. Original Status: ${
            status === null || status === undefined ? '' : String(status)
          }`,
          severity: 'MEDIUM',
          status: 'ACTIVE',
          categoryId: category.id,
          deviceTypeId: device.deviceTypeId,
        },
        create: {
          issueCode,
          title: issueTitle,
          description: `Imported from Excel. Original Status: ${
            status === null || status === undefined ? '' : String(status)
          }`,
          severity: 'MEDIUM',
          status: 'ACTIVE',
          categoryId: category.id,
          deviceTypeId: device.deviceTypeId,
        },
      });

      issuesCreatedOrFound += 1;

      const isDuplicate = await alreadyImportedIssueForDevice(
        device.id,
        issue.id
      );

      if (isDuplicate) {
        skippedDuplicate += 1;
        console.log(
          `Skipped duplicate issue for deviceCode=${device.deviceCode}, issue="${issueTitle}"`
        );
        continue;
      }

      await prisma.device.update({
        where: {
          id: device.id,
        },
        data: {
          currentStatus: 'NEEDS_MAINTENANCE',
          notes: comment ? String(comment) : device.notes,
        },
      });

      devicesUpdated += 1;

      const locationText = [
        device.location?.cluster,
        device.location?.building,
        device.location?.zone,
        device.location?.lane,
        device.location?.direction,
      ]
        .filter(Boolean)
        .join(' / ');

      const inspection = await prisma.inspection.create({
        data: {
          deviceId: device.id,
          technicianId: SYSTEM_USER_ID,
          inspectionStatus: 'NOT_OK',
          issueReason: issueTitle,
          notes: `Imported from Excel. Status: ${
            status === null || status === undefined ? '' : String(status)
          }`,
          locationText,
        },
      });

      inspectionsCreated += 1;

      await prisma.inspectionIssue.create({
        data: {
          inspectionId: inspection.id,
          issueId: issue.id,
          reportedById: SYSTEM_USER_ID,
          status: 'OPEN',
          notes: comment ? String(comment) : null,
        },
      });

      inspectionIssuesCreated += 1;

      console.log(
        `Imported issue for deviceCode=${device.deviceCode}, issue="${issueTitle}"`
      );
    } catch (error) {
      failed += 1;
      console.error('Failed row:', row);
      console.error(error.message);
    }
  }

  console.log('--------------------------------');
  console.log('Total Rows:', totalRows);
  console.log('Problem Rows In Excel:', problemRows);
  console.log('Devices Updated:', devicesUpdated);
  console.log('Inspections Created:', inspectionsCreated);
  console.log('Issues Created Or Found:', issuesCreatedOrFound);
  console.log('Inspection Issues Created:', inspectionIssuesCreated);
  console.log('Skipped OK:', skippedOk);
  console.log('Skipped No Device:', skippedNoDevice);
  console.log('Skipped Duplicate:', skippedDuplicate);
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