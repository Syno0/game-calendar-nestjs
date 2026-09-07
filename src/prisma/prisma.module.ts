import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

// Global so feature modules don't each have to import it — ConfigModule is not
// registered globally in this app, so we keep infrastructure wiring explicit here.
@Global()
@Module({
	providers: [PrismaService],
	exports: [PrismaService],
})
export class PrismaModule {}
