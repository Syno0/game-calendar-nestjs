import { Module } from "@nestjs/common";
import { IgdbApi } from "./igdb";

@Module({
	providers: [IgdbApi],
	exports: [IgdbApi],
})
export class IgdbModule {}
