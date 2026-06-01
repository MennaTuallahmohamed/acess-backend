const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

function getFilename(imageUrl) {
  if (!imageUrl) return '';
  return String(imageUrl).replace(/\\/g, '/').split('/').pop();
}

async function main() {
  const uploadsPath = path.join(process.cwd(), 'uploads');

  const images = await prisma.inspectionImage.findMany({
    select: {
      id: true,
      inspectionId: true,
      imageUrl: true,
      createdAt: true,
    },
    orderBy: {
      id: 'asc',
    },
  });

  const result = images.map((img) => {
    const filename = getFilename(img.imageUrl);
    const filePath = path.join(uploadsPath, filename);
    const exists = filename ? fs.existsSync(filePath) : false;

    return {
      id: img.id,
      inspectionId: img.inspectionId,
      imageUrl: img.imageUrl,
      filename,
      exists,
      filePath,
      createdAt: img.createdAt,
    };
  });

  const existing = result.filter((x) => x.exists);
  const missing = result.filter((x) => !x.exists);

  console.log('======================================');
  console.log('Total DB records:', images.length);
  console.log('Existing files:', existing.length);
  console.log('Missing files:', missing.length);
  console.log('Uploads folder:', uploadsPath);
  console.log('======================================');

  fs.writeFileSync(
    path.join(process.cwd(), 'missing-images.json'),
    JSON.stringify(missing, null, 2),
    'utf8',
  );

  fs.writeFileSync(
    path.join(process.cwd(), 'existing-images.json'),
    JSON.stringify(existing, null, 2),
    'utf8',
  );

  console.log('Created: missing-images.json');
  console.log('Created: existing-images.json');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });