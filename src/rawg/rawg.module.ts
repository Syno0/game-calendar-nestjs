import { Global, Module } from "@nestjs/common";
import { RawgClient } from "./rawg.client";
import { RawgService } from "./rawg.service";
import { RawgSyncService } from "./rawg-sync.service";

// Global : `AppService` est instancié deux fois (ici et dans FavoritesModule),
// mais la file de synchro et le compteur de quota doivent rester uniques.
@Global()
@Module({
	providers: [RawgClient, RawgSyncService, RawgService],
	exports: [RawgClient, RawgSyncService, RawgService],
})
export class RawgModule {}
