// scan-barcode.dto.ts

import { IsString } from 'class-validator';

export class ScanBarcodeDto {
  @IsString()
  barcode: string;
}