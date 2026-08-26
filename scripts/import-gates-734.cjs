const { PrismaClient } = require("@prisma/client");
const XLSX = require("xlsx");
const fs = require("fs");

const prisma = new PrismaClient();

// ======================================================
// SETTINGS
// ======================================================

const FILE = "C:\\backend\\Gates_734_With_Secret_Codes.xlsx";
const EXPECTED_ROWS = 734;

const APPLY = process.argv.includes("--apply");

// ======================================================
// HELPERS
// ======================================================

function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function nullable(value) {
  const result = cleanText(value);

  return result === "" ? null : result;
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./\\]+/g, "");
}

function findColumn(headers, aliases) {
  const normalizedAliases = aliases.map(normalizeHeader);

  return headers.find((header) => {
    return normalizedAliases.includes(
      normalizeHeader(header)
    );
  });
}

function findDuplicates(items) {
  const map = new Map();

  for (const item of items) {
    if (!item.value) continue;

    const key = String(item.value)
      .trim()
      .toLowerCase();

    if (!map.has(key)) {
      map.set(key, []);
    }

    map.get(key).push(item.row);
  }

  return [...map.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([value, rows]) => ({
      value,
      rows,
    }));
}

// ======================================================
// MAIN
// ======================================================

async function main() {
  console.log("");
  console.log("==============================================");
  console.log("          GATES IMPORT - SAFE MODE");
  console.log("==============================================");
  console.log("");

  // ====================================================
  // 1. CHECK EXCEL FILE
  // ====================================================

  if (!fs.existsSync(FILE)) {
    throw new Error(
      `Excel file was not found:\n${FILE}`
    );
  }

  console.log("Excel file found.");
  console.log(`File: ${FILE}`);
  console.log("");

  // ====================================================
  // 2. READ WORKBOOK
  // ====================================================

  const workbook = XLSX.readFile(FILE);

  if (!workbook.SheetNames.length) {
    throw new Error(
      "Excel workbook does not contain any sheets."
    );
  }

  console.log("Sheets:");

  workbook.SheetNames.forEach((sheet, index) => {
    console.log(`${index + 1}. ${sheet}`);
  });

  console.log("");

  // Prefer Gate_Codes if it exists
  const sheetName =
    workbook.SheetNames.find(
      (name) =>
        normalizeHeader(name) ===
        normalizeHeader("Gate_Codes")
    ) || workbook.SheetNames[0];

  const worksheet =
    workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(
    worksheet,
    {
      defval: "",
      raw: false,
    }
  );

  console.log(`Using sheet: ${sheetName}`);
  console.log(`Excel data rows: ${rows.length}`);
  console.log("");

  if (rows.length === 0) {
    throw new Error(
      "Excel sheet contains no data."
    );
  }

  // ====================================================
  // 3. DETECT HEADERS
  // ====================================================

  const headers = Object.keys(rows[0]);

  console.log("Detected columns:");
  console.log("");

  headers.forEach((header) => {
    console.log(`- ${header}`);
  });

  console.log("");

  // ====================================================
  // 4. MAP COLUMNS
  // ====================================================

  const columns = {
    gateNo: findColumn(headers, [
      "Gate Number",
      "Gate No",
      "GateNo",
      "Gate",
      "Gate Number No",
      "رقم البوابة",
      "رقم بوابة",
      "البوابة",
    ]),

    secretCode: findColumn(headers, [
      "Secret Code",
      "SecretCode",
      "Secret_Code",
      "Secret",
      "Code",
      "سيكرت كود",
      "الكود السري",
    ]),

    cluster: findColumn(headers, [
      "Cluster",
      "Cluster Name",
      "الكلاستر",
      "كلاستر",
    ]),

    building: findColumn(headers, [
      "Ministry / Building",
      "Ministry/Building",
      "Ministry Building",
      "Building",
      "Building Name",
      "Ministry",
      "Location",
      "المبنى",
      "الوزارة",
      "المكان",
    ]),

    zone: findColumn(headers, [
      "Zone",
      "Zone Name",
      "الزون",
      "زون",
    ]),

    direction: findColumn(headers, [
      "Direction",
      "Gate Direction",
      "IN/OUT",
      "IN OUT",
      "الاتجاه",
    ]),

    lane: findColumn(headers, [
      "Lane",
      "المسار",
    ]),

    type: findColumn(headers, [
      "Type",
      "Gate Type",
      "النوع",
    ]),

    excelId: findColumn(headers, [
      "Excel ID",
      "ExcelId",
      "Excel_Id",
      "Gate ID",
      "معرف",
    ]),
  };

  console.log("Column mapping:");
  console.log("");

  console.log(
    `Gate No     : ${columns.gateNo || "NOT FOUND"}`
  );

  console.log(
    `Secret Code : ${
      columns.secretCode
        ? "FOUND (VALUE HIDDEN)"
        : "NOT FOUND"
    }`
  );

  console.log(
    `Cluster     : ${columns.cluster || "NOT FOUND"}`
  );

  console.log(
    `Building    : ${columns.building || "NOT FOUND"}`
  );

  console.log(
    `Zone        : ${columns.zone || "not provided"}`
  );

  console.log(
    `Direction   : ${columns.direction || "not provided"}`
  );

  console.log(
    `Lane        : ${columns.lane || "not provided"}`
  );

  console.log(
    `Type        : ${columns.type || "not provided"}`
  );

  console.log(
    `Excel ID    : ${columns.excelId || "not provided"}`
  );

  console.log("");

  // ====================================================
  // 5. REQUIRED COLUMNS CHECK
  // ====================================================

  const required = [
    ["Gate Number", columns.gateNo],
    ["Secret Code", columns.secretCode],
    ["Cluster", columns.cluster],
    ["Ministry / Building", columns.building],
  ];

  const missingRequired =
    required.filter(([, column]) => !column);

  if (missingRequired.length > 0) {
    console.log("Missing required columns:");
    console.log("");

    for (const [name] of missingRequired) {
      console.log(`- ${name}`);
    }

    throw new Error(
      "Required Excel columns were not detected."
    );
  }

  // ====================================================
  // 6. PREPARE GATES
  // ====================================================

  const gates = [];

  const invalidRows = [];

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];

    // Excel row number:
    // Row 1 = headers
    const excelRow = index + 2;

    const gateNo =
      cleanText(row[columns.gateNo]);

    const secretCode =
      cleanText(row[columns.secretCode]);

    const cluster =
      cleanText(row[columns.cluster]);

    const building =
      cleanText(row[columns.building]);

    const zone =
      columns.zone
        ? nullable(row[columns.zone])
        : null;

    const direction =
      columns.direction
        ? nullable(row[columns.direction])
        : null;

    const lane =
      columns.lane
        ? nullable(row[columns.lane])
        : null;

    const type =
      columns.type
        ? nullable(row[columns.type])
        : null;

    const excelId =
      columns.excelId
        ? nullable(row[columns.excelId])
        : null;

    const missing = [];

    if (!gateNo) {
      missing.push("Gate Number");
    }

    if (!secretCode) {
      missing.push("Secret Code");
    }

    if (!cluster) {
      missing.push("Cluster");
    }

    if (!building) {
      missing.push("Ministry / Building");
    }

    if (missing.length > 0) {
      invalidRows.push({
        row: excelRow,
        missing,
      });

      continue;
    }

    gates.push({
      // Used internally only
      _excelRow: excelRow,

      gateNo,
      secretCode,
      cluster,
      building,
      zone,
      direction,
      lane,
      type,
      excelId,
    });
  }

  // ====================================================
  // 7. BASIC VALIDATION
  // ====================================================

  console.log("==============================================");
  console.log("                 VALIDATION");
  console.log("==============================================");
  console.log("");

  console.log(`Excel rows : ${rows.length}`);
  console.log(`Valid rows : ${gates.length}`);
  console.log(`Invalid    : ${invalidRows.length}`);

  console.log("");

  if (invalidRows.length > 0) {
    console.log("Invalid rows:");
    console.log("");

    invalidRows.forEach((item) => {
      console.log(
        `Excel Row ${item.row} -> Missing: ${item.missing.join(", ")}`
      );
    });

    console.log("");
  }

  // ====================================================
  // 8. EXACT 734 CHECK
  // ====================================================

  if (rows.length !== EXPECTED_ROWS) {
    throw new Error(
      `IMPORT BLOCKED: Excel contains ${rows.length} rows. Expected exactly ${EXPECTED_ROWS}.`
    );
  }

  if (gates.length !== EXPECTED_ROWS) {
    throw new Error(
      `IMPORT BLOCKED: Only ${gates.length} valid Gate records found. Expected ${EXPECTED_ROWS}.`
    );
  }

  console.log(
    `Row count check: PASSED (${EXPECTED_ROWS})`
  );

  // ====================================================
  // 9. SECRET CODE CHECK
  // ====================================================

  const secretEntries = gates.map((gate) => ({
    value: gate.secretCode,
    row: gate._excelRow,
  }));

  const duplicateSecrets =
    findDuplicates(secretEntries);

  if (duplicateSecrets.length > 0) {
    console.log("");
    console.log(
      "Duplicate Secret Codes were detected."
    );

    console.log(
      "Secret values will NOT be displayed."
    );

    console.log("");

    duplicateSecrets.forEach((duplicate, index) => {
      console.log(
        `Duplicate Secret #${index + 1} found in Excel rows: ${duplicate.rows.join(", ")}`
      );
    });

    throw new Error(
      "IMPORT BLOCKED: Duplicate Secret Codes found."
    );
  }

  console.log(
    `Secret Codes   : ${gates.length} present`
  );

  console.log(
    "Secret unique  : YES"
  );

  console.log(
    "Secret display : HIDDEN"
  );

  console.log("");

  // ====================================================
  // 10. EXCEL ID DUPLICATE CHECK
  // ====================================================

  const excelIdEntries = gates
    .filter((gate) => gate.excelId)
    .map((gate) => ({
      value: gate.excelId,
      row: gate._excelRow,
    }));

  const duplicateExcelIds =
    findDuplicates(excelIdEntries);

  if (duplicateExcelIds.length > 0) {
    console.log(
      "Duplicate Excel IDs detected:"
    );

    duplicateExcelIds.forEach(
      (duplicate, index) => {
        console.log(
          `Duplicate Excel ID #${index + 1} -> Rows: ${duplicate.rows.join(", ")}`
        );
      }
    );

    throw new Error(
      "IMPORT BLOCKED: Duplicate Excel IDs."
    );
  }

  // ====================================================
  // 11. DATABASE GATE COUNT
  // ====================================================

  const currentGateCount =
    await prisma.gate.count();

  console.log(
    `Current Gate records in DB: ${currentGateCount}`
  );

  console.log("");

  if (currentGateCount !== 0) {
    throw new Error(
      `IMPORT BLOCKED: Gate table currently contains ${currentGateCount} records. Gate table must be empty before importing.`
    );
  }

  // ====================================================
  // 12. PREPARE DATA FOR PRISMA
  //
  // _excelRow MUST NOT go to database.
  // ====================================================

  const databaseData = gates.map((gate) => ({
    gateNo: gate.gateNo,

    // Stored in backend DB.
    // NEVER PRINTED.
    secretCode: gate.secretCode,

    cluster: gate.cluster,
    building: gate.building,
    zone: gate.zone,
    direction: gate.direction,
    lane: gate.lane,
    type: gate.type,
    excelId: gate.excelId,
  }));

  // ====================================================
  // 13. PREVIEW MODE
  // ====================================================

  if (!APPLY) {
    console.log("==============================================");
    console.log("                PREVIEW PASSED");
    console.log("==============================================");
    console.log("");

    console.log(
      `Ready to import : ${databaseData.length} Gates`
    );

    console.log(
      `Secret Codes    : ${databaseData.length} stored internally`
    );

    console.log(
      "Secret values   : NOT DISPLAYED"
    );

    console.log(
      "Database change : NONE"
    );

    console.log("");

    console.log(
      "PREVIEW ONLY - NOTHING WAS INSERTED."
    );

    console.log("");

    console.log(
      "If everything above is correct, run:"
    );

    console.log("");

    console.log(
      "node .\\scripts\\import-gates-734.cjs --apply"
    );

    console.log("");

    return;
  }

  // ====================================================
  // 14. APPLY MODE
  // ====================================================

  console.log("==============================================");
  console.log("             STARTING IMPORT");
  console.log("==============================================");
  console.log("");

  console.log(
    `Importing ${databaseData.length} Gates...`
  );

  console.log(
    "Secret Code values remain hidden."
  );

  console.log("");

  const insertResult =
    await prisma.$transaction(
      async (tx) => {
        // Safety check again INSIDE transaction
        const countBefore =
          await tx.gate.count();

        if (countBefore !== 0) {
          throw new Error(
            `Gate table changed before import. Current count: ${countBefore}`
          );
        }

        const result =
          await tx.gate.createMany({
            data: databaseData,

            // We do NOT skip duplicates.
            // Any duplicate should fail the import.
            skipDuplicates: false,
          });

        if (result.count !== EXPECTED_ROWS) {
          throw new Error(
            `Only ${result.count} Gates were inserted instead of ${EXPECTED_ROWS}.`
          );
        }

        return result;
      },
      {
        timeout: 120000,
      }
    );

  // ====================================================
  // 15. VERIFY DATABASE
  // ====================================================

  const finalGateCount =
    await prisma.gate.count();

  const gatesWithSecret =
    await prisma.gate.count({
      where: {
        secretCode: {
          not: "",
        },
      },
    });

  // Check unique count WITHOUT printing values
  const secretRows =
    await prisma.gate.findMany({
      select: {
        secretCode: true,
      },
    });

  const uniqueSecretCount =
    new Set(
      secretRows.map((item) => item.secretCode)
    ).size;

  console.log("");
  console.log("==============================================");
  console.log("               IMPORT RESULT");
  console.log("==============================================");
  console.log("");

  console.log(
    `Inserted Gates          : ${insertResult.count}`
  );

  console.log(
    `Database Gate Count     : ${finalGateCount}`
  );

  console.log(
    `Gates with Secret Code  : ${gatesWithSecret}`
  );

  console.log(
    `Unique Secret Codes     : ${uniqueSecretCount}`
  );

  console.log("");

  // ====================================================
  // 16. FINAL SAFETY CHECK
  // ====================================================

  if (
    insertResult.count !== EXPECTED_ROWS ||
    finalGateCount !== EXPECTED_ROWS ||
    gatesWithSecret !== EXPECTED_ROWS ||
    uniqueSecretCount !== EXPECTED_ROWS
  ) {
    throw new Error(
      "FINAL VERIFICATION FAILED."
    );
  }

  console.log("==============================================");
  console.log("                   SUCCESS");
  console.log("==============================================");
  console.log("");

  console.log(
    "ALL 734 GATES IMPORTED SUCCESSFULLY."
  );

  console.log(
    "ALL 734 SECRET CODES STORED IN BACKEND DATABASE."
  );

  console.log(
    "ALL 734 SECRET CODES ARE UNIQUE."
  );

  console.log("");

  console.log(
    "SECURITY: NO SECRET CODE VALUE WAS PRINTED."
  );

  console.log("");
}

// ======================================================
// RUN
// ======================================================

main()
  .catch((error) => {
    console.error("");
    console.error("==============================================");
    console.error("                    FAILED");
    console.error("==============================================");
    console.error("");

    // Only print error message.
    // Never print objects containing secretCode.
    console.error(error.message);

    console.error("");
    console.error(
      "No Secret Code values were intentionally printed."
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });