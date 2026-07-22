const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");

/* =========================================================
   CONFIGURATION
========================================================= */

const EXCEL_FILE =
  "C:\\backend\\April_2026_Completed_Inspections_All_Devices.xlsx";

const IMPORT_URL =
  process.env.INSPECTIONS_IMPORT_URL ||
  "http://localhost:3001/inspections/import-excel";

// اسم الحقل الذي يستقبله Multer في الباك إند.
// غالبًا يكون file.
const FILE_FIELD_NAME = "file";

// اتركيه فارغًا لو الـ endpoint لا يحتاج Token.
const TOKEN = process.env.BACKEND_TOKEN || "";

// ملف حفظ النتيجة التي رجعت من الباك إند.
const RESULT_FILE =
  "C:\\backend\\april-inspections-import-result.json";

/* =========================================================
   HELPERS
========================================================= */

function separator(symbol = "=", count = 65) {
  console.log(symbol.repeat(count));
}

function getFirstNumber(object, keys) {
  for (const key of keys) {
    const value = object?.[key];

    if (
      value !== undefined &&
      value !== null &&
      value !== "" &&
      !Number.isNaN(Number(value))
    ) {
      return Number(value);
    }
  }

  return null;
}

function extractErrors(result) {
  const possibleErrors =
    result?.errors ||
    result?.failedRows ||
    result?.failures ||
    result?.rejectedRows ||
    result?.validationErrors ||
    [];

  return Array.isArray(possibleErrors) ? possibleErrors : [];
}

function formatError(error, index) {
  if (typeof error === "string") {
    return `${index + 1}. ${error}`;
  }

  const row =
    error?.row ||
    error?.rowNumber ||
    error?.excelRow ||
    error?.sourceRow ||
    error?.index ||
    "Unknown";

  const message =
    error?.message ||
    error?.error ||
    error?.reason ||
    error?.details ||
    JSON.stringify(error);

  return `${index + 1}. Row ${row}: ${message}`;
}

/* =========================================================
   IMPORT FUNCTION
========================================================= */

async function importInspections() {
  const absoluteFilePath = path.resolve(EXCEL_FILE);

  separator();
  console.log("APRIL 2026 INSPECTIONS IMPORT");
  separator();

  console.log(`Excel file : ${absoluteFilePath}`);
  console.log(`Upload URL : ${IMPORT_URL}`);
  console.log(`Field name : ${FILE_FIELD_NAME}`);
  console.log(`Token      : ${TOKEN ? "Included" : "Not included"}`);

  separator("-");

  if (!fs.existsSync(absoluteFilePath)) {
    throw new Error(
      `Excel file was not found:\n${absoluteFilePath}`
    );
  }

  const fileStats = fs.statSync(absoluteFilePath);

  if (!fileStats.isFile()) {
    throw new Error(
      `The supplied Excel path is not a file:\n${absoluteFilePath}`
    );
  }

  const extension = path.extname(absoluteFilePath).toLowerCase();

  if (![".xlsx", ".xls"].includes(extension)) {
    throw new Error(
      "The file must have the extension .xlsx or .xls"
    );
  }

  console.log(
    `File size  : ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`
  );

  console.log("");
  console.log("Uploading Excel file...");
  console.log("");

  const formData = new FormData();

  formData.append(
    FILE_FIELD_NAME,
    fs.createReadStream(absoluteFilePath),
    {
      filename: path.basename(absoluteFilePath),
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
  );

  // معلومات إضافية يمكن للباك إند قراءتها.
  formData.append("sheetName", "Inspection_Import");
  formData.append("inspectionMonth", "4");
  formData.append("inspectionYear", "2026");
  formData.append("defaultStatus", "OK");
  formData.append("technicianName", "Mohamed Tohami");

  const headers = {
    ...formData.getHeaders(),
    Accept: "application/json",
  };

  if (TOKEN) {
    headers.Authorization = `Bearer ${TOKEN}`;
  }

  const response = await axios.post(
    IMPORT_URL,
    formData,
    {
      headers,

      // السماح برفع ملف كبير.
      maxBodyLength: Infinity,
      maxContentLength: Infinity,

      // عشر دقائق.
      timeout: 10 * 60 * 1000,

      validateStatus: () => true,
    }
  );

  const responseData = response.data || {};

  // بعض الـ APIs ترجع النتيجة داخل data.
  const result =
    responseData.data &&
    typeof responseData.data === "object"
      ? responseData.data
      : responseData;

  fs.writeFileSync(
    RESULT_FILE,
    JSON.stringify(responseData, null, 2),
    "utf8"
  );

  if (response.status < 200 || response.status >= 300) {
    const backendMessage =
      result?.message ||
      result?.error ||
      response.statusText ||
      "Unknown backend error";

    throw new Error(
      [
        `Backend returned HTTP ${response.status}`,
        `Message: ${
          typeof backendMessage === "string"
            ? backendMessage
            : JSON.stringify(backendMessage)
        }`,
        `Full response saved in: ${RESULT_FILE}`,
      ].join("\n")
    );
  }

  /* =========================================================
     READ COUNTS FROM BACKEND RESPONSE
  ========================================================= */

  const totalRows =
    getFirstNumber(result, [
      "totalRows",
      "total",
      "totalRecords",
      "recordsCount",
      "processedRows",
      "processed",
    ]) ?? 0;

  const created =
    getFirstNumber(result, [
      "created",
      "createdCount",
      "inserted",
      "insertedCount",
      "successCount",
    ]) ?? 0;

  const updated =
    getFirstNumber(result, [
      "updated",
      "updatedCount",
    ]) ?? 0;

  const directUploaded = getFirstNumber(result, [
    "uploaded",
    "uploadedCount",
    "successful",
    "success",
  ]);

  const uploaded =
    directUploaded !== null
      ? directUploaded
      : created + updated;

  const skipped =
    getFirstNumber(result, [
      "skipped",
      "skippedCount",
      "ignored",
      "ignoredCount",
      "duplicates",
      "duplicateCount",
    ]) ?? 0;

  const failed =
    getFirstNumber(result, [
      "failed",
      "failedCount",
      "errorsCount",
      "errorCount",
      "rejected",
      "rejectedCount",
    ]) ?? 0;

  const errors = extractErrors(result);

  const calculatedFailed =
    failed > 0
      ? failed
      : errors.length;

  const notUploaded =
    skipped + calculatedFailed;

  const calculatedTotal =
    totalRows > 0
      ? totalRows
      : uploaded + skipped + calculatedFailed;

  /* =========================================================
     FINAL RESULT
  ========================================================= */

  console.log("");
  separator();
  console.log("IMPORT COMPLETED");
  separator();

  console.log(`Total Excel rows       : ${calculatedTotal}`);
  console.log(`Uploaded successfully  : ${uploaded}`);
  console.log(`Created                : ${created}`);
  console.log(`Updated                : ${updated}`);
  console.log(`Skipped                : ${skipped}`);
  console.log(`Failed                 : ${calculatedFailed}`);
  console.log(`Not uploaded           : ${notUploaded}`);

  separator("-");

  if (errors.length > 0) {
    console.log("");
    console.log(`ERROR DETAILS (${errors.length})`);
    console.log("");

    errors.forEach((error, index) => {
      console.log(formatError(error, index));
    });

    separator("-");
  } else {
    console.log("No row errors returned by the backend.");
  }

  console.log("");
  console.log(`Full backend response saved in:`);
  console.log(RESULT_FILE);

  console.log("");
  separator();

  console.log("BACKEND RESPONSE");
  console.dir(responseData, {
    depth: null,
    colors: true,
    maxArrayLength: 50,
  });

  separator();
}

/* =========================================================
   START
========================================================= */

importInspections()
  .then(() => {
    console.log("");
    console.log("Upload process finished.");
  })
  .catch((error) => {
    console.log("");
    separator();
    console.error("IMPORT FAILED");
    separator();

    if (error.code === "ECONNREFUSED") {
      console.error(
        "The backend is not running or port 3001 is incorrect."
      );
    } else if (error.code === "ETIMEDOUT") {
      console.error(
        "The request timed out while the backend was processing the Excel file."
      );
    } else if (error.code === "ECONNABORTED") {
      console.error(
        "The backend took too long to respond."
      );
    } else {
      console.error(error.message);
    }

    console.error(`
Check these settings:

1. Backend must be running:
   http://localhost:3001

2. The backend route must exist:
   POST /inspections/import-excel

3. Multer must receive the file using:
   upload.single("file")

4. Excel file must exist:
   ${EXCEL_FILE}

5. When authentication is required:
   Set BACKEND_TOKEN before running the script.
`);

    process.exit(1);
  });