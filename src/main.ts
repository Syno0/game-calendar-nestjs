import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { join } from 'path';
import * as cookieParser from 'cookie-parser';
// import { AllExceptionsFilter } from './exceptions/all-exception.filter';
// import { UnhandledInterceptor } from './interceptors/unhandled.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Add AllException Filter to all app
  // const httpAdapter = app.get(HttpAdapterHost);
  // app.useGlobalFilters(new AllExceptionsFilter(httpAdapter));

  // Global interceptor
  // app.useGlobalInterceptors(new UnhandledInterceptor());

  // Add views and public directory
  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.setBaseViewsDir(join(__dirname, '..', 'views'));

  // Template engine is handlebars
  // app.setViewEngine('hbs');

  // Enable CORS https://github.com/expressjs/cors#configuration-options
  app.enableCors({
		origin: [
			"http://127.0.0.1:3001",
			"http://localhost:3001"
		],
		credentials: true,
  });

  // Unlock the request.cookies power
  app.use(cookieParser());

  await app.listen(3000);
}
bootstrap();
