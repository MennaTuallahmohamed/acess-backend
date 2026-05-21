const path = require('path');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DATA_DIR = path.join(__dirname, 'data');

const FILES = [
  {
    categoryName: 'Access',
    categoryDescription: 'Access control / Reader / Morpho problems and solutions',
    fileName: 'Reader problems and solutions (1).xlsx',
    problemSheetName: 'المشكلات',
    solutionSheetName: ' الحلول',
    deviceTypeKeywords: ['access', 'reader', 'morpho'],
    fallbackDeviceTypeName: 'Access Control',
    codePrefix: 'ACCESS',
  },
  {
    categoryName: 'Gate',
    categoryDescription: 'Gate / Argus problems and solutions',
    fileName: 'Gate problems and solutions (1).xlsx',
    problemSheetName: 'المشكلات',
    solutionSheetName: ' الحلول',
    deviceTypeKeywords: ['gate', 'argus'],
    fallbackDeviceTypeName: 'Gates',
    codePrefix: 'GATE',
  },
];

const now = () => new Date();

const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

const cleanText = (value) => String(value ?? '').trim();

const safeCode = (value) =>
  String(value || '')
    .replace(/[^A-Za-z0-9]+/g, '')
    .toUpperCase()
    .slice(0, 16);

function readSheetRows(workbook, preferredSheetName) {
  const sheetName =
    workbook.SheetNames.find((name) => name.trim() === preferredSheetName.trim()) ||
    preferredSheetName;

  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error(`Sheet not found: ${preferredSheetName}`);
  }

  return XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw: false,
  });
}

function readProblemsFromFile(filePath, problemSheetName) {
  const workbook = XLSX.readFile(filePath);
  const rows = readSheetRows(workbook, problemSheetName);

  return rows
    .map((row) => ({
      code: cleanText(row['Problem ID']),
      description: cleanText(row['Description (Arabic)']),
    }))
    .filter((item) => item.code && item.description);
}

function readSolutionsFromFile(filePath, solutionSheetName) {
  const workbook = XLSX.readFile(filePath);
  const rows = readSheetRows(workbook, solutionSheetName);

  return rows
    .map((row) => {
      const solution =
        cleanText(row['Solution (Arabic)']) ||
        cleanText(row['Solution Action (Arabic)']);

      return {
        code: cleanText(row['Solution ID']),
        description: solution,
        relatedRaw: cleanText(row['Related Problem IDs']),
      };
    })
    .filter((item) => item.code && item.description);
}

function parseRelatedProblemCodes(raw, allProblemCodes) {
  const value = cleanText(raw);

  if (!value || value === '-') {
    return allProblemCodes;
  }

  return value
    .split(',')
    .map((item) => cleanText(item))
    .filter(Boolean);
}

async function getColumns(tableName) {
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    tableName,
  );

  return new Set(rows.map((row) => row.column_name));
}

async function insertReturningId(tableName, data) {
  const columns = await getColumns(tableName);

  const entries = Object.entries(data).filter(([key, value]) => {
    return columns.has(key) && value !== undefined;
  });

  if (!entries.length) {
    throw new Error(`No matching columns for table ${tableName}`);
  }

  const columnSql = entries.map(([key]) => quote(key)).join(', ');
  const valueSql = entries.map((_, index) => `$${index + 1}`).join(', ');
  const values = entries.map(([, value]) => value);

  const rows = await prisma.$queryRawUnsafe(
    `
      INSERT INTO ${quote(tableName)} (${columnSql})
      VALUES (${valueSql})
      RETURNING "id"
    `,
    ...values,
  );

  return Number(rows[0].id);
}

async function getOrCreateCategory(name, description) {
  const existing = await prisma.$queryRawUnsafe(
    `
      SELECT "id"
      FROM "IssueCategory"
      WHERE lower("name") = lower($1)
      LIMIT 1
    `,
    name,
  );

  if (existing.length) {
    const categoryId = Number(existing[0].id);

    const columns = await getColumns('IssueCategory');
    const updates = [];

    if (columns.has('description')) updates.push(`"description" = $2`);
    if (columns.has('status')) updates.push(`"status" = 'ACTIVE'`);
    if (columns.has('updatedAt')) updates.push(`"updatedAt" = NOW()`);

    if (updates.length) {
      await prisma.$executeRawUnsafe(
        `
          UPDATE "IssueCategory"
          SET ${updates.join(', ')}
          WHERE "id" = $1
        `,
        categoryId,
        description,
      );
    }

    return categoryId;
  }

  return insertReturningId('IssueCategory', {
    name,
    description,
    status: 'ACTIVE',
    createdAt: now(),
    updatedAt: now(),
  });
}

