import { Module, NestModule, MiddlewareConsumer } from "@nestjs/common";
import { CacheModule } from "@nestjs/cache-manager";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { IgdbModule } from "./clients/igdb.module";
import { LoggerMiddleware } from "./common/middlewares/logger.middleware";

@Module({
	imports: [
		ConfigModule.forRoot(),
		CacheModule.register({
			isGlobal: true,
			ttl: process.env.CACHE_TTL
				? parseInt(process.env.CACHE_TTL)
				: 3600000,
			max: 100,
		}),
		AuthModule,
		IgdbModule,
	],
	controllers: [AppController],
	providers: [AppService],
})
export class AppModule implements NestModule {
	configure(consumer: MiddlewareConsumer) {
		consumer.apply(LoggerMiddleware).forRoutes("*");
	}
}
