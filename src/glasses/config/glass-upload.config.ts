import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';

const uploadDirectory = join(
  process.cwd(),
  'uploads',
  'glass-inspections',
);

mkdirSync(uploadDirectory, {
  recursive: true,
});

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

export const glassInspectionUploadOptions = {
  storage: diskStorage({
    destination: uploadDirectory,

    filename: (
      _request: Express.Request,
      file: Express.Multer.File,
      callback: (
        error: Error | null,
        filename: string,
      ) => void,
    ) => {
      const extension = extname(
        file.originalname,
      ).toLowerCase();

      const filename = `${Date.now()}-${randomUUID()}${extension}`;

      callback(null, filename);
    },
  }),

  limits: {
    files: 5,
    fileSize: 5 * 1024 * 1024,
  },

  fileFilter: (
    _request: Express.Request,
    file: Express.Multer.File,
    callback: (
      error: Error | null,
      acceptFile: boolean,
    ) => void,
  ) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(
        new BadRequestException(
          'مسموح فقط بصور JPG أو PNG أو WEBP',
        ),
        false,
      );

      return;
    }

    callback(null, true);
  },
};