async function findDeviceTypesByKeywords(keywords) {
  const conditions = keywords
    .map((_, index) => `lower("name") LIKE $${index + 1}`)
    .join(' OR ');

  const values = keywords.map((keyword) => `%${keyword.toLowerCase()}%`);

  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT "id", "name"
      FROM "DeviceType"
      WHERE ${conditions}
      ORDER BY "id"
    `,
    ...values,
  );

  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
  }));
}

async function getOrCreateFallbackDeviceType(name) {
  const existing = await prisma.$queryRawUnsafe(
    `
      SELECT "id", "name"
      FROM "DeviceType"
      WHERE lower("name") = lower($1)
      LIMIT 1
    `,
    name,
  );

  if (existing.length) {
    return {
      id: Number(existing[0].id),
      name: existing[0].name,
    };
  }

  const id = await insertReturningId('DeviceType', {
    name,
    description: `${name} device type`,
    createdAt: now(),
    updatedAt: now(),
  });

  return { id, name };
}

async function insertIssue({ categoryId, deviceType, problem, codePrefix }) {
  const typeCode = safeCode(deviceType.name);
  const issueCode = `${codePrefix}-${typeCode}-${problem.code}`;

  return insertReturningId('Issue', {
    issueCode,
    code: issueCode,
    title: problem.description,
    description: problem.description,
    severity: 'MEDIUM',
    status: 'ACTIVE',
    categoryId,
    deviceTypeId: deviceType.id,
    createdAt: now(),
    updatedAt: now(),
  });
}

async function insertSolution({
  issueId,
  deviceType,
  solution,
  problemCode,
  codePrefix,
  stepOrder,
}) {
  const typeCode = safeCode(deviceType.name);
  const solutionCode = `${codePrefix}-${typeCode}-${problemCode}-${solution.code}`;

  await insertReturningId('IssueSolution', {
    solutionCode,
    code: solutionCode,
    issueId,
    title: solution.description,
    description: solution.description,
    stepOrder,
    isRequired: true,
    status: 'ACTIVE',
    createdAt: now(),
    updatedAt: now(),
  });
}

async function cleanOldIssuesOnly() {
  console.log('Cleaning IssueSolution and Issue only...');
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "IssueSolution", "Issue" RESTART IDENTITY;',
  );
}

async function importOneFile(config) {
  const filePath = path.join(DATA_DIR, config.fileName);

  console.log(`\nReading file: ${config.fileName}`);

  const problems = readProblemsFromFile(filePath, config.problemSheetName);
  const solutions = readSolutionsFromFile(filePath, config.solutionSheetName);

  if (!problems.length) {
    throw new Error(`No problems found in ${config.fileName}`);
  }

  if (!solutions.length) {
    throw new Error(`No solutions found in ${config.fileName}`);
  }

  console.log(`Problems found: ${problems.length}`);
  console.log(`Solutions found: ${solutions.length}`);

  const categoryId = await getOrCreateCategory(
    config.categoryName,
    config.categoryDescription,
  );

  let deviceTypes = await findDeviceTypesByKeywords(config.deviceTypeKeywords);

  if (!deviceTypes.length) {
    const fallback = await getOrCreateFallbackDeviceType(
      config.fallbackDeviceTypeName,
    );
    deviceTypes = [fallback];
  }

  console.log(
    `Linked device types: ${deviceTypes
      .map((type) => `${type.name}#${type.id}`)
      .join(', ')}`,
  );

  const allProblemCodes = problems.map((problem) => problem.code);

  for (const deviceType of deviceTypes) {
    const issueIdByProblemCode = new Map();

    for (const problem of problems) {
      const issueId = await insertIssue({
        categoryId,
        deviceType,
        problem,
        codePrefix: config.codePrefix,
      });

      issueIdByProblemCode.set(problem.code, issueId);
      console.log(`Issue added: ${problem.code} -> ${deviceType.name}`);
    }

    for (const problem of problems) {
      const relatedSolutions = solutions.filter((solution) => {
        const relatedProblemCodes = parseRelatedProblemCodes(
          solution.relatedRaw,
          allProblemCodes,
        );

        return relatedProblemCodes.includes(problem.code);
      });

      for (let index = 0; index < relatedSolutions.length; index += 1) {
        const solution = relatedSolutions[index];
        const issueId = issueIdByProblemCode.get(problem.code);

        await insertSolution({
          issueId,
          deviceType,
          solution,
          problemCode: problem.code,
          codePrefix: config.codePrefix,
          stepOrder: index + 1,
        });
      }
    }
  }
}

async function main() {
  await cleanOldIssuesOnly();

  for (const config of FILES) {
    await importOneFile(config);
  }

  const categories = await prisma.$queryRawUnsafe(
    'SELECT "id", "name" FROM "IssueCategory" ORDER BY "id"',
  );

  const issueCount = await prisma.issue.count();
  const solutionCount = await prisma.issueSolution.count();

  console.log('\nImport completed successfully.');
  console.log('Categories:');
  categories.forEach((category) => {
    console.log(`- ${category.id}: ${category.name}`);
  });
  console.log(`Issues count: ${issueCount}`);
  console.log(`Solutions count: ${solutionCount}`);
}

main()
  .catch((error) => {
    console.error('Import failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });