import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { join } from 'path';
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
  app.setViewEngine('hbs');

  // Enable CORS
  app.enableCors();

  await app.listen(3000);
}
bootstrap();
