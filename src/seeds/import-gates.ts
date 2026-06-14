import * as XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const EXCEL_PATH = 'C:/backend/gate_secret_codes_unique_modified.xlsx';

function clean(value: any): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

async function main() {
  const workbook = XLSX.readFile(EXCEL_PATH);
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error('Excel file has no sheets');
  }

  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    defval: '',
  });

  console.log('EXCEL FILE =', EXCEL_PATH);
  console.log('SHEET NAME =', sheetName);
  console.log('ROWS IN EXCEL =', rows.length);
  console.log('FIRST ROW =', rows[0]);

  const data = rows
    .map((row) => {
      const gateNo = clean(row.Gate_No ?? row.gateNo ?? row.gate_no);
      const secretCode = clean(
        row.Gate_Secret_Code ?? row.secretCode ?? row.secret_code,
      );
      const cluster = clean(row.Cluster ?? row.cluster);
      const building = clean(row.Building ?? row.building);
      const zone = clean(row.Zone ?? row.zone);
      const direction = clean(row.Direction ?? row.direction);
      const lane = clean(row.Lane ?? row.lane);
      const type = clean(row.Type ?? row.type);
      const excelId = clean(row.ExcelId ?? row.excelId ?? row.excel_id);

      if (!gateNo || !secretCode || !cluster || !building) {
        return null;
      }

      return {
        gateNo,
        secretCode,
        cluster,
        building,
        zone: zone || null,
        direction: direction || null,
        lane: lane || null,
        type: type || null,
        excelId: excelId || null,
      };
    })
    .filter(Boolean) as {
    gateNo: string;
    secretCode: string;
    cluster: string;
    building: string;
    zone: string | null;
    direction: string | null;
    lane: string | null;
    type: string | null;
    excelId: string | null;
  }[];

  console.log('VALID ROWS =', data.length);

  if (data.length === 0) {
    console.log('NO VALID DATA FOUND');
    return;
  }

  const beforeCount = await prisma.gate.count();

  const result = await prisma.gate.createMany({
    data,
    skipDuplicates: true,
  });

  const afterCount = await prisma.gate.count();

  console.log('==============================');
  console.log('BEFORE GATES COUNT =', beforeCount);
  console.log('IMPORTED NOW =', result.count);
  console.log('AFTER GATES COUNT =', afterCount);
  console.log('SKIPPED DUPLICATES =', data.length - result.count);
  console.log('==============================');
}

main()
  .catch((error) => {
    console.error('IMPORT ERROR:', error);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });