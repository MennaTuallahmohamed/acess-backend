const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function safe(value, fallback = 'Not specified') {
  if (value === null || value === undefined) return fallback;

  const text = String(value).trim();

  if (!text) return fallback;
  if (text.toLowerCase() === 'null') return fallback;
  if (text.toLowerCase() === 'undefined') return fallback;

  return text;
}

function getUserDisplayName(user) {
  if (!user) return 'Unknown';

  const fullName = safe(user.fullName, '');
  const username = safe(user.username, '');
  const email = safe(user.email, '');

  if (fullName && username) return `${fullName} (${username})`;
  if (fullName) return fullName;
  if (username) return username;
  if (email) return email;

  return `User ID ${user.id}`;
}

function getProblemText(inspection) {
  const firstInspectionIssue = inspection.inspectionIssues?.[0];

  const problemFromIssueNote = firstInspectionIssue?.notes;
  const problemFromInspectionReason = inspection.issueReason;
  const problemFromIssueTitle = firstInspectionIssue?.issue?.title;
  const problemFromDeviceNotes = inspection.device?.notes;

  return safe(
    problemFromIssueNote ||
      problemFromInspectionReason ||
      problemFromIssueTitle ||
      problemFromDeviceNotes,
    'عطل غير محدد'
  );
}

function buildLocationText(inspection) {
  const existingLocationText = safe(inspection.locationText, '');

  if (existingLocationText) {
    return existingLocationText;
  }

  const location = inspection.device?.location;

  return [
    location?.cluster,
    location?.building,
    location?.zone,
    location?.lane,
    location?.direction,
  ]
    .filter(Boolean)
    .join(' / ');
}

async function main() {
  console.log('Start fixing imported inspection notes...');

  const inspections = await prisma.inspection.findMany({
    where: {
      notes: {
        contains: 'Imported from Excel',
      },
    },
    include: {
      technician: {
        select: {
          id: true,
          fullName: true,
          username: true,
          email: true,
          phone: true,
          jobTitle: true,
        },
      },
      device: {
        include: {
          location: true,
          deviceType: true,
        },
      },
      inspectionIssues: {
        include: {
          issue: {
            include: {
              category: true,
              deviceType: true,
            },
          },
        },
      },
    },
    orderBy: {
      id: 'asc',
    },
  });

  console.log('Imported inspections found:', inspections.length);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const inspection of inspections) {
    try {
      const device = inspection.device;
      const firstInspectionIssue = inspection.inspectionIssues?.[0];
      const issue = firstInspectionIssue?.issue;

      if (!device) {
        skipped++;
        console.log(`Skipped inspectionId=${inspection.id}, no device found`);
        continue;
      }

      const problemText = getProblemText(inspection);
      const registeredBy = getUserDisplayName(inspection.technician);

      const locationText = buildLocationText(inspection);

      const excelStatus = safe(device.excelStatus, 'Not specified');
      const excelDate = safe(device.excelDate, 'Not specified');

      const issueCode = safe(issue?.issueCode, 'Not specified');
      const issueCategory = safe(issue?.category?.name, 'Not specified');
      const issueSeverity = safe(issue?.severity, 'Not specified');

      const deviceCode = safe(device.deviceCode);
      const deviceName = safe(device.deviceName);
      const deviceType = safe(device.deviceType?.name);
      const serialNumber = safe(device.serialNumber);
      const barcode = safe(device.barcode);
      const ipAddress = safe(device.ipAddress);
      const firmware = safe(device.firmware);

      const cluster = safe(device.location?.cluster);
      const building = safe(device.location?.building);
      const zone = safe(device.location?.zone);
      const lane = safe(device.location?.lane);
      const direction = safe(device.location?.direction);

      const newNotes = [
        'Imported from Excel',
        `Problem: ${problemText}`,
        `Issue Code: ${issueCode}`,
        `Issue Category: ${issueCategory}`,
        `Issue Severity: ${issueSeverity}`,
        `Registered By: ${registeredBy}`,
        `Device Code: ${deviceCode}`,
        `Device Name: ${deviceName}`,
        `Device Type: ${deviceType}`,
        `Barcode / Tag: ${barcode}`,
        `Serial Number: ${serialNumber}`,
        `IP Address: ${ipAddress}`,
        `Firmware: ${firmware}`,
        `Excel Status: ${excelStatus}`,
        `Excel Date: ${excelDate}`,
        `Cluster: ${cluster}`,
        `Building: ${building}`,
        `Zone: ${zone}`,
        `Lane: ${lane}`,
        `Direction: ${direction}`,
        `Location: ${locationText || 'Not specified'}`,
      ].join('\n');

      await prisma.inspection.update({
        where: {
          id: inspection.id,
        },
        data: {
          issueReason: problemText,
          notes: newNotes,
          locationText: locationText || inspection.locationText,
        },
      });

      if (firstInspectionIssue) {
        await prisma.inspectionIssue.update({
          where: {
            id: firstInspectionIssue.id,
          },
          data: {
            notes: problemText,
          },
        });
      }

      updated++;

      console.log(
        `Updated inspectionId=${inspection.id}, deviceCode=${deviceCode}, problem="${problemText}"`
      );
    } catch (error) {
      failed++;
      console.error(`Failed inspectionId=${inspection.id}`);
      console.error(error.message);
    }
  }

  console.log('--------------------------------');
  console.log('Updated:', updated);
  console.log('Skipped:', skipped);
  console.log('Failed:', failed);
  console.log('--------------------------------');
}

main()
  .catch((error) => {
    console.error('Fix failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });