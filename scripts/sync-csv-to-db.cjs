/**
 * sync-csv-to-db.cjs
 *
 * CSV -> Prisma Device
 *
 * FIX:
 * - DeviceCurrentStatus enum يتم اكتشافه تلقائياً من Prisma
 * - لا نفترض أن currentStatus = "active"
 * - يملأ الحقول المطلوبة تلقائياً قدر الإمكان
 * - CSV parser يدعم quotes
 * - يمنع مشاكل duplicate
 * - يعرض الخطأ الكامل
 */

const fs = require("fs");
const {
  PrismaClient,
  Prisma,
} = require("@prisma/client");

const prisma = new PrismaClient();

const CSV_FILE = "C:\\backend\\devices_fixed.csv";

const DEFAULT_DEVICE_NAME = "Morpho md";

/* =========================================================
   BASIC HELPERS
========================================================= */

function clean(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}

function isEmpty(value) {
  return (
    value === undefined ||
    value === null ||
    value === ""
  );
}

/* =========================================================
   CSV PARSER
========================================================= */

function parseCSVLine(line) {
  const result = [];

  let current = "";
  let insideQuotes = false;

  for (
    let i = 0;
    i < line.length;
    i++
  ) {
    const char = line[i];

    if (char === '"') {
      if (
        insideQuotes &&
        line[i + 1] === '"'
      ) {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }

      continue;
    }

    if (
      char === "," &&
      !insideQuotes
    ) {
      result.push(
        clean(current)
      );

      current = "";
    } else {
      current += char;
    }
  }

  result.push(
    clean(current)
  );

  return result;
}

function parseCSV(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return {
      headers: [],
      rows: [],
    };
  }

  const headers =
    parseCSVLine(lines[0]).map(
      (header) =>
        clean(header).toLowerCase()
    );

  const rows = [];

  for (
    let i = 1;
    i < lines.length;
    i++
  ) {
    const values =
      parseCSVLine(lines[i]);

    const row = {};

    headers.forEach(
      (header, index) => {
        row[header] =
          clean(
            values[index] || ""
          );
      }
    );

    rows.push(row);
  }

  return {
    headers,
    rows,
  };
}

/* =========================================================
   GET CSV VALUE
========================================================= */

function getVal(
  row,
  possibleNames
) {
  for (
    const name of possibleNames
  ) {
    const key =
      name.toLowerCase();

    if (
      row[key] !== undefined &&
      row[key] !== null &&
      clean(row[key]) !== ""
    ) {
      return clean(row[key]);
    }
  }

  return "";
}

/* =========================================================
   FIND PRISMA MODEL
========================================================= */

function getDeviceModel() {
  const models =
    prisma._runtimeDataModel?.models;

  if (!models) {
    throw new Error(
      "Cannot access Prisma runtime models."
    );
  }

  return (
    models.Device ||
    models.device
  );
}

/* =========================================================
   FIND FIELD
========================================================= */

function findField(
  model,
  names
) {
  if (!model) {
    return null;
  }

  for (
    const name of names
  ) {
    const field =
      model.fields.find(
        (f) =>
          f.name.toLowerCase() ===
          name.toLowerCase()
      );

    if (field) {
      return field;
    }
  }

  return null;
}

/* =========================================================
   ENUM VALUES
========================================================= */

/**
 * أهم جزء في الإصلاح.
 *
 * نحاول الحصول على DeviceCurrentStatus
 * من Prisma نفسه.
 */

function getEnumValues(
  enumName
) {
  /*
   * الطريقة الأولى:
   * Prisma exported enum
   */

  try {
    const exportedEnum =
      Prisma?.[enumName];

    if (
      exportedEnum &&
      typeof exportedEnum ===
        "object"
    ) {
      const values =
        Object.values(
          exportedEnum
        );

      if (values.length > 0) {
        return values;
      }
    }
  } catch (e) {}

  /*
   * الطريقة الثانية:
   * runtime datamodel
   */

  try {
    const runtime =
      prisma._runtimeDataModel;

    const enumTypes =
      runtime?.types
        ?.enumTypes
        ?.prisma;

    if (enumTypes) {
      const found =
        enumTypes.find(
          (item) =>
            item.name ===
            enumName
        );

      if (
        found &&
        Array.isArray(
          found.values
        )
      ) {
        return found.values.map(
          (v) => {
            if (
              typeof v ===
              "string"
            ) {
              return v;
            }

            return v.name;
          }
        );
      }
    }
  } catch (e) {}

  return [];
}

/* =========================================================
   RESOLVE DEVICE CURRENT STATUS
========================================================= */

function getDeviceCurrentStatus() {
  const values =
    getEnumValues(
      "DeviceCurrentStatus"
    );

  console.log(
    "\n🔎 DeviceCurrentStatus enum values:"
  );

  console.log(
    values
  );

  if (!values.length) {
    throw new Error(
      "❌ لم أستطع قراءة قيم DeviceCurrentStatus من Prisma."
    );
  }

  /*
   * نبحث عن قيمة مناسبة للحالة الطبيعية
   */

  const preferred = [
    "ACTIVE",
    "active",
    "ONLINE",
    "online",
    "ENABLED",
    "enabled",
    "AVAILABLE",
    "available",
    "CONNECTED",
    "connected",
    "NORMAL",
    "normal",
  ];

  for (
    const wanted of preferred
  ) {
    const found =
      values.find(
        (value) =>
          String(value) ===
          wanted
      );

    if (found) {
      console.log(
        `✅ سيتم استخدام currentStatus = ${found}`
      );

      return found;
    }
  }

  /*
   * لو مفيش قيمة معروفة،
   * نستخدم أول قيمة من enum
   * بدل ما نسقط كل الأجهزة.
   */

  console.log(
    `⚠️ لم نجد ACTIVE/ONLINE، سيتم استخدام أول قيمة: ${values[0]}`
  );

  return values[0];
}

/* =========================================================
   ENUM GENERIC DEFAULT
========================================================= */

function getFirstEnumValue(
  field
) {
  if (
    !field ||
    !field.type
  ) {
    return null;
  }

  const values =
    getEnumValues(
      field.type
    );

  if (
    values.length > 0
  ) {
    return values[0];
  }

  return null;
}

/* =========================================================
   SMART DEFAULT STRING
========================================================= */

function getSmartStringDefault(
  fieldName,
  context
) {
  const name =
    fieldName.toLowerCase();

  if (
    name.includes("devicename") ||
    name === "name"
  ) {
    return DEFAULT_DEVICE_NAME;
  }

  if (
    name.includes("barcode")
  ) {
    return (
      context.barcode ||
      "N/A"
    );
  }

  if (
    name.includes("serial")
  ) {
    return (
      context.serial ||
      "N/A"
    );
  }

  if (
    name.includes("code")
  ) {
    return (
      context.code ||
      "N/A"
    );
  }

  if (
    name.includes("ip")
  ) {
    return (
      context.ip ||
      "0.0.0.0"
    );
  }

  if (
    name.includes("secret")
  ) {
    return (
      context.secretCode ||
      "N/A"
    );
  }

  if (
    name.includes("cluster")
  ) {
    return (
      context.cluster ||
      "N/A"
    );
  }

  if (
    name.includes("building")
  ) {
    return (
      context.building ||
      "N/A"
    );
  }

  if (
    name.includes("zone")
  ) {
    return (
      context.zone ||
      "N/A"
    );
  }

  if (
    name.includes("lane")
  ) {
    return (
      context.lane ||
      "N/A"
    );
  }

  if (
    name.includes("direction")
  ) {
    return (
      context.direction ||
      "N/A"
    );
  }

  return "N/A";
}

/* =========================================================
   REQUIRED FIELD AUTO FILL
========================================================= */

function fillRequiredFields(
  data,
  model,
  context
) {
  for (
    const field of model.fields
  ) {
    /*
     * Optional
     */

    if (!field.isRequired) {
      continue;
    }

    /*
     * ID
     */

    if (field.isId) {
      continue;
    }

    /*
     * Prisma default
     */

    if (
      field.hasDefaultValue
    ) {
      continue;
    }

    /*
     * Already supplied
     */

    if (
      Object.prototype.hasOwnProperty.call(
        data,
        field.name
      ) &&
      !isEmpty(
        data[field.name]
      )
    ) {
      continue;
    }

    /*
     * RELATION
     */

    if (
      field.kind === "object"
    ) {
      const relation =
        field.name.toLowerCase();

      /*
       * DeviceType
       */

      if (
        relation.includes(
          "devicetype"
        ) ||
        relation === "type"
      ) {
        if (
          context.defaultTypeId !==
          null
        ) {
          data[field.name] = {
            connect: {
              id:
                context.defaultTypeId,
            },
          };
        }

        continue;
      }

      /*
       * Location
       */

      if (
        relation.includes(
          "location"
        )
      ) {
        if (
          context.defaultLocationId !==
          null
        ) {
          data[field.name] = {
            connect: {
              id:
                context.defaultLocationId,
            },
          };
        }

        continue;
      }

      /*
       * لو relation إجبارية
       * أخرى، نسيبها للـPrisma
       * عشان نعرف اسمها.
       */

      continue;
    }

    /*
     * ENUM
     */

    if (
      field.kind === "enum"
    ) {
      /*
       * currentStatus تحديداً
       */

      if (
        field.name ===
        "currentStatus" ||
        field.type ===
        "DeviceCurrentStatus"
      ) {
        data[field.name] =
          context.currentStatus;

        continue;
      }

      const enumValue =
        getFirstEnumValue(
          field
        );

      if (
        enumValue !== null
      ) {
        data[field.name] =
          enumValue;
      }

      continue;
    }

    /*
     * SCALAR
     */

    if (
      field.kind === "scalar"
    ) {
      switch (
        field.type
      ) {
        case "String":
          data[field.name] =
            getSmartStringDefault(
              field.name,
              context
            );
          break;

        case "Int":
          data[field.name] = 0;
          break;

        case "BigInt":
          data[field.name] =
            BigInt(0);
          break;

        case "Float":
          data[field.name] = 0;
          break;

        case "Decimal":
          data[field.name] = 0;
          break;

        case "Boolean":
          data[field.name] =
            false;
          break;

        case "DateTime":
          data[field.name] =
            new Date();
          break;

        case "Json":
          data[field.name] = {};
          break;

        default:
          break;
      }
    }
  }

  return data;
}

/* =========================================================
   BUILD CREATE DATA
========================================================= */

function buildCreateData({
  model,
  code,
  serial,
  ip,
  cluster,
  building,
  zone,
  lane,
  direction,
  secretCode,
  barcode,
  defaultTypeId,
  defaultLocationId,
  currentStatus,
}) {
  const data = {};

  /*
   * Device Code
   */

  const deviceCode =
    findField(model, [
      "deviceCode",
      "device_code",
      "code",
    ]);

  if (deviceCode) {
    data[deviceCode.name] =
      code || null;
  }

  /*
   * Serial
   */

  const serialField =
    findField(model, [
      "serialNumber",
      "serial",
      "serial_number",
    ]);

  if (serialField) {
    data[serialField.name] =
      serial || null;
  }

  /*
   * Device Name
   */

  const nameField =
    findField(model, [
      "deviceName",
      "name",
    ]);

  if (nameField) {
    data[nameField.name] =
      DEFAULT_DEVICE_NAME;
  }

  /*
   * IP
   */

  const ipField =
    findField(model, [
      "ipAddress",
      "ip",
      "ip_address",
    ]);

  if (ipField) {
    data[ipField.name] =
      ip || null;
  }

  /*
   * Secret
   */

  const secretField =
    findField(model, [
      "secretCode",
      "secret",
      "secret_code",
    ]);

  if (secretField) {
    data[secretField.name] =
      secretCode || null;
  }

  /*
   * Cluster
   */

  const clusterField =
    findField(model, [
      "gateCluster",
      "cluster",
    ]);

  if (clusterField) {
    data[clusterField.name] =
      cluster || null;
  }

  /*
   * Building
   */

  const buildingField =
    findField(model, [
      "gateBuilding",
      "building",
    ]);

  if (buildingField) {
    data[buildingField.name] =
      building || null;
  }

  /*
   * Zone
   */

  const zoneField =
    findField(model, [
      "gateZone",
      "zone",
    ]);

  if (zoneField) {
    data[zoneField.name] =
      zone || null;
  }

  /*
   * Lane
   */

  const laneField =
    findField(model, [
      "lane",
    ]);

  if (laneField) {
    data[laneField.name] =
      lane || null;
  }

  /*
   * Direction
   */

  const directionField =
    findField(model, [
      "gateDirection",
      "direction",
    ]);

  if (directionField) {
    data[directionField.name] =
      direction || null;
  }

  /*
   * Barcode
   */

  const barcodeField =
    findField(model, [
      "barcode",
    ]);

  if (barcodeField) {
    data[barcodeField.name] =
      barcode;
  }

  /*
   * Current Status
   *
   * هنا الإصلاح الحقيقي.
   */

  const statusField =
    findField(model, [
      "currentStatus",
    ]);

  if (statusField) {
    data[statusField.name] =
      currentStatus;
  }

  /*
   * Device Type FK
   */

  const deviceTypeIdField =
    findField(model, [
      "deviceTypeId",
      "device_type_id",
    ]);

  if (deviceTypeIdField) {
    data[
      deviceTypeIdField.name
    ] = defaultTypeId;
  }

  /*
   * Location FK
   */

  const locationIdField =
    findField(model, [
      "locationId",
      "location_id",
    ]);

  if (locationIdField) {
    data[
      locationIdField.name
    ] = defaultLocationId;
  }

  /*
   * Context
   */

  const context = {
    code,
    serial,
    ip,
    cluster,
    building,
    zone,
    lane,
    direction,
    secretCode,
    barcode,
    defaultTypeId,
    defaultLocationId,
    currentStatus,
  };

  /*
   * Auto fill
   */

  fillRequiredFields(
    data,
    model,
    context
  );

  return data;
}

/* =========================================================
   BUILD UPDATE DATA
========================================================= */

function buildUpdateData({
  model,
  code,
  serial,
  ip,
  cluster,
  building,
  zone,
  lane,
  direction,
  secretCode,
  barcode,
  currentStatus,
}) {
  const data = {};

  const deviceCode =
    findField(model, [
      "deviceCode",
      "device_code",
      "code",
    ]);

  if (
    deviceCode &&
    code
  ) {
    data[deviceCode.name] =
      code;
  }

  const serialField =
    findField(model, [
      "serialNumber",
      "serial",
      "serial_number",
    ]);

  if (serialField) {
    data[serialField.name] =
      serial || null;
  }

  const nameField =
    findField(model, [
      "deviceName",
      "name",
    ]);

  if (nameField) {
    data[nameField.name] =
      DEFAULT_DEVICE_NAME;
  }

  const ipField =
    findField(model, [
      "ipAddress",
      "ip",
      "ip_address",
    ]);

  if (ipField) {
    data[ipField.name] =
      ip || null;
  }

  const secretField =
    findField(model, [
      "secretCode",
      "secret",
      "secret_code",
    ]);

  if (secretField) {
    data[secretField.name] =
      secretCode || null;
  }

  const clusterField =
    findField(model, [
      "gateCluster",
      "cluster",
    ]);

  if (clusterField) {
    data[clusterField.name] =
      cluster || null;
  }

  const buildingField =
    findField(model, [
      "gateBuilding",
      "building",
    ]);

  if (buildingField) {
    data[buildingField.name] =
      building || null;
  }

  const zoneField =
    findField(model, [
      "gateZone",
      "zone",
    ]);

  if (zoneField) {
    data[zoneField.name] =
      zone || null;
  }

  const laneField =
    findField(model, [
      "lane",
    ]);

  if (laneField) {
    data[laneField.name] =
      lane || null;
  }

  const directionField =
    findField(model, [
      "gateDirection",
      "direction",
    ]);

  if (directionField) {
    data[directionField.name] =
      direction || null;
  }

  const barcodeField =
    findField(model, [
      "barcode",
    ]);

  if (barcodeField) {
    data[barcodeField.name] =
      barcode;
  }

  const statusField =
    findField(model, [
      "currentStatus",
    ]);

  if (statusField) {
    data[statusField.name] =
      currentStatus;
  }

  return data;
}

/* =========================================================
   MAIN
========================================================= */

async function main() {
  console.log(
    "============================================================"
  );

  console.log(
    "🚀 CSV → DATABASE DEVICE SYNC"
  );

  console.log(
    "============================================================\n"
  );

  /*
   * Check CSV
   */

  if (
    !fs.existsSync(
      CSV_FILE
    )
  ) {
    throw new Error(
      `❌ CSV غير موجود:\n${CSV_FILE}`
    );
  }

  /*
   * Read CSV
   */

  const content =
    fs.readFileSync(
      CSV_FILE,
      "utf8"
    );

  const {
    headers,
    rows,
  } = parseCSV(content);

  console.log(
    `📊 عدد الصفوف: ${rows.length}`
  );

  console.log(
    `📋 الأعمدة: ${headers.join(", ")}`
  );

  /*
   * Device Model
   */

  const deviceModel =
    getDeviceModel();

  if (!deviceModel) {
    throw new Error(
      "❌ Device model غير موجود."
    );
  }

  /*
   * Current Status
   */

  const currentStatus =
    getDeviceCurrentStatus();

  /*
   * Device Type
   */

  const defaultType =
    await prisma.deviceType.findFirst();

  if (!defaultType) {
    throw new Error(
      "❌ لا يوجد DeviceType."
    );
  }

  /*
   * Location
   */

  const defaultLoc =
    await prisma.location.findFirst();

  if (!defaultLoc) {
    throw new Error(
      "❌ لا يوجد Location."
    );
  }

  console.log(
    `\n✅ DeviceType ID: ${defaultType.id}`
  );

  console.log(
    `✅ Location ID: ${defaultLoc.id}`
  );

  console.log(
    `✅ CurrentStatus: ${currentStatus}\n`
  );

  /*
   * Counters
   */

  let updatedCount = 0;
  let insertedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  /*
   * Process rows
   */

  for (
    let i = 0;
    i < rows.length;
    i++
  ) {
    const row =
      rows[i];

    const rowNum =
      i + 2;

    /*
     * Read values
     */

    const code =
      getVal(row, [
        "device id",
        "device code",
        "code",
      ]);

    let serial =
      getVal(row, [
        "serial",
        "serial number",
      ]);

    const ip =
      getVal(row, [
        "ip",
        "ip address",
      ]);

    const cluster =
      getVal(row, [
        "cluster",
      ]);

    const building =
      getVal(row, [
        "building",
      ]);

    const zone =
      getVal(row, [
        "zone",
      ]);

    const lane =
      getVal(row, [
        "lane",
      ]);

    const direction =
      getVal(row, [
        "direction",
      ]);

    const secretCode =
      getVal(row, [
        "secret code",
      ]);

    /*
     * Invalid serial
     */

    if (
      serial &&
      (
        serial.includes(
          "مهنج"
        ) ||
        serial === "-" ||
        serial === "_"
      )
    ) {
      serial = "";
    }

    /*
     * Empty row
     */

    if (
      !code &&
      !serial
    ) {
      console.log(
        `⚠️ Row ${rowNum}: empty`
      );

      skippedCount++;

      continue;
    }

    /*
     * Barcode
     */

    const barcode =
      `${code || "NOCODE"}-` +
      `${serial || "NOSERIAL"}-` +
      `${building || "NOBUILDING"}-` +
      `${lane || "NOLANE"}`;

    try {
      console.log(
        `\n🔄 Row ${rowNum} | Code: ${code}`
      );

      /*
       * Find existing
       */

      const conditions = [];

      const codeField =
        findField(
          deviceModel,
          [
            "deviceCode",
            "device_code",
            "code",
          ]
        );

      const serialField =
        findField(
          deviceModel,
          [
            "serialNumber",
            "serial",
            "serial_number",
          ]
        );

      if (
        code &&
        codeField
      ) {
        conditions.push({
          [codeField.name]:
            code,
        });
      }

      if (
        serial &&
        serialField
      ) {
        conditions.push({
          [serialField.name]:
            serial,
        });
      }

      let existing =
        null;

      if (
        conditions.length > 0
      ) {
        existing =
          await prisma.device.findFirst({
            where: {
              OR: conditions,
            },
          });
      }

      /*
       * UPDATE
       */

      if (existing) {
        const updateData =
          buildUpdateData({
            model:
              deviceModel,
            code,
            serial,
            ip,
            cluster,
            building,
            zone,
            lane,
            direction,
            secretCode,
            barcode,
            currentStatus,
          });

        await prisma.device.update({
          where: {
            id: existing.id,
          },

          data:
            updateData,
        });

        console.log(
          `✅ Row ${rowNum}: UPDATED`
        );

        updatedCount++;

        continue;
      }

      /*
       * INSERT
       */

      const createData =
        buildCreateData({
          model:
            deviceModel,
          code,
          serial,
          ip,
          cluster,
          building,
          zone,
          lane,
          direction,
          secretCode,
          barcode,
          defaultTypeId:
            defaultType.id,
          defaultLocationId:
            defaultLoc.id,
          currentStatus,
        });

      console.log(
        "📦 INSERT DATA:"
      );

      console.log(
        JSON.stringify(
          createData,
          (key, value) =>
            typeof value ===
            "bigint"
              ? value.toString()
              : value,
          2
        )
      );

      await prisma.device.create({
        data:
          createData,
      });

      console.log(
        `🎉 Row ${rowNum}: INSERTED`
      );

      insertedCount++;
    } catch (error) {
      failedCount++;

      console.error(
        `\n❌❌❌ Row ${rowNum} FAILED`
      );

      console.error(
        `Code: ${code}`
      );

      console.error(
        "------------------------------------------------------------"
      );

      console.error(
        error.message ||
          error
      );

      if (error.code) {
        console.error(
          `Prisma Code: ${error.code}`
        );
      }

      if (error.meta) {
        console.error(
          "Prisma Meta:"
        );

        console.error(
          JSON.stringify(
            error.meta,
            null,
            2
          )
        );
      }

      console.error(
        "------------------------------------------------------------"
      );
    }
  }

  /*
   * RESULT
   */

  console.log(
    "\n============================================================"
  );

  console.log(
    "📊 FINAL RESULT"
  );

  console.log(
    "============================================================"
  );

  console.log(
    `✅ Updated  : ${updatedCount}`
  );

  console.log(
    `✅ Inserted : ${insertedCount}`
  );

  console.log(
    `⚠️ Skipped  : ${skippedCount}`
  );

  console.log(
    `❌ Failed   : ${failedCount}`
  );

  console.log(
    `📊 Total    : ${rows.length}`
  );

  console.log(
    "============================================================"
  );

  if (
    failedCount === 0
  ) {
    console.log(
      "\n🎉🎉🎉 مبرووووووووووك 🎉🎉🎉"
    );

    console.log(
      "كل الأجهزة اتضافت/اتحدثت بنجاح ❤️🔥"
    );
  } else {
    console.log(
      `\n⚠️ فشل ${failedCount} جهاز.`
    );
  }
}

/* =========================================================
   RUN
========================================================= */

main()
  .catch((error) => {
    console.error(
      "\n❌ FATAL ERROR:"
    );

    console.error(
      error.message ||
        error
    );

    if (error.stack) {
      console.error(
        "\nSTACK:"
      );

      console.error(
        error.stack
      );
    }

    process.exitCode = 1;
  })
  .finally(
    async () => {
      await prisma.$disconnect();
    }
  );