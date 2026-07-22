const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const dotenv = require("dotenv");
const { PrismaClient } = require("@prisma/client");

/* =========================================================
   LOAD ENVIRONMENT VARIABLES
========================================================= */

const envImportPath = path.join(__dirname, ".env.import");
const envPath = path.join(__dirname, ".env");

if (fs.existsSync(envImportPath)) {
  dotenv.config({
    path: envImportPath,
  });
}

if (fs.existsSync(envPath)) {
  dotenv.config({
    path: envPath,
    override: false,
  });
}

/* =========================================================
   SETTINGS
========================================================= */

const prisma = new PrismaClient();

/*
 * المسار ثابت هنا، وبالتالي لن يقرأ مسار أبريل
 * الموجود داخل .env.import.
 */
const EXCEL_FILE =
  "C:\\backend\\June_2026_Completed_Inspections_All_Devices.xlsx";

const SHEET_NAME = "Inspection_Import";

/*
 * الفني الصحيح الذي ظهر عندك في الترمينال.
 */
const TECHNICIAN_ID = 46;

const RESULT_FILE = path.join(
  __dirname,
  "june-inspection-import-result.json"
);

const ERRORS_FILE = path.join(
  __dirname,
  "june-inspection-import-errors.json"
);

/* =========================================================
   GENERAL HELPERS
========================================================= */

function separator(character = "=", length = 74) {
  console.log(character.repeat(length));
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

function integerOrNull(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

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

function uniqueDevice(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const unique = new Map();

  for (const item of items) {
    if (item?.id) {
      unique.set(item.id, item);
    }
  }

  const devices = Array.from(unique.values());

  return devices.length === 1
    ? devices[0]
    : null;
}

function intersection(first, second) {
  if (!first?.length || !second?.length) {
    return [];
  }

  const secondIds = new Set(
    second.map((device) => device.id)
  );

  return first.filter((device) =>
    secondIds.has(device.id)
  );
}

/* =========================================================
   EXCEL DATE HELPERS
========================================================= */

function readDateParts(value) {
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

  const valueText = text(value);

  const isoMatch = valueText.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})/
  );

  if (isoMatch) {
    return {
      year: Number(isoMatch[1]),
      month: Number(isoMatch[2]),
      day: Number(isoMatch[3]),
    };
  }

  const parsedDate = new Date(valueText);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return {
    year: parsedDate.getFullYear(),
    month: parsedDate.getMonth() + 1,
    day: parsedDate.getDate(),
  };
}

function readTimeParts(value) {
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
  }

  const valueText = text(value);

  const timeMatch = valueText.match(
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
  const dateParts = readDateParts(
    row["التاريخ"] ||
    row["Scheduled Date"]
  );

  const timeParts = readTimeParts(
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

  const fallbackValue =
    row["Inspection DateTime"] ||
    row["Completed At"] ||
    row["Last Inspection At"];

  if (
    fallbackValue instanceof Date &&
    !Number.isNaN(fallbackValue.getTime())
  ) {
    return fallbackValue;
  }

  const fallbackDate = new Date(fallbackValue);

  return Number.isNaN(fallbackDate.getTime())
    ? null
    : fallbackDate;
}

/* =========================================================
   FIND TECHNICIAN
========================================================= */

async function getTechnician() {
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
      `Technician ID ${TECHNICIAN_ID} was not found in User table.`
    );
  }

  return technician;
}

/* =========================================================
   LOAD DEVICES
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
    byDeviceCode: new Map(),
    byBarcode: new Map(),
  };

  for (const device of devices) {
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
      maps.byDeviceCode,
      normalize(device.deviceCode),
      device
    );

    addToMap(
      maps.byBarcode,
      normalize(device.barcode),
      device
    );
  }

  return maps;
}

/* =========================================================
   DEVICE MATCHING
========================================================= */

function resolveDevice(row, maps) {
  const serialNumber = normalize(
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

  const excelDeviceId = integerOrNull(
    row["Device ID"]
  );

  const serialCandidates = serialNumber
    ? maps.bySerial.get(serialNumber) || []
    : [];

  const ipCandidates = ipAddress
    ? maps.byIp.get(ipAddress) || []
    : [];

  const deviceCodeCandidates = deviceCode
    ? maps.byDeviceCode.get(deviceCode) || []
    : [];

  const barcodeCandidates = barcode
    ? maps.byBarcode.get(barcode) || []
    : [];

  /*
   * أفضل مطابقة: Serial Number + IP Address.
   */
  if (
    serialCandidates.length > 0 &&
    ipCandidates.length > 0
  ) {
    const combinedDevice = uniqueDevice(
      intersection(
        serialCandidates,
        ipCandidates
      )
    );

    if (combinedDevice) {
      return {
        device: combinedDevice,
        matchedBy: "SERIAL_AND_IP",
      };
    }
  }

  /*
   * مطابقة Serial Number فقط.
   */
  const serialDevice = uniqueDevice(
    serialCandidates
  );

  if (serialDevice) {
    return {
      device: serialDevice,
      matchedBy: "SERIAL_NUMBER",
    };
  }

  /*
   * مطابقة IP Address فقط.
   */
  const ipDevice = uniqueDevice(
    ipCandidates
  );

  if (ipDevice) {
    return {
      device: ipDevice,
      matchedBy: "IP_ADDRESS",
    };
  }

  /*
   * مطابقة Device Code.
   */
  const codeDevice = uniqueDevice(
    deviceCodeCandidates
  );

  if (codeDevice) {
    return {
      device: codeDevice,
      matchedBy: "DEVICE_CODE",
    };
  }

  /*
   * مطابقة Barcode.
   */
  const barcodeDevice = uniqueDevice(
    barcodeCandidates
  );

  if (barcodeDevice) {
    return {
      device: barcodeDevice,
      matchedBy: "BARCODE",
    };
  }

  /*
   * استخدام Device ID كآخر اختيار.
   */
  if (
    excelDeviceId &&
    maps.byId.has(excelDeviceId)
  ) {
    const device = maps.byId.get(excelDeviceId);

    const serialConflict =
      serialNumber &&
      normalize(device.serialNumber) &&
      serialNumber !== normalize(device.serialNumber);

    const ipConflict =
      ipAddress &&
      normalizeIp(device.ipAddress) &&
      ipAddress !== normalizeIp(device.ipAddress);

    if (!serialConflict && !ipConflict) {
      return {
        device,
        matchedBy: "DEVICE_ID",
      };
    }
  }

  const reasons = [];

  if (serialCandidates.length > 1) {
    reasons.push(
      `Serial Number matched ${serialCandidates.length} devices`
    );
  }

  if (ipCandidates.length > 1) {
    reasons.push(
      `IP Address matched ${ipCandidates.length} devices`
    );
  }

  if (
    !serialNumber &&
    !ipAddress &&
    !deviceCode &&
    !barcode
  ) {
    reasons.push(
      "No Serial Number, IP Address, Device Code or Barcode"
    );
  }

  return {
    device: null,
    matchedBy: null,
    error:
      reasons.join("; ") ||
      "Device was not found in PostgreSQL.",
  };
}

/* =========================================================
   IMPORT ONE INSPECTION
========================================================= */

async function importInspection({
  row,
  rowIndex,
  technician,
  maps,
  existingImportIds,
}) {
  const excelInspectionId =
    text(row["Inspection ID"]) ||
    `JUN26-INSP-${String(rowIndex + 1).padStart(6, "0")}`;

  const marker =
    `[JUNE_IMPORT:${excelInspectionId}]`;

  /*
   * يمنع التكرار لو شغلنا السكربت مرة ثانية.
   */
  if (existingImportIds.has(excelInspectionId)) {
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
      error: "Inspection date or time is invalid.",
    };
  }

  /*
   * تأكيد أن التاريخ في يونيو 2026.
   */
  if (
    inspectedAt.getFullYear() !== 2026 ||
    inspectedAt.getMonth() !== 5
  ) {
    return {
      status: "FAILED",
      excelInspectionId,
      error:
        `Inspection date is not June 2026: ${inspectedAt.toISOString()}`,
    };
  }

  const match = resolveDevice(
    row,
    maps
  );

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

  const notes = [
    marker,
    "June 2026 Excel inspection import.",
    `Excel Inspection ID: ${excelInspectionId}`,
    `Matched by: ${match.matchedBy}`,
    `Device ID: ${device.id}`,
    `Serial Number: ${text(row["Serial Number"]) || "-"}`,
    `IP Address: ${text(row["IP Address"]) || "-"}`,
    text(row["Notes"]),
    text(row["Completion Note"]),
    "Final Device Condition: OK",
  ]
    .filter(Boolean)
    .join("\n");

  const shouldUpdateLastInspection =
    !device.lastInspectionAt ||
    inspectedAt >
      new Date(device.lastInspectionAt);

  const result = await prisma.$transaction(
    async (transaction) => {
      const inspection =
        await transaction.inspection.create({
          data: {
            deviceId: device.id,

            /*
             * لا يوجد Gate ID حقيقي داخل ملف الإكسيل.
             */
            gateId: null,

            technicianId: technician.id,

            /*
             * لا ننشئ Task وهمية داخل InspectionTask.
             */
            taskId: null,

            inspectionStatus: "OK",
            issueReason: "NO_ISSUE",

            notes,

            latitude: null,
            longitude: null,

            locationText,

            inspectedAt,
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
       * تحديث Last Inspection At على الجهاز
       * لأن يونيو أحدث من أبريل.
       */
      if (shouldUpdateLastInspection) {
        await transaction.device.update({
          where: {
            id: device.id,
          },
          data: {
            lastInspectionAt: inspectedAt,
          },
        });
      }

      return inspection;
    }
  );

  if (shouldUpdateLastInspection) {
    device.lastInspectionAt = inspectedAt;
  }

  existingImportIds.add(excelInspectionId);

  return {
    status: "INSERTED",
    excelInspectionId,
    inspectionId: result.id,
    deviceId: device.id,
    matchedBy: match.matchedBy,
  };
}

/* =========================================================
   MAIN IMPORT
========================================================= */

async function runImport() {
  separator();
  console.log(
    "JUNE 2026 IMPORT INTO REAL INSPECTION TABLE"
  );
  separator();

  if (!process.env.DATABASE_URL) {
    throw new Error(
      [
        "DATABASE_URL was not found.",
        "Add it to:",
        "C:\\backend\\.env.import",
      ].join("\n")
    );
  }

  if (!fs.existsSync(EXCEL_FILE)) {
    throw new Error(
      [
        "June Excel file was not found:",
        EXCEL_FILE,
      ].join("\n")
    );
  }

  console.log(`Excel file   : ${EXCEL_FILE}`);
  console.log(`Excel sheet  : ${SHEET_NAME}`);
  console.log(`Technician ID: ${TECHNICIAN_ID}`);

  separator("-");

  const workbook = XLSX.readFile(
    EXCEL_FILE,
    {
      cellDates: true,
      raw: true,
    }
  );

  const sheet =
    workbook.Sheets[SHEET_NAME];

  if (!sheet) {
    throw new Error(
      [
        `Sheet "${SHEET_NAME}" was not found.`,
        `Available sheets: ${workbook.SheetNames.join(", ")}`,
      ].join("\n")
    );
  }

  const excelRows =
    XLSX.utils.sheet_to_json(
      sheet,
      {
        defval: "",
        raw: true,
      }
    );

  if (excelRows.length === 0) {
    throw new Error(
      "No rows were found in Inspection_Import."
    );
  }

  console.log(`Excel rows   : ${excelRows.length}`);

  console.log("");
  console.log("Finding technician...");

  const technician =
    await getTechnician();

  console.log(
    [
      `Technician found`,
      `ID=${technician.id}`,
      `Name=${technician.fullName || "-"}`,
      `Username=${technician.username || "-"}`,
      `Email=${technician.email || "-"}`,
    ].join(" | ")
  );

  console.log("");

  const maps =
    await loadDeviceMaps();

  console.log(
    `Devices loaded: ${maps.devices.length}`
  );

  /*
   * عدد التفتيشات قبل الرفع.
   */
  const totalInspectionsBefore =
    await prisma.inspection.count();

  const juneStart = new Date(
    2026,
    5,
    1,
    0,
    0,
    0
  );

  const julyStart = new Date(
    2026,
    6,
    1,
    0,
    0,
    0
  );

  const juneInspectionsBefore =
    await prisma.inspection.count({
      where: {
        inspectedAt: {
          gte: juneStart,
          lt: julyStart,
        },
      },
    });

  /*
   * البحث عن سجلات يونيو التي تم رفعها من قبل.
   */
  const previousJuneImports =
    await prisma.inspection.findMany({
      where: {
        notes: {
          contains: "[JUNE_IMPORT:",
        },
      },
      select: {
        id: true,
        notes: true,
      },
    });

  const existingImportIds =
    new Set();

  for (
    const inspection of previousJuneImports
  ) {
    const match = inspection.notes?.match(
      /\[JUNE_IMPORT:([^\]]+)\]/
    );

    if (match?.[1]) {
      existingImportIds.add(match[1]);
    }
  }

  const statistics = {
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
    matchedByDeviceId: 0,

    totalInspectionsBefore,
    juneInspectionsBefore,

    totalInspectionsAfter: 0,
    juneInspectionsAfter: 0,

    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  const errors = [];

  console.log("");
  console.log("Starting June import...");
  console.log("");

  for (
    let rowIndex = 0;
    rowIndex < excelRows.length;
    rowIndex++
  ) {
    const row = excelRows[rowIndex];

    try {
      const result =
        await importInspection({
          row,
          rowIndex,
          technician,
          maps,
          existingImportIds,
        });

      if (result.status === "INSERTED") {
        statistics.inserted++;

        switch (result.matchedBy) {
          case "SERIAL_AND_IP":
            statistics.matchedBySerialAndIp++;
            break;

          case "SERIAL_NUMBER":
            statistics.matchedBySerial++;
            break;

          case "IP_ADDRESS":
            statistics.matchedByIp++;
            break;

          case "DEVICE_CODE":
            statistics.matchedByDeviceCode++;
            break;

          case "BARCODE":
            statistics.matchedByBarcode++;
            break;

          case "DEVICE_ID":
            statistics.matchedByDeviceId++;
            break;
        }
      } else if (
        result.status === "SKIPPED_EXISTING"
      ) {
        statistics.skippedExisting++;
      } else if (
        result.status === "DEVICE_NOT_FOUND"
      ) {
        statistics.deviceNotFound++;

        errors.push({
          excelRow: rowIndex + 2,
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
        statistics.failed++;

        errors.push({
          excelRow: rowIndex + 2,
          inspectionId:
            result.excelInspectionId,
          reason: result.error,
        });
      }
    } catch (error) {
      statistics.failed++;

      errors.push({
        excelRow: rowIndex + 2,
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

    const processed = rowIndex + 1;

    if (
      processed % 50 === 0 ||
      processed === excelRows.length
    ) {
      console.log(
        [
          `Processed: ${processed}/${excelRows.length}`,
          `Inserted: ${statistics.inserted}`,
          `Existing: ${statistics.skippedExisting}`,
          `Not found: ${statistics.deviceNotFound}`,
          `Failed: ${statistics.failed}`,
        ].join(" | ")
      );
    }
  }

  statistics.totalInspectionsAfter =
    await prisma.inspection.count();

  statistics.juneInspectionsAfter =
    await prisma.inspection.count({
      where: {
        inspectedAt: {
          gte: juneStart,
          lt: julyStart,
        },
      },
    });

  statistics.successful =
    statistics.inserted +
    statistics.skippedExisting;

  statistics.notUploaded =
    statistics.deviceNotFound +
    statistics.failed;

  statistics.finishedAt =
    new Date().toISOString();

  fs.writeFileSync(
    RESULT_FILE,
    JSON.stringify(
      statistics,
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(
    ERRORS_FILE,
    JSON.stringify(
      errors,
      null,
      2
    ),
    "utf8"
  );

  console.log("");
  separator();
  console.log(
    "JUNE INSPECTION IMPORT COMPLETED"
  );
  separator();

  console.log(
    `Total Excel rows          : ${statistics.totalExcelRows}`
  );

  console.log(
    `New inspections inserted  : ${statistics.inserted}`
  );

  console.log(
    `Already existed / skipped : ${statistics.skippedExisting}`
  );

  console.log(
    `Devices not found         : ${statistics.deviceNotFound}`
  );

  console.log(
    `Failed                    : ${statistics.failed}`
  );

  console.log(
    `Not uploaded              : ${statistics.notUploaded}`
  );

  separator("-");

  console.log(
    `Inspection count before   : ${statistics.totalInspectionsBefore}`
  );

  console.log(
    `Inspection count after    : ${statistics.totalInspectionsAfter}`
  );

  console.log(
    `June count before         : ${statistics.juneInspectionsBefore}`
  );

  console.log(
    `June count after          : ${statistics.juneInspectionsAfter}`
  );

  separator("-");

  console.log(
    `Matched Serial + IP       : ${statistics.matchedBySerialAndIp}`
  );

  console.log(
    `Matched by Serial         : ${statistics.matchedBySerial}`
  );

  console.log(
    `Matched by IP             : ${statistics.matchedByIp}`
  );

  console.log(
    `Matched by Device Code    : ${statistics.matchedByDeviceCode}`
  );

  console.log(
    `Matched by Barcode        : ${statistics.matchedByBarcode}`
  );

  console.log(
    `Matched by Device ID      : ${statistics.matchedByDeviceId}`
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
   START SCRIPT
========================================================= */

runImport()
  .catch((error) => {
    console.log("");
    separator();
    console.error("JUNE IMPORT FAILED");
    separator();

    console.error(error.message);

    if (error.code) {
      console.error(
        `Error code: ${error.code}`
      );
    }

    console.error(`
Check:

1. DATABASE_URL exists inside:
   C:\\backend\\.env.import

2. June Excel exists:
   C:\\backend\\June_2026_Completed_Inspections_All_Devices.xlsx

3. Technician ID 46 exists.

4. Prisma Client is generated:
   npx prisma generate
`);

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });