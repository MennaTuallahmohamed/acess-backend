// src/database/seeds/import-devices.js

const path = require("path");
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const FILE_PATH = path.join(process.cwd(), "cluster .xlsx");
const SHEET_NAME = "Sheet2";

function cleanValue(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
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

function normalizeStatus(status) {
  const raw = cleanValue(status);

  if (!raw) {
    return {
      currentStatus: "OK",
      excelStatus: null,
    };
  }

  const normalized = raw.toUpperCase();

  if (normalized === "OK") {
    return {
      currentStatus: "OK",
      excelStatus: raw,
    };
  }

  if (
    normalized === "FALSE" ||
    normalized === "FAULSE" ||
    normalized === "FAULT" ||
    normalized === "NOT OK" ||
    normalized === "NOT_OK"
  ) {
    return {
      currentStatus: "NEEDS_MAINTENANCE",
      excelStatus: raw,
    };
  }

  if (normalized.includes("MAINT")) {
    return {
      currentStatus: "UNDER_MAINTENANCE",
      excelStatus: raw,
    };
  }

  if (normalized.includes("OUT") || normalized.includes("SERVICE")) {
    return {
      currentStatus: "OUT_OF_SERVICE",
      excelStatus: raw,
    };
  }

  return {
    currentStatus: "NEEDS_MAINTENANCE",
    excelStatus: raw,
  };
}

function buildLocationExcelId(row) {
  return [
    getVal(row, "Cluster") || "NA",
    getVal(row, "Building") || "NA",
    getVal(row, "Zone") || "NA",
    getVal(row, "Lane") || "NA",
    getVal(row, "Direction", " Direction") || "NA",
  ].join("|");
}

function buildDeviceName(row) {
  const type = getVal(row, "Type") || "Device";
  const cluster = getVal(row, "Cluster");
  const building = getVal(row, "Building");
  const zone = getVal(row, "Zone");
  const lane = getVal(row, "Lane");
  const direction = getVal(row, "Direction", " Direction");

  const parts = [type];

  if (cluster) parts.push(`Cluster ${cluster}`);
  if (building) parts.push(`Building ${building}`);
  if (zone) parts.push(`Zone ${zone}`);
  if (lane) parts.push(`Lane ${lane}`);
  if (direction) parts.push(direction);

  return parts.join(" - ");
}

async function main() {
  const workbook = XLSX.readFile(FILE_PATH);
  const worksheet = workbook.Sheets[SHEET_NAME];

  if (!worksheet) {
    throw new Error(`Sheet "${SHEET_NAME}" not found in ${FILE_PATH}`);
  }

  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null });

  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const deviceCode = getVal(row, "ID", " ID");
    if (!deviceCode) {
      console.log("Skipping row, no deviceCode found:", row);
      skipped += 1;
      continue;
    }

    const typeName = getVal(row, "Type") || "Unknown";
    const serialNumber = getVal(row, "Serial NO.", " Serial NO.");
    const ipAddress = getVal(row, "IP ADDRESS", " IP ADDRESS");
    const firmware = getVal(row, "Firmware");
    const comment = getVal(row, "Comment");
    const excelDate = getVal(row, "Date");
    const { currentStatus, excelStatus } = normalizeStatus(
      getVal(row, "Status")
    );
    const barcode = String(deviceCode);
    const deviceName = buildDeviceName(row);
    const locationExcelId = buildLocationExcelId(row);

    const cluster = getVal(row, "Cluster") || "Unknown";
    const building = getVal(row, "Building") || "Unknown";
    const zone = getVal(row, "Zone");
    const type = getVal(row, "Type");
    const lane = getVal(row, "Lane");
    const direction = getVal(row, "Direction", " Direction");

    const deviceType = await prisma.deviceType.upsert({
      where: { name: typeName },
      update: {
        name: typeName,
      },
      create: {
        name: typeName,
      },
    });

    const location = await prisma.location.upsert({
      where: { excelId: locationExcelId },
      update: {
        cluster,
        building,
        zone,
        type,
        lane: lane ? String(lane) : null,
        direction,
      },
      create: {
        excelId: locationExcelId,
        cluster,
        building,
        zone,
        type,
        lane: lane ? String(lane) : null,
        direction,
      },
    });

    const existingBySerial = serialNumber
      ? await prisma.device.findFirst({
          where: {
            serialNumber: String(serialNumber),
            NOT: { deviceCode: String(deviceCode) },
          },
          select: { id: true, deviceCode: true },
        })
      : null;

    if (existingBySerial) {
      console.warn(
        `Skipped deviceCode=${deviceCode} because serialNumber=${serialNumber} already belongs to deviceCode=${existingBySerial.deviceCode}`
      );
      skipped += 1;
      continue;
    }

    await prisma.device.upsert({
      where: { deviceCode: String(deviceCode) },
      update: {
        deviceName,
        barcode,
        serialNumber: serialNumber ? String(serialNumber) : null,
        ipAddress,
        firmware,
        excelDate,
        excelStatus,
        currentStatus,
        notes: comment,
        locationId: location.id,
        deviceTypeId: deviceType.id,
      },
      create: {
        deviceCode: String(deviceCode),
        deviceName,
        barcode,
        serialNumber: serialNumber ? String(serialNumber) : null,
        ipAddress,
        firmware,
        excelDate,
        excelStatus,
        currentStatus,
        notes: comment,
        locationId: location.id,
        deviceTypeId: deviceType.id,
      },
    });

    imported += 1;
  }

  console.log(`Imported: ${imported}`);
  console.log(`Skipped: ${skipped}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });