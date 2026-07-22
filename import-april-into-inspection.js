const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const dotenv = require("dotenv");
const { PrismaClient } = require("@prisma/client");

/* =========================================================
   LOAD ENVIRONMENT
========================================================= */

const importEnvPath = path.join(__dirname, ".env.import");
const normalEnvPath = path.join(__dirname, ".env");

if (fs.existsSync(importEnvPath)) {
  dotenv.config({
    path: importEnvPath,
  });
}

if (fs.existsSync(normalEnvPath)) {
  dotenv.config({
    path: normalEnvPath,
    override: false,
  });
}

/* =========================================================
   SETTINGS
========================================================= */

const prisma = new PrismaClient();

const EXCEL_FILE =
  process.env.INSPECTIONS_FILE ||
  "C:\\backend\\April_2026_Completed_Inspections_All_Devices.xlsx";

const SHEET_NAME =
  process.env.INSPECTIONS_SHEET ||
  "Inspection_Import";

const TECHNICIAN_ID = process.env.TECHNICIAN_ID
  ? Number(process.env.TECHNICIAN_ID)
  : null;

const TECHNICIAN_NAME =
  process.env.TECHNICIAN_NAME ||
  "Mohamed Tohami";

const CREATE_ACTIVITY_LOG =
  String(process.env.CREATE_ACTIVITY_LOG || "YES").toUpperCase() === "YES";

const RESULT_FILE = path.join(
  __dirname,
  "april-inspection-import-result.json"
);

const ERRORS_FILE = path.join(
  __dirname,
  "april-inspection-import-errors.json"
);

/* =========================================================
   HELPERS
========================================================= */

function separator(character = "=", count = 72) {
  console.log(character.repeat(count));
}

function text(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function normalize(value) {
  return text(value)
    .toLowerCase()
    .replace(/\s+/g, "");
}

function normalizeIp(value) {
  return text(value)
    .toLowerCase()
    .replace(/\s+/g, "");
}

function integer(value) {
  const parsed = Number(value);

  return Number.isInteger(parsed)
    ? parsed
    : null;
}

function addToMap(map, key, device) {
  if (!key) {
    return;
  }

  if (!map.has(key)) {
    map.set(key, []);
  }

  map.get(key).push(device);
}

function uniqueCandidate(items) {
  if (!Array.isArray(items)) {
    return null;
  }

  const uniqueById = new Map();

  items.forEach((item) => {
    if (item?.id) {
      uniqueById.set(item.id, item);
    }
  });

  const uniqueItems = Array.from(uniqueById.values());

  return uniqueItems.length === 1
    ? uniqueItems[0]
    : null;
}

function intersection(first, second) {
  if (!first?.length || !second?.length) {
    return [];
  }

  const secondIds = new Set(
    second.map((item) => item.id)
  );

  return first.filter((item) =>
    secondIds.has(item.id)
  );
}

function excelDateParts(value) {
  if (!value) {
    return null;
  }

  if (
    value instanceof Date &&
    !Number.isNaN(value.getTime())
  ) {
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
    };
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);

    if (!parsed) {
      return null;
    }

    return {
      year: parsed.y,
      month: parsed.m,
      day: parsed.d,
    };
  }

  const stringValue = text(value);

  const isoMatch = stringValue.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})/
  );

  if (isoMatch) {
    return {
      year: Number(isoMatch[1]),
      month: Number(isoMatch[2]),
      day: Number(isoMatch[3]),
    };
  }

  const parsedDate = new Date(stringValue);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return {
    year: parsedDate.getFullYear(),
    month: parsedDate.getMonth() + 1,
    day: parsedDate.getDate(),
  };
}

function excelTimeParts(value) {
  if (value === undefined || value === null || value === "") {
    return {
      hour: 9,
      minute: 0,
      second: 0,
    };
  }

  if (
    value instanceof Date &&
    !Number.isNaN(value.getTime())
  ) {
    return {
      hour: value.getHours(),
      minute: value.getMinutes(),
      second: value.getSeconds(),
    };
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);

    if (parsed) {
      return {
        hour: parsed.H || 0,
        minute: parsed.M || 0,
        second: Math.floor(parsed.S || 0),
      };
    }

    const totalSeconds = Math.round(value * 86400);

    return {
      hour: Math.floor(totalSeconds / 3600) % 24,
      minute: Math.floor((totalSeconds % 3600) / 60),
      second: totalSeconds % 60,
    };
  }

  const stringValue = text(value);

  const timeMatch = stringValue.match(
    /^(\d{1,2}):(\d{2})(?::(\d{2}))?/
  );

  if (timeMatch) {
    return {
      hour: Number(timeMatch[1]),
      minute: Number(timeMatch[2]),
      second: Number(timeMatch[3] || 0),
    };
  }

  return {
    hour: 9,
    minute: 0,
    second: 0,
  };
}

function getInspectionDateTime(row) {
  const dateParts = excelDateParts(
    row["التاريخ"] ||
    row["Scheduled Date"]
  );

  const timeParts = excelTimeParts(
    row["الساعة"]
  );

  if (dateParts) {
    return new Date(
      dateParts.year,
      dateParts.month - 1,
      dateParts.day,
      timeParts.hour,
      timeParts.minute,
      timeParts.second,
      0
    );
  }

  const fallback =
    row["Inspection DateTime"] ||
    row["Completed At"] ||
    row["Last Inspection At"];

  if (fallback instanceof Date) {
    return fallback;
  }

  const parsed = new Date(fallback);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

function getInspectionMarker(row, index) {
  const excelInspectionId =
    text(row["Inspection ID"]) ||
    `APR26-INSP-${String(index + 1).padStart(6, "0")}`;

  return {
    excelInspectionId,
    marker: `[APRIL_IMPORT:${excelInspectionId}]`,
  };
}

/* =========================================================
   FIND TECHNICIAN
========================================================= */

async function findTechnician() {
  if (TECHNICIAN_ID) {
    const technician = await prisma.user.findUnique({
      where: {
        id: TECHNICIAN_ID,
      },
      select: {
        id: true,
        fullName: true,
        username: true,
        email: true,
        isActive: true,
      },
    });

    if (!technician) {
      throw new Error(
        `Technician ID ${TECHNICIAN_ID} was not found.`
      );
    }

    return technician;
  }

  const exactTechnician = await prisma.user.findFirst({
    where: {
      OR: [
        {
          fullName: {
            equals: TECHNICIAN_NAME,
            mode: "insensitive",
          },
        },
        {
          username: {
            equals: TECHNICIAN_NAME,
            mode: "insensitive",
          },
        },
        {
          email: {
            equals: TECHNICIAN_NAME,
            mode: "insensitive",
          },
        },
      ],
    },
    select: {
      id: true,
      fullName: true,
      username: true,
      email: true,
      isActive: true,
    },
  });

  if (exactTechnician) {
    return exactTechnician;
  }

  const nameParts = TECHNICIAN_NAME
    .split(/\s+/)
    .filter(Boolean);

  const lastName =
    nameParts[nameParts.length - 1] ||
    TECHNICIAN_NAME;

  const candidates = await prisma.user.findMany({
    where: {
      OR: [
        {
          fullName: {
            contains: lastName,
            mode: "insensitive",
          },
        },
        {
          username: {
            contains: lastName,
            mode: "insensitive",
          },
        },
        {
          email: {
            contains: lastName,
            mode: "insensitive",
          },
        },
      ],
    },
    select: {
      id: true,
      fullName: true,
      username: true,
      email: true,
      isActive: true,
    },
    take: 20,
  });

  if (candidates.length === 1) {
    return candidates[0];
  }

  console.log("");
  console.log("Technician candidates:");

  candidates.forEach((candidate) => {
    console.log(
      [
        `ID=${candidate.id}`,
        `Name=${candidate.fullName || "-"}`,
        `Username=${candidate.username || "-"}`,
        `Email=${candidate.email || "-"}`,
      ].join(" | ")
    );
  });

  throw new Error(
    candidates.length === 0
      ? `No user found for technician name: ${TECHNICIAN_NAME}`
      : `More than one technician matched "${TECHNICIAN_NAME}". Set TECHNICIAN_ID before running.`
  );
}

/* =========================================================
   BUILD DEVICE MAPS
========================================================= */

async function loadDeviceMaps() {
  console.log("Loading devices from PostgreSQL...");

  const devices = await prisma.device.findMany({
    select: {
      id: true,
      deviceCode: true,
      deviceName: true,
      barcode: true,
      serialNumber: true,
      ipAddress: true,
      lastInspectionAt: true,
      currentStatus: true,
      lifecycleStatus: true,

      location: {
        select: {
          id: true,
          cluster: true,
          building: true,
          zone: true,
          lane: true,
          direction: true,
          excelId: true,
        },
      },
    },
  });

  const maps = {
    devices,
    byId: new Map(),
    bySerial: new Map(),
    byIp: new Map(),
    byCode: new Map(),
    byBarcode: new Map(),
  };

  devices.forEach((device) => {
    maps.byId.set(device.id, device);

    addToMap(
      maps.bySerial,
      normalize(device.serialNumber),
      device
    );

    addToMap(
      maps.byIp,
      normalizeIp(device.ipAddress),
      device
    );

    addToMap(
      maps.byCode,
      normalize(device.deviceCode),
      device
    );

    addToMap(
      maps.byBarcode,
      normalize(device.barcode),
      device
    );
  });

  return maps;
}

/* =========================================================
   MATCH EXCEL ROW TO DEVICE
========================================================= */

function resolveDevice(row, maps) {
  const serial = normalize(
    row["Serial Number"]
  );

  const ipAddress = normalizeIp(
    row["IP Address"]
  );

  const deviceCode = normalize(
    row["Device Code"]
  );

  const barcode = normalize(
    row["Barcode"]
  );

  const sourceDeviceId = integer(
    row["Device ID"]
  );

  const serialCandidates =
    serial
      ? maps.bySerial.get(serial) || []
      : [];

  const ipCandidates =
    ipAddress
      ? maps.byIp.get(ipAddress) || []
      : [];

  const codeCandidates =
    deviceCode
      ? maps.byCode.get(deviceCode) || []
      : [];

  const barcodeCandidates =
    barcode
      ? maps.byBarcode.get(barcode) || []
      : [];

  if (
    serialCandidates.length > 0 &&
    ipCandidates.length > 0
  ) {
    const combined = intersection(
      serialCandidates,
      ipCandidates
    );

    const combinedDevice =
      uniqueCandidate(combined);

    if (combinedDevice) {
      return {
        device: combinedDevice,
        matchedBy: "SERIAL_AND_IP",
      };
    }

    if (combined.length === 0) {
      return {
        device: null,
        matchedBy: null,
        error:
          "Serial Number and IP Address point to different devices.",
      };
    }
  }

  const serialDevice =
    uniqueCandidate(serialCandidates);

  if (serialDevice) {
    return {
      device: serialDevice,
      matchedBy: "SERIAL_NUMBER",
    };
  }

  const ipDevice =
    uniqueCandidate(ipCandidates);

  if (ipDevice) {
    return {
      device: ipDevice,
      matchedBy: "IP_ADDRESS",
    };
  }

  const codeDevice =
    uniqueCandidate(codeCandidates);

  if (codeDevice) {
    return {
      device: codeDevice,
      matchedBy: "DEVICE_CODE",
    };
  }

  const barcodeDevice =
    uniqueCandidate(barcodeCandidates);

  if (barcodeDevice) {
    return {
      device: barcodeDevice,
      matchedBy: "BARCODE",
    };
  }

  /*
   * Device ID is used only as a final fallback.
   * It is rejected when Serial or IP conflicts with the database device.
   */
  if (sourceDeviceId) {
    const idDevice =
      maps.byId.get(sourceDeviceId);

    if (idDevice) {
      const serialConflict =
        serial &&
        normalize(idDevice.serialNumber) &&
        serial !== normalize(idDevice.serialNumber);

      const ipConflict =
        ipAddress &&
        normalizeIp(idDevice.ipAddress) &&
        ipAddress !== normalizeIp(idDevice.ipAddress);

      if (!serialConflict && !ipConflict) {
        return {
          device: idDevice,
          matchedBy: "DEVICE_ID_FALLBACK",
        };
      }
    }
  }

  const reasons = [];

  if (serialCandidates.length > 1) {
    reasons.push(
      `Serial matched ${serialCandidates.length} devices`
    );
  }

  if (ipCandidates.length > 1) {
    reasons.push(
      `IP matched ${ipCandidates.length} devices`
    );
  }

  if (!serial && !ipAddress && !deviceCode && !barcode) {
    reasons.push(
      "No Serial, IP, Device Code or Barcode"
    );
  }

  return {
    device: null,
    matchedBy: null,
    error:
      reasons.join("; ") ||
      "No matching device found in PostgreSQL.",
  };
}

/* =========================================================
   IMPORT ONE ROW
========================================================= */

async function importRow({
  row,
  index,
  technician,
  maps,
  existingImportKeys,
}) {
  const { excelInspectionId, marker } =
    getInspectionMarker(row, index);

  if (existingImportKeys.has(excelInspectionId)) {
    return {
      status: "SKIPPED_EXISTING",
      excelInspectionId,
    };
  }

  const inspectedAt =
    getInspectionDateTime(row);

  if (!inspectedAt) {
    return {
      status: "FAILED",
      excelInspectionId,
      error: "Inspection date/time is invalid.",
    };
  }

  const match = resolveDevice(row, maps);

  if (!match.device) {
    return {
      status: "DEVICE_NOT_FOUND",
      excelInspectionId,
      error: match.error,
    };
  }

  const device = match.device;

  const locationText =
    text(row["Location Text"]) ||
    [
      device.location?.cluster,
      device.location?.building,
      device.location?.zone,
      device.location?.lane,
      device.location?.direction,
    ]
      .filter(Boolean)
      .join(" | ");

  const originalNotes =
    text(row["Notes"]);

  const completionNote =
    text(row["Completion Note"]);

  const notes = [
    marker,
    "April 2026 Excel inspection import.",
    `Excel Inspection ID: ${excelInspectionId}`,
    `Matched by: ${match.matchedBy}`,
    `Serial Number: ${text(row["Serial Number"]) || "-"}`,
    `IP Address: ${text(row["IP Address"]) || "-"}`,
    originalNotes,
    completionNote,
    "Final Device Condition: OK",
  ]
    .filter(Boolean)
    .join("\n");

  const shouldUpdateLastInspection =
    !device.lastInspectionAt ||
    inspectedAt.getTime() >
      new Date(device.lastInspectionAt).getTime();

  const createdInspection =
    await prisma.$transaction(async (tx) => {
      const inspection =
        await tx.inspection.create({
          data: {
            deviceId: device.id,
            gateId: null,
            technicianId: technician.id,
            taskId: null,

            inspectionStatus: "OK",
            issueReason: "NO_ISSUE",
            notes,

            latitude: null,
            longitude: null,
            locationText,

            inspectedAt,
            createdAt: inspectedAt,
          },
          select: {
            id: true,
            deviceId: true,
            technicianId: true,
            inspectionStatus: true,
            inspectedAt: true,
          },
        });

      /*
       * Do not overwrite the current device status.
       * lastInspectionAt is updated only if this imported inspection
       * is newer than the current value.
       */
      if (shouldUpdateLastInspection) {
        await tx.device.update({
          where: {
            id: device.id,
          },
          data: {
            lastInspectionAt: inspectedAt,
          },
        });
      }

      if (CREATE_ACTIVITY_LOG) {
        await tx.technicianActivityLog.create({
          data: {
            userId: technician.id,
            action: "INSPECTION_CREATED",

            deviceId: device.id,
            inspectionId: inspection.id,

            title: "April 2026 Device Inspection",
            message:
              "Inspection imported from April 2026 Excel file. Device condition: OK.",

            beforeStatus: "OK",
            afterStatus: "OK",

            latitude: null,
            longitude: null,
            locationText,

            metadata: {
              source: "APRIL_2026_EXCEL_IMPORT",
              excelInspectionId,
              matchedBy: match.matchedBy,
              serialNumber:
                text(row["Serial Number"]) || null,
              ipAddress:
                text(row["IP Address"]) || null,
              sourceRow: index + 2,
            },

            createdAt: inspectedAt,
          },
        });
      }

      return inspection;
    });

  existingImportKeys.add(excelInspectionId);

  if (shouldUpdateLastInspection) {
    device.lastInspectionAt = inspectedAt;
  }

  return {
    status: "INSERTED",
    excelInspectionId,
    inspectionId: createdInspection.id,
    deviceId: device.id,
    matchedBy: match.matchedBy,
  };
}

/* =========================================================
   MAIN
========================================================= */

async function run() {
  separator();
  console.log("APRIL 2026 IMPORT INTO REAL INSPECTION TABLE");
  separator();

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL was not found in .env.import or .env"
    );
  }

  if (!fs.existsSync(EXCEL_FILE)) {
    throw new Error(
      `Excel file was not found:\n${EXCEL_FILE}`
    );
  }

  console.log(`Excel file      : ${EXCEL_FILE}`);
  console.log(`Excel sheet     : ${SHEET_NAME}`);
  console.log(`Technician name : ${TECHNICIAN_NAME}`);
  console.log(
    `Activity log    : ${CREATE_ACTIVITY_LOG ? "YES" : "NO"}`
  );

  separator("-");

  const workbook = XLSX.readFile(EXCEL_FILE, {
    cellDates: true,
    raw: true,
  });

  const sheet = workbook.Sheets[SHEET_NAME];

  if (!sheet) {
    throw new Error(
      [
        `Sheet "${SHEET_NAME}" was not found.`,
        `Available sheets: ${workbook.SheetNames.join(", ")}`,
      ].join("\n")
    );
  }

  const excelRows =
    XLSX.utils.sheet_to_json(sheet, {
      defval: "",
      raw: true,
    });

  console.log(`Excel rows      : ${excelRows.length}`);

  if (excelRows.length === 0) {
    throw new Error(
      "No rows were found in Inspection_Import."
    );
  }

  console.log("");
  console.log("Finding technician...");

  const technician =
    await findTechnician();

  console.log(
    [
      `Technician ID=${technician.id}`,
      `Name=${technician.fullName || "-"}`,
      `Username=${technician.username || "-"}`,
      `Email=${technician.email || "-"}`,
    ].join(" | ")
  );

  const maps = await loadDeviceMaps();

  console.log(
    `Devices loaded : ${maps.devices.length}`
  );

  const totalBefore =
    await prisma.inspection.count();

  const aprilStart = new Date(
    2026,
    3,
    1,
    0,
    0,
    0
  );

  const mayStart = new Date(
    2026,
    4,
    1,
    0,
    0,
    0
  );

  const aprilBefore =
    await prisma.inspection.count({
      where: {
        inspectedAt: {
          gte: aprilStart,
          lt: mayStart,
        },
      },
    });

  /*
   * Load old imported records to make the script safe to run again.
   */
  const oldImports =
    await prisma.inspection.findMany({
      where: {
        notes: {
          contains: "[APRIL_IMPORT:",
        },
      },
      select: {
        id: true,
        notes: true,
      },
    });

  const existingImportKeys = new Set();

  oldImports.forEach((inspection) => {
    const match = inspection.notes?.match(
      /\[APRIL_IMPORT:([^\]]+)\]/
    );

    if (match?.[1]) {
      existingImportKeys.add(match[1]);
    }
  });

  const stats = {
    totalExcelRows: excelRows.length,

    inserted: 0,
    skippedExisting: 0,
    deviceNotFound: 0,
    failed: 0,

    matchedBySerialAndIp: 0,
    matchedBySerial: 0,
    matchedByIp: 0,
    matchedByDeviceCode: 0,
    matchedByBarcode: 0,
    matchedByDeviceIdFallback: 0,

    totalInspectionsBefore: totalBefore,
    aprilInspectionsBefore: aprilBefore,

    totalInspectionsAfter: 0,
    aprilInspectionsAfter: 0,

    technician,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  const errors = [];

  console.log("");
  console.log("Starting import...");
  console.log("");

  for (
    let index = 0;
    index < excelRows.length;
    index++
  ) {
    const row = excelRows[index];

    try {
      const result = await importRow({
        row,
        index,
        technician,
        maps,
        existingImportKeys,
      });

      if (result.status === "INSERTED") {
        stats.inserted++;

        switch (result.matchedBy) {
          case "SERIAL_AND_IP":
            stats.matchedBySerialAndIp++;
            break;

          case "SERIAL_NUMBER":
            stats.matchedBySerial++;
            break;

          case "IP_ADDRESS":
            stats.matchedByIp++;
            break;

          case "DEVICE_CODE":
            stats.matchedByDeviceCode++;
            break;

          case "BARCODE":
            stats.matchedByBarcode++;
            break;

          case "DEVICE_ID_FALLBACK":
            stats.matchedByDeviceIdFallback++;
            break;
        }
      } else if (
        result.status === "SKIPPED_EXISTING"
      ) {
        stats.skippedExisting++;
      } else if (
        result.status === "DEVICE_NOT_FOUND"
      ) {
        stats.deviceNotFound++;

        errors.push({
          excelRow: index + 2,
          inspectionId:
            result.excelInspectionId,
          deviceId:
            text(row["Device ID"]) || null,
          deviceCode:
            text(row["Device Code"]) || null,
          serialNumber:
            text(row["Serial Number"]) || null,
          ipAddress:
            text(row["IP Address"]) || null,
          reason: result.error,
        });
      } else {
        stats.failed++;

        errors.push({
          excelRow: index + 2,
          inspectionId:
            result.excelInspectionId,
          reason: result.error,
        });
      }
    } catch (error) {
      stats.failed++;

      errors.push({
        excelRow: index + 2,
        inspectionId:
          text(row["Inspection ID"]) || null,
        deviceId:
          text(row["Device ID"]) || null,
        serialNumber:
          text(row["Serial Number"]) || null,
        ipAddress:
          text(row["IP Address"]) || null,
        reason: error.message,
        prismaCode: error.code || null,
      });
    }

    const processed = index + 1;

    if (
      processed % 50 === 0 ||
      processed === excelRows.length
    ) {
      console.log(
        [
          `Processed: ${processed}/${excelRows.length}`,
          `Inserted: ${stats.inserted}`,
          `Existing: ${stats.skippedExisting}`,
          `Not found: ${stats.deviceNotFound}`,
          `Failed: ${stats.failed}`,
        ].join(" | ")
      );
    }
  }

  stats.totalInspectionsAfter =
    await prisma.inspection.count();

  stats.aprilInspectionsAfter =
    await prisma.inspection.count({
      where: {
        inspectedAt: {
          gte: aprilStart,
          lt: mayStart,
        },
      },
    });

  stats.notUploaded =
    stats.deviceNotFound +
    stats.failed;

  stats.successful =
    stats.inserted +
    stats.skippedExisting;

  stats.finishedAt =
    new Date().toISOString();

  fs.writeFileSync(
    RESULT_FILE,
    JSON.stringify(stats, null, 2),
    "utf8"
  );

  fs.writeFileSync(
    ERRORS_FILE,
    JSON.stringify(errors, null, 2),
    "utf8"
  );

  console.log("");
  separator();
  console.log("REAL INSPECTION IMPORT COMPLETED");
  separator();

  console.log(
    `Total Excel rows          : ${stats.totalExcelRows}`
  );

  console.log(
    `New inspections inserted  : ${stats.inserted}`
  );

  console.log(
    `Already existed / skipped : ${stats.skippedExisting}`
  );

  console.log(
    `Devices not found         : ${stats.deviceNotFound}`
  );

  console.log(
    `Failed                    : ${stats.failed}`
  );

  console.log(
    `Not uploaded              : ${stats.notUploaded}`
  );

  separator("-");

  console.log(
    `Inspection count before   : ${stats.totalInspectionsBefore}`
  );

  console.log(
    `Inspection count after    : ${stats.totalInspectionsAfter}`
  );

  console.log(
    `April count before        : ${stats.aprilInspectionsBefore}`
  );

  console.log(
    `April count after         : ${stats.aprilInspectionsAfter}`
  );

  separator("-");

  console.log(
    `Matched Serial + IP       : ${stats.matchedBySerialAndIp}`
  );

  console.log(
    `Matched by Serial         : ${stats.matchedBySerial}`
  );

  console.log(
    `Matched by IP             : ${stats.matchedByIp}`
  );

  console.log(
    `Matched by Device Code    : ${stats.matchedByDeviceCode}`
  );

  console.log(
    `Matched by Barcode        : ${stats.matchedByBarcode}`
  );

  console.log(
    `Matched by Device ID      : ${stats.matchedByDeviceIdFallback}`
  );

  separator("-");

  console.log("Result file:");
  console.log(RESULT_FILE);

  console.log("");
  console.log("Errors file:");
  console.log(ERRORS_FILE);

  if (errors.length > 0) {
    console.log("");
    console.log("FIRST 20 ERRORS:");

    errors
      .slice(0, 20)
      .forEach((error, index) => {
        console.log(
          `${index + 1}. Excel row ${error.excelRow}: ${error.reason}`
        );
      });
  }

  separator();
}

/* =========================================================
   START
========================================================= */

run()
  .catch((error) => {
    console.log("");
    separator();
    console.error("IMPORT FAILED");
    separator();

    console.error(error.message);

    if (error.code) {
      console.error(
        `Error code: ${error.code}`
      );
    }

    console.error(`
Check the following:

1. DATABASE_URL exists in:
   C:\\backend\\.env.import
   or:
   C:\\backend\\.env

2. Excel exists:
   ${EXCEL_FILE}

3. Sheet exists:
   ${SHEET_NAME}

4. Prisma Client is generated:
   npx prisma generate

5. Technician exists in the User table.
`);

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });