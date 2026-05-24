import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  /*
    مهم لو شغالين على Railway / Render / Proxy
  */
  app.set('trust proxy', 1);

  /*
    CORS عشان الويب يقدر يقرأ الصور والـ API
  */
  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
    ],
  });

  /*
    Uploads folder
    لو عندك Railway Volume خلي UPLOAD_DIR = /data/uploads
    لو مفيش Volume هيستخدم فولدر uploads العادي
  */
  const uploadsPath = process.env.UPLOAD_DIR
    ? resolve(process.env.UPLOAD_DIR)
    : join(process.cwd(), 'uploads');

  if (!existsSync(uploadsPath)) {
    mkdirSync(uploadsPath, { recursive: true });
  }

  /*
    Serve uploaded images
    أي صورة محفوظة مثل:
    /uploads/1779357689448-680806114.jpg

    هتفتح من:
    https://your-backend.up.railway.app/uploads/1779357689448-680806114.jpg
  */
  app.useStaticAssets(uploadsPath, {
    prefix: '/uploads/',
    maxAge: '30d',
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
      res.setHeader('Cache-Control', 'public, max-age=2592000');
    },
  });

  /*
    Validation
  */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const port = Number(process.env.PORT) || 3000;

  await app.listen(port, '0.0.0.0');

  console.log('====================================');
  console.log(`Server running on http://0.0.0.0:${port}`);
  console.log(`Uploads folder: ${uploadsPath}`);
  console.log(`Uploads URL prefix: /uploads/`);
  console.log('====================================');
}

bootstrap();