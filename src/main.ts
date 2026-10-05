import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { WinstonModule } from "nest-winston";
import { AppModule } from "./app.module";
import { join } from "path";
import * as net from "net";
import * as cookieParser from "cookie-parser";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { winstonConfig } from "./common/logger/winston.config";
// import { AllExceptionsFilter } from './exceptions/all-exception.filter';
// import { UnhandledInterceptor } from './interceptors/unhandled.interceptor';

async function bootstrap() {
	const app = await NestFactory.create<NestExpressApplication>(AppModule, {
		logger: WinstonModule.createLogger(winstonConfig),
	});

	// Add AllException Filter to all app
	// const httpAdapter = app.get(HttpAdapterHost);
	// app.useGlobalFilters(new AllExceptionsFilter(httpAdapter));

	// Global interceptor
	// app.useGlobalInterceptors(new UnhandledInterceptor());

	// Swagger configuration
	const config = new DocumentBuilder()
		.setTitle("Game Calendar API")
		.setDescription(
			"API for managing game calendar and retrieving game information from IGDB"
		)
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
			"http://127.0.0.1:3002",
			"http://localhost:3002",
			"https://gamecalbff.sb-pro.fr",
			"https://gamecalendar.preview.emergentagent.com",
			"https://gamecalendar.app",
		],
		credentials: true,
	});

	// Unlock the request.cookies power
	app.use(cookieParser());

	await app.listen(3000);

	// Arrêt propre sur SIGTERM (docker stop, et donc chaque déploiement) :
	// d'abord cesser d'accepter des connexions et laisser finir les requêtes
	// en cours — le BFF, refoulé, se rabat alors sur l'autre conteneur que
	// lui donne le DNS — PUIS fermer Nest. `enableShutdownHooks()` ferait
	// l'inverse en Nest 10 : `onModuleDestroy` (la déconnexion Prisma) passe
	// avant la fermeture du serveur HTTP, et les requêtes en vol perdraient
	// leur base. Sans aucun gestionnaire, Node ignore SIGTERM en PID 1 et
	// docker finit par le tuer au bout du délai de grâce, en plein travail.
	//
	// `net.Server.prototype.close` et surtout pas `server.close()` : depuis
	// Node 19, ce dernier appelle `closeIdleConnections()`, qui tient pour
	// inactive une connexion dont la réponse est écrite… mais encore dans le
	// tampon de Node, et la détruit avec. Une réponse /games pèse 1,4 Mo :
	// sur un conteneur jetable, les 8 requêtes en vol arrivaient tronquées.
	// La fermeture bas niveau cesse d'écouter sans toucher aux connexions, et
	// son rappel ne vient qu'une fois la dernière fermée — les connexions
	// keep-alive inactives tombent d'elles-mêmes au bout de `keepAliveTimeout`.
	process.once("SIGTERM", () => {
		net.Server.prototype.close.call(app.getHttpServer(), () => {
			app.close().finally(() => process.exit(0));
		});
	});
}
bootstrap();
