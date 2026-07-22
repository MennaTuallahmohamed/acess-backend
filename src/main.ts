import {
  Logger,
  ValidationPipe,
} from '@nestjs/common';

import {
  NestFactory,
} from '@nestjs/core';

import {
  NestExpressApplication,
} from '@nestjs/platform-express';

import {
  existsSync,
  mkdirSync,
} from 'fs';

import {
  join,
  resolve,
} from 'path';

import {
  AppModule,
} from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app =
    await NestFactory.create<NestExpressApplication>(
      AppModule,
      {
        cors: false,
      },
    );

  /*
  =========================================================
  Railway / Proxy
  =========================================================
  */

  app.set(
    'trust proxy',
    1,
  );

  /*
  =========================================================
  CORS
  =========================================================
  */

  const defaultOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://smart-it-15.vercel.app',
  ];

  /*
   * يمكن إضافة أكثر من رابط داخل Railway Variables:
   *
   * FRONTEND_URLS=https://site1.vercel.app,https://site2.vercel.app
   */
  const environmentOrigins =
    process.env.FRONTEND_URLS
      ?.split(',')
      .map(
        (origin) =>
          origin.trim(),
      )
      .filter(Boolean) ?? [];

  /*
   * دعم متغير واحد أيضًا:
   *
   * FRONTEND_URL=https://smart-it-15.vercel.app
   */
  const singleFrontendOrigin =
    process.env.FRONTEND_URL
      ?.trim();

  const allowedOrigins = [
    ...defaultOrigins,
    ...environmentOrigins,
    ...(singleFrontendOrigin
      ? [singleFrontendOrigin]
      : []),
  ];

  const uniqueAllowedOrigins = [
    ...new Set(
      allowedOrigins,
    ),
  ];

  app.enableCors({
    origin: (
      origin,
      callback,
    ) => {
      /*
       * الطلبات بدون Origin تشمل:
       * Postman
       * Server-to-server
       * بعض طلبات Railway الداخلية
       */
      if (!origin) {
        callback(
          null,
          true,
        );

        return;
      }

      if (
        uniqueAllowedOrigins.includes(
          origin,
        )
      ) {
        callback(
          null,
          true,
        );

        return;
      }

      logger.warn(
        `Blocked CORS origin: ${origin}`,
      );

      callback(
        new Error(
          `CORS origin is not allowed: ${origin}`,
        ),
        false,
      );
    },

    credentials: true,

    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ],

    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
    ],

    exposedHeaders: [
      'Content-Disposition',
    ],

    optionsSuccessStatus: 204,
  });

  /*
  =========================================================
  Uploads directory
  =========================================================
  */

  const uploadsPath =
    process.env.UPLOAD_DIR
      ? resolve(
          process.env.UPLOAD_DIR,
        )
      : join(
          process.cwd(),
          'uploads',
        );

  if (
    !existsSync(
      uploadsPath,
    )
  ) {
    mkdirSync(
      uploadsPath,
      {
        recursive: true,
      },
    );
  }

  /*
   * مثال رابط الصورة:
   *
   * https://backend.up.railway.app/uploads/glass-inspections/image.jpg
   */
  app.useStaticAssets(
    uploadsPath,
    {
      prefix:
        '/uploads/',

      maxAge:
        '30d',

      setHeaders: (
        response,
      ) => {
        response.setHeader(
          'Access-Control-Allow-Origin',
          '*',
        );

        response.setHeader(
          'Cross-Origin-Resource-Policy',
          'cross-origin',
        );

        response.setHeader(
          'Cross-Origin-Embedder-Policy',
          'unsafe-none',
        );

        response.setHeader(
          'Cache-Control',
          'public, max-age=2592000',
        );
      },
    },
  );

  /*
  =========================================================
  Global validation
  =========================================================
  */

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,

      transform: true,

      forbidNonWhitelisted:
        false,

      forbidUnknownValues:
        false,

      transformOptions: {
        enableImplicitConversion:
          true,
      },

      validationError: {
        target: false,
        value: false,
      },
    }),
  );

  /*
  =========================================================
  Graceful shutdown
  =========================================================
  */

  app.enableShutdownHooks();

  /*
  =========================================================
  Start server
  =========================================================
  */

  const port =
    Number(
      process.env.PORT,
    ) || 3000;

  await app.listen(
    port,
    '0.0.0.0',
  );

  logger.log(
    '====================================',
  );

  logger.log(
    `Server running on http://0.0.0.0:${port}`,
  );

  logger.log(
    `Uploads folder: ${uploadsPath}`,
  );

  logger.log(
    'Uploads URL prefix: /uploads/',
  );

  logger.log(
    `Allowed CORS origins: ${uniqueAllowedOrigins.join(', ')}`,
  );

  logger.log(
    '====================================',
  );
}

bootstrap().catch(
  (error: unknown) => {
    const logger =
      new Logger(
        'Bootstrap',
      );

    logger.error(
      'Application failed to start',
      error instanceof Error
        ? error.stack
        : String(error),
    );

    process.exit(1);
  },
);