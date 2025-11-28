import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "../src/app.module";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as path from "path";

async function generateOpenApi() {
	const app = await NestFactory.create<NestExpressApplication>(AppModule, {
		logger: false,
	});

	// Swagger configuration (same as in main.ts)
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

	// Convert to YAML
	const yamlString = yaml.dump(document, {
		indent: 2,
		lineWidth: -1,
		noRefs: false,
	});

	// Write to file
	const outputPath = path.join(process.cwd(), "openapi.yml");
	fs.writeFileSync(outputPath, yamlString, "utf8");

	console.log(`✅ OpenAPI specification generated successfully at: ${outputPath}`);

	await app.close();
}

generateOpenApi().catch((error) => {
	console.error("❌ Error generating OpenAPI specification:", error);
	process.exit(1);
});

