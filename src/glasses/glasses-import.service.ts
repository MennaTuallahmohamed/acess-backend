import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import {
  GlassAssetStatus,
  GlassCurrentStatus,
  Prisma,
} from '@prisma/client';

import { createHash } from 'crypto';
import * as XLSX from 'xlsx';

import { PrismaService } from '../prisma/prisma.service';

type ExcelCell =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined;

interface ParsedGlassRow {
  sourceRow: number;

  cluster: string;
  building: string;
  zone: string;
  direction: 'IN' | 'OUT';

  lane: string | null;
  glassType: string | null;
  thickness: string | null;

  status?: GlassAssetStatus;
  currentStatus?: GlassCurrentStatus;

  installDate?: Date | null;
  notes: string | null;
}

@Injectable()
export class GlassesImportService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async importExcel(
    file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException(
        'اختاري ملف Excel داخل الحقل file',
      );
    }

    if (!/\.(xlsx|xls)$/i.test(file.originalname)) {
      throw new BadRequestException(
        'يجب رفع ملف Excel بصيغة xlsx أو xls',
      );
    }

    let workbook: XLSX.WorkBook;

    try {
      workbook = XLSX.read(file.buffer, {
        type: 'buffer',
        raw: true,
        cellDates: false,
      });
    } catch {
      throw new BadRequestException(
        'تعذر قراءة ملف Excel',
      );
    }

    const sheetName =
      workbook.SheetNames[0];

    const worksheet =
      workbook.Sheets[sheetName];

    if (!worksheet) {
      throw new BadRequestException(
        'ملف Excel لا يحتوي على ورقة بيانات',
      );
    }

    const matrix =
      XLSX.utils.sheet_to_json<ExcelCell[]>(
        worksheet,
        {
          header: 1,
          raw: true,
          defval: null,
          blankrows: false,
        },
      ) as ExcelCell[][];

    const headerRowIndex =
      this.findHeaderRowIndex(matrix);

    if (headerRowIndex === -1) {
      throw new BadRequestException(
        'لم يتم العثور على الأعمدة المطلوبة: Cluster, Building, Zone, Direction',
      );
    }

    const headers =
      matrix[headerRowIndex].map(
        (value) =>
          this.normalizeHeader(value),
      );

    const parsedRows: ParsedGlassRow[] = [];

    const rejectedRows: Array<{
      row: number;
      reason: string;
    }> = [];

    for (
      let index = headerRowIndex + 1;
      index < matrix.length;
      index++
    ) {
      const sourceRow = index + 1;
      const row = matrix[index];

      if (this.isEmptyRow(row)) {
        continue;
      }

      try {
        parsedRows.push(
          this.parseRow(
            headers,
            row,
            sourceRow,
          ),
        );
      } catch (error) {
        rejectedRows.push({
          row: sourceRow,
          reason:
            error instanceof Error
              ? error.message
              : 'صف غير صالح',
        });
      }
    }

    if (parsedRows.length === 0) {
      throw new BadRequestException({
        message:
          'لا توجد صفوف زجاج صالحة داخل الملف',
        rejectedRows:
          rejectedRows.slice(0, 100),
      });
    }

    /*
     * لو نفس:
     * cluster + building + zone + direction
     * اتكرر داخل الملف، آخر صف هو الذي سيتم اعتماده.
     */
    const uniqueRows = new Map<
      string,
      ParsedGlassRow
    >();

    for (const row of parsedRows) {
      uniqueRows.set(
        this.buildGlassKey(row),
        row,
      );
    }

    let created = 0;
    let updated = 0;
    let locationsCreated = 0;
    let locationsUpdated = 0;

    for (
      const row
      of uniqueRows.values()
    ) {
      try {
        const result =
          await this.prisma.$transaction(
            async (transaction) => {
              const location =
                await this.upsertLocation(
                  transaction,
                  row,
                );

              const existingGlass =
                await transaction.glass.findFirst({
                  where: {
                    cluster: {
                      equals:
                        row.cluster,
                      mode:
                        'insensitive',
                    },
                    building: {
                      equals:
                        row.building,
                      mode:
                        'insensitive',
                    },
                    zone: {
                      equals:
                        row.zone,
                      mode:
                        'insensitive',
                    },
                    direction:
                      row.direction,
                  },
                  select: {
                    id: true,
                  },
                });

              const commonData = {
                cluster:
                  row.cluster,
                building:
                  row.building,
                zone:
                  row.zone,
                direction:
                  row.direction,
                lane:
                  row.lane,
                glassType:
                  row.glassType,
                thickness:
                  row.thickness,
                locationId:
                  location.id,
                notes:
                  row.notes,
                ...(row.status
                  ? {
                      status:
                        row.status,
                    }
                  : {}),
                ...(row.currentStatus
                  ? {
                      currentStatus:
                        row.currentStatus,
                    }
                  : {}),
                ...(row.installDate !== undefined
                  ? {
                      installDate:
                        row.installDate,
                    }
                  : {}),
              };

              if (existingGlass) {
                await transaction.glass.update({
                  where: {
                    id:
                      existingGlass.id,
                  },
                  data:
                    commonData,
                });

                return {
                  glassAction:
                    'updated' as const,
                  locationAction:
                    location.action,
                };
              }

              await transaction.glass.create({
                data: {
                  ...commonData,
                  status:
                    row.status ??
                    GlassAssetStatus.ACTIVE,
                  currentStatus:
                    row.currentStatus ??
                    GlassCurrentStatus.NOT_INSPECTED,
                },
              });

              return {
                glassAction:
                  'created' as const,
                locationAction:
                  location.action,
              };
            },
          );

        if (
          result.glassAction ===
          'created'
        ) {
          created++;
        } else {
          updated++;
        }

        if (
          result.locationAction ===
          'created'
        ) {
          locationsCreated++;
        } else {
          locationsUpdated++;
        }
      } catch (error) {
        rejectedRows.push({
          row:
            row.sourceRow,
          reason:
            this.getErrorMessage(error),
        });
      }
    }

    return {
      message:
        'تم استيراد ملف زجاج البوابات وحفظ البيانات في الباك إند بنجاح',
      fileName:
        file.originalname,
      sheetName,
      sourceRows:
        matrix.length -
        headerRowIndex -
        1,
      validRows:
        parsedRows.length,
      uniqueRows:
        uniqueRows.size,
      created,
      updated,
      locationsCreated,
      locationsUpdated,
      rejectedCount:
        rejectedRows.length,
      rejectedRows:
        rejectedRows.slice(0, 100),
    };
  }

  createTemplate() {
    const rows = [
      {
        Cluster: 'Cluster 1',
        Building:
          'Ministry of Transport',
        Zone: 'Zone 4',
        Direction: 'IN',
        Lane: '1',
        'Glass Type':
          'Tempered Glass',
        Thickness: '12 mm',
        Status: 'ACTIVE',
        'Current Status':
          'NOT_INSPECTED',
        'Install Date':
          '2026-07-22',
        Notes:
          'Main entrance gate glass',
      },
      {
        Cluster: 'Cluster 1',
        Building:
          'Ministry of Transport',
        Zone: 'Zone 6',
        Direction: 'OUT',
        Lane: '2',
        'Glass Type':
          'Laminated Glass',
        Thickness: '10 mm',
        Status: 'ACTIVE',
        'Current Status':
          'OK',
        'Install Date':
          '2026-07-22',
        Notes:
          'Exit gate glass',
      },
    ];

    const worksheet =
      XLSX.utils.json_to_sheet(rows);

    worksheet['!cols'] = [
      { wch: 18 },
      { wch: 30 },
      { wch: 15 },
      { wch: 12 },
      { wch: 12 },
      { wch: 22 },
      { wch: 15 },
      { wch: 18 },
      { wch: 22 },
      { wch: 16 },
      { wch: 35 },
    ];

    const workbook =
      XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      'Gate Glass',
    );

    const fileData =
      XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx',
      });

    return {
      fileName:
        'gate-glass-import-template.xlsx',
      buffer:
        Buffer.from(fileData),
    };
  }

  private async upsertLocation(
    transaction:
      Prisma.TransactionClient,
    row: ParsedGlassRow,
  ) {
    const existingLocation =
      await transaction.location.findFirst({
        where: {
          cluster: {
            equals:
              row.cluster,
            mode:
              'insensitive',
          },
          building: {
            equals:
              row.building,
            mode:
              'insensitive',
          },
          zone: {
            equals:
              row.zone,
            mode:
              'insensitive',
          },
          direction:
            row.direction,
        },
        select: {
          id: true,
        },
      });

    if (existingLocation) {
      const updatedLocation =
        await transaction.location.update({
          where: {
            id:
              existingLocation.id,
          },
          data: {
            cluster:
              row.cluster,
            building:
              row.building,
            zone:
              row.zone,
            direction:
              row.direction,
            lane:
              row.lane,
            type:
              'GATE_GLASS',
          },
          select: {
            id: true,
          },
        });

      return {
        id:
          updatedLocation.id,
        action:
          'updated' as const,
      };
    }

    const excelId =
      this.buildLocationExcelId(row);

    const location =
      await transaction.location.upsert({
        where: {
          excelId,
        },
        update: {
          cluster:
            row.cluster,
          building:
            row.building,
          zone:
            row.zone,
          direction:
            row.direction,
          lane:
            row.lane,
          type:
            'GATE_GLASS',
        },
        create: {
          excelId,
          cluster:
            row.cluster,
          building:
            row.building,
          zone:
            row.zone,
          direction:
            row.direction,
          lane:
            row.lane,
          type:
            'GATE_GLASS',
        },
        select: {
          id: true,
        },
      });

    return {
      id:
        location.id,
      action:
        'created' as const,
    };
  }

  private parseRow(
    headers: string[],
    row: ExcelCell[],
    sourceRow: number,
  ): ParsedGlassRow {
    const cluster =
      this.readText(
        headers,
        row,
        [
          'cluster',
          'الكلاستر',
          'المجموعة',
        ],
      );

    const building =
      this.readText(
        headers,
        row,
        [
          'building',
          'ministry',
          'المبنى',
          'الوزارة',
          'الجهة',
        ],
      );

    const zone =
      this.readText(
        headers,
        row,
        [
          'zone',
          'الزون',
          'المنطقة',
        ],
      );

    const direction =
      this.normalizeDirection(
        this.readText(
          headers,
          row,
          [
            'direction',
            'الاتجاه',
          ],
        ),
      );

    if (!cluster) {
      throw new Error(
        'Cluster غير موجود',
      );
    }

    if (!building) {
      throw new Error(
        'Building/Ministry غير موجود',
      );
    }

    if (!zone) {
      throw new Error(
        'Zone غير موجود',
      );
    }

    if (!direction) {
      throw new Error(
        'Direction يجب أن يكون IN أو OUT',
      );
    }

    const statusText =
      this.readText(
        headers,
        row,
        [
          'status',
          'asset status',
          'حالة الاصل',
          'الحالة',
        ],
      );

    const currentStatusText =
      this.readText(
        headers,
        row,
        [
          'current status',
          'currentstatus',
          'inspection status',
          'الحالة الحالية',
          'حالة الفحص',
        ],
      );

    const installDateCell =
      this.readCell(
        headers,
        row,
        [
          'install date',
          'installdate',
          'تاريخ التركيب',
        ],
      );

    return {
      sourceRow,
      cluster:
        cluster.trim(),
      building:
        building.trim(),
      zone:
        zone.trim(),
      direction,

      lane:
        this.readText(
          headers,
          row,
          [
            'lane',
            'المسار',
            'الحارة',
          ],
        ),

      glassType:
        this.readText(
          headers,
          row,
          [
            'glass type',
            'glasstype',
            'نوع الزجاج',
          ],
        ),

      thickness:
        this.readText(
          headers,
          row,
          [
            'thickness',
            'السمك',
            'السُمك',
          ],
        ),

      status:
        this.parseAssetStatus(
          statusText,
        ),

      currentStatus:
        this.parseCurrentStatus(
          currentStatusText,
        ),

      installDate:
        installDateCell.found
          ? this.parseDate(
              installDateCell.value,
            )
          : undefined,

      notes:
        this.readText(
          headers,
          row,
          [
            'notes',
            'note',
            'comment',
            'comments',
            'ملاحظات',
            'التعليق',
          ],
        ),
    };
  }

  private findHeaderRowIndex(
    matrix: ExcelCell[][],
  ) {
    const maximumRows =
      Math.min(
        matrix.length,
        20,
      );

    for (
      let index = 0;
      index < maximumRows;
      index++
    ) {
      const headers =
        matrix[index].map(
          (value) =>
            this.normalizeHeader(
              value,
            ),
        );

      const hasCluster =
        this.hasAnyHeader(
          headers,
          [
            'cluster',
            'الكلاستر',
            'المجموعة',
          ],
        );

      const hasBuilding =
        this.hasAnyHeader(
          headers,
          [
            'building',
            'ministry',
            'المبنى',
            'الوزارة',
            'الجهة',
          ],
        );

      const hasZone =
        this.hasAnyHeader(
          headers,
          [
            'zone',
            'الزون',
            'المنطقة',
          ],
        );

      const hasDirection =
        this.hasAnyHeader(
          headers,
          [
            'direction',
            'الاتجاه',
          ],
        );

      if (
        hasCluster &&
        hasBuilding &&
        hasZone &&
        hasDirection
      ) {
        return index;
      }
    }

    return -1;
  }

  private hasAnyHeader(
    headers: string[],
    aliases: string[],
  ) {
    const normalizedAliases =
      aliases.map(
        (alias) =>
          this.normalizeHeader(
            alias,
          ),
      );

    return headers.some(
      (header) =>
        normalizedAliases.includes(
          header,
        ),
    );
  }

  private readCell(
    headers: string[],
    row: ExcelCell[],
    aliases: string[],
  ) {
    const normalizedAliases =
      aliases.map(
        (alias) =>
          this.normalizeHeader(
            alias,
          ),
      );

    const index =
      headers.findIndex(
        (header) =>
          normalizedAliases.includes(
            header,
          ),
      );

    if (index === -1) {
      return {
        found: false,
        value: null as ExcelCell,
      };
    }

    return {
      found: true,
      value:
        row[index],
    };
  }

  private readText(
    headers: string[],
    row: ExcelCell[],
    aliases: string[],
  ) {
    const result =
      this.readCell(
        headers,
        row,
        aliases,
      );

    if (!result.found) {
      return null;
    }

    return this.cellToText(
      result.value,
    );
  }

  private cellToText(
    value: ExcelCell,
  ): string | null {
    if (
      value === null ||
      value === undefined
    ) {
      return null;
    }

    if (value instanceof Date) {
      return value
        .toISOString()
        .slice(0, 10);
    }

    const text =
      String(value).trim();

    return text || null;
  }

  private normalizeHeader(
    value: ExcelCell,
  ) {
    return (
      this.cellToText(value) ?? ''
    )
      .toLowerCase()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/[_\-./\\]+/g, ' ')
      .replace(/\s+/g, '');
  }

  private normalizeDirection(
    value: string | null,
  ): 'IN' | 'OUT' | null {
    if (!value) {
      return null;
    }

    const normalized =
      value
        .trim()
        .toUpperCase();

    if (
      [
        'IN',
        'ENTRY',
        'ENTRANCE',
        'دخول',
        'داخل',
      ].includes(normalized)
    ) {
      return 'IN';
    }

    if (
      [
        'OUT',
        'EXIT',
        'خروج',
        'خارج',
      ].includes(normalized)
    ) {
      return 'OUT';
    }

    return null;
  }

  private parseAssetStatus(
    value: string | null,
  ): GlassAssetStatus | undefined {
    if (!value) {
      return undefined;
    }

    const normalized =
      this.normalizeEnumValue(
        value,
      );

    if (
      [
        'ACTIVE',
        'نشط',
      ].includes(normalized)
    ) {
      return GlassAssetStatus.ACTIVE;
    }

    if (
      [
        'INACTIVE',
        'غيرنشط',
      ].includes(normalized)
    ) {
      return GlassAssetStatus.INACTIVE;
    }

    if (
      [
        'MAINTENANCE',
        'صيانه',
        'صيانة',
      ].includes(normalized)
    ) {
      return GlassAssetStatus.MAINTENANCE;
    }

    throw new Error(
      `Status غير صحيح: ${value}`,
    );
  }

  private parseCurrentStatus(
    value: string | null,
  ): GlassCurrentStatus | undefined {
    if (!value) {
      return undefined;
    }

    const normalized =
      this.normalizeEnumValue(
        value,
      );

    if (
      [
        'NOTINSPECTED',
        'NOT_INSPECTED',
        'لميتمالفحص',
        'لميفحص',
      ].includes(normalized)
    ) {
      return GlassCurrentStatus.NOT_INSPECTED;
    }

    if (
      [
        'OK',
        'سليم',
      ].includes(normalized)
    ) {
      return GlassCurrentStatus.OK;
    }

    if (
      [
        'NOTOK',
        'NOT_OK',
        'غيرسليم',
      ].includes(normalized)
    ) {
      return GlassCurrentStatus.NOT_OK;
    }

    if (
      [
        'NEEDSFOLLOWUP',
        'NEEDS_FOLLOW_UP',
        'يحتاجمتابعه',
        'يحتاجمتابعة',
      ].includes(normalized)
    ) {
      return GlassCurrentStatus.NEEDS_FOLLOW_UP;
    }

    throw new Error(
      `Current Status غير صحيح: ${value}`,
    );
  }

  private normalizeEnumValue(
    value: string,
  ) {
    return value
      .trim()
      .toUpperCase()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/[\s\-]+/g, '');
  }

  private parseDate(
    value: ExcelCell,
  ): Date | null {
    if (
      value === null ||
      value === undefined ||
      value === ''
    ) {
      return null;
    }

    if (value instanceof Date) {
      return value;
    }

    if (
      typeof value === 'number' &&
      Number.isFinite(value)
    ) {
      const parsed =
        XLSX.SSF.parse_date_code(
          value,
        );

      if (parsed) {
        return new Date(
          Date.UTC(
            parsed.y,
            parsed.m - 1,
            parsed.d,
          ),
        );
      }
    }

    const date =
      new Date(String(value));

    if (
      Number.isNaN(
        date.getTime(),
      )
    ) {
      throw new Error(
        `Install Date غير صحيح: ${String(value)}`,
      );
    }

    return date;
  }

  private buildGlassKey(
    row: ParsedGlassRow,
  ) {
    return [
      row.cluster,
      row.building,
      row.zone,
      row.direction,
    ]
      .map(
        (value) =>
          value
            .trim()
            .toLowerCase(),
      )
      .join('|');
  }

  private buildLocationExcelId(
    row: ParsedGlassRow,
  ) {
    const key = [
      row.cluster,
      row.building,
      row.zone,
      row.direction,
    ].join('|');

    const hash =
      createHash('sha1')
        .update(key)
        .digest('hex')
        .toUpperCase();

    return `GLASS-LOC-${hash.slice(0, 24)}`;
  }

  private isEmptyRow(
    row: ExcelCell[],
  ) {
    return row.every(
      (value) =>
        value === null ||
        value === undefined ||
        String(value).trim() === '',
    );
  }

  private getErrorMessage(
    error: unknown,
  ) {
    if (
      error instanceof
      Prisma.PrismaClientKnownRequestError
    ) {
      if (
        error.code === 'P2002'
      ) {
        return 'يوجد سجل مكرر لنفس الكلاستر والمبنى والزون والاتجاه';
      }

      if (
        error.code === 'P2003'
      ) {
        return 'ارتباط الموقع غير صحيح';
      }

      return `${error.code}: ${error.message}`;
    }

    return error instanceof Error
      ? error.message
      : 'حدث خطأ غير معروف';
  }
}