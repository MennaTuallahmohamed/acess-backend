import { existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

export function getUploadsPath() {
  const uploadsPath = process.env.UPLOAD_DIR
    ? resolve(process.env.UPLOAD_DIR)
    : join(process.cwd(), 'uploads');

  if (!existsSync(uploadsPath)) {
    mkdirSync(uploadsPath, { recursive: true });
  }

  return uploadsPath;
}

export function getUploadPublicUrl(filename: string) {
  return `/uploads/${filename}`;
}