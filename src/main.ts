import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { join } from "path";
import * as cookieParser from "cookie-parser";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
// import { AllExceptionsFilter } from './exceptions/all-exception.filter';
// import { UnhandledInterceptor } from './interceptors/unhandled.interceptor';

async function bootstrap() {
	const app = await NestFactory.create<NestExpressApplication>(AppModule);

	// Add AllException Filter to all app
	// const httpAdapter = app.get(HttpAdapterHost);
	// app.useGlobalFilters(new AllExceptionsFilter(httpAdapter));

	// Global interceptor
	// app.useGlobalInterceptors(new UnhandledInterceptor());

	// Swagger configuration
	const config = new DocumentBuilder()
		.setTitle("Game Calendar API")
		.setDescription("API for managing game calendar and retrieving game information from IGDB")
		.setVersion("1.0")
		.addBearerAuth(
			{
				type: "http",
				scheme: "bearer",
				bearerFormat: "JWT",
				name: "JWT",
				description: "Enter JWT token",
				in: "header",
			},
			"JWT-auth"
		)
		.addTag("Authentication", "Authentication endpoints")
		.addTag("Games", "Game-related endpoints")
		.build();

	const document = SwaggerModule.createDocument(app, config);
	SwaggerModule.setup("api", app, document, {
		swaggerOptions: {
			persistAuthorization: true,
		},
	});

	// Add views and public directory
	app.useStaticAssets(join(__dirname, "..", "public"));
	app.setBaseViewsDir(join(__dirname, "..", "views"));

	// Template engine is handlebars
	// app.setViewEngine('hbs');

	// Enable CORS https://github.com/expressjs/cors#configuration-options
	app.enableCors({
		origin: [
			"http://127.0.0.1:4200/",
			"http://localhost:4200/",
			"http://127.0.0.1:3001",
			"http://localhost:3001",
			"https://gamecal.sb-pro.fr",
			"https://gamecalendar.preview.emergentagent.com",
		],
		credentials: true,
	});

	// Unlock the request.cookies power
	app.use(cookieParser());

	await app.listen(3000);
}
bootstrap();
