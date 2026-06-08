import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
	public readonly client: PrismaClient;
	private pool: Pool;

	constructor() {
		this.pool = new Pool({
			connectionString: process.env.DATABASE_URL,
		});
		const adapter = new PrismaPg(this.pool);
		this.client = new PrismaClient({ adapter });
	}

	async onModuleInit() {
		await this.client.$connect();
	}

	async onModuleDestroy() {
		await this.client.$disconnect();
		await this.pool.end();
	}
}
