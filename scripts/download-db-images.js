const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const https = require('https');

const prisma = new PrismaClient();

const BASE_URL = 'https://acess-backend-production.up.railway.app';
const uploadsDir = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

function filenameFromUrl(imageUrl) {
  return String(imageUrl || '').replace(/\\/g, '/').split('/').pop();
}

function normalizeUrl(imageUrl) {
  const clean = String(imageUrl || '').replace(/\\/g, '/');
  if (clean.startsWith('http://') || clean.startsWith('https://')) return clean;
  if (clean.startsWith('/')) return `${BASE_URL}${clean}`;
  return `${BASE_URL}/${clean}`;
}

function download(url, dest) {
  return new Promise((resolve) => {
    const file = fs.createWriteStream(dest);

    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          return resolve(false);
        }

        res.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve(true);
        });
      })
      .on('error', () => {
        file.close();
        fs.unlink(dest, () => {});
        resolve(false);
      });
  });
}

async function main() {
  const images = await prisma.inspectionImage.findMany({
    select: {
      id: true,
      inspectionId: true,
      imageUrl: true,
    },
    orderBy: { id: 'asc' },
  });

  let ok = 0;
  let fail = 0;

  for (const img of images) {
    const filename = filenameFromUrl(img.imageUrl);
    if (!filename) {
      fail++;
      continue;
    }

    const target = path.join(uploadsDir, filename);

    if (fs.existsSync(target)) {
      ok++;
      continue;
    }

    const url = normalizeUrl(img.imageUrl);
    const downloaded = await download(url, target);

    if (downloaded) {
      ok++;
      console.log(`DOWNLOADED ${ok}: ${filename}`);
    } else {
      fail++;
      console.log(`FAILED: ${filename}`);
    }
  }

  console.log('==============================');
  console.log('Downloaded / Existing:', ok);
  console.log('Failed:', fail);
  console.log('Saved to:', uploadsDir);
  console.log('==============================');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
});