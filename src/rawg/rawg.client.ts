import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** Une fiche telle que la renvoient `/games` et `/games/{id}`. */
export interface RawgApiGame {
	id: number;
	slug: string;
	name: string;
	released: string | null;
	tba: boolean;
	updated?: string | null;
	metacritic?: number | null;
	rating?: number | null;
	ratings_count?: number | null;
	added?: number | null;
	added_by_status?: Record<string, number> | null;
	esrb_rating?: { id: number; name: string; slug: string } | null;
	playtime?: number | null;
	platforms?: { platform: { id: number; name: string; slug: string } }[] | null;
}

export interface RawgPage {
	count: number;
	next: string | null;
	results: RawgApiGame[];
}

const RAWG_URL = "https://api.rawg.io/api";

/** Un appel bloqué plus longtemps que ça ne bloque pas la file avec lui. */
const TIMEOUT_MS = 10_000;

/** Entre deux appels : RAWG ne publie pas de limite de débit, on reste sage. */
const SPACING_MS = 250;

/** Après une erreur serveur, on laisse RAWG respirer avant de réessayer. */
const SERVER_ERROR_PAUSE_MS = 15 * 60_000;

const capOf = (name: string, fallback: number): number => {
	const value = parseInt(process.env[name] ?? "", 10);
	return Number.isFinite(value) && value >= 0 ? value : fallback;
};

/** Minuit UTC du jour : la clé de `RawgApiUsage`. */
export const utcDay = (date = new Date()): Date =>
	new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const nextUtcMidnight = (): number => utcDay().getTime() + 86_400_000;

export interface RawgUsage {
	enabled: boolean;
	today: number;
	month: number;
	dailyCap: number;
	monthlyCap: number;
	haltedUntil: string | null;
}

/**
 * Les appels à RAWG, et rien d'autre.
 *
 * Le quota gratuit est de 20 000 requêtes par mois : chaque appel est compté
 * en base *avant* de partir, et refusé au-delà des plafonds. Compter avant
 * plutôt qu'après, c'est accepter de compter un appel qui échoue — RAWG le
 * décompte probablement aussi — plutôt que de risquer d'en oublier un.
 *
 * Toute erreur rend `null` : RAWG n'est qu'un complément, son absence doit
 * laisser l'application exactement comme sans lui.
 */
@Injectable()
export class RawgClient {
	private readonly logger = new Logger(RawgClient.name);
	private haltedUntil = 0;
	private lastCallAt = 0;

	constructor(private readonly prisma: PrismaService) {}

	get dailyCap(): number {
		return capOf("RAWG_DAILY_CAP", 600);
	}

	/** 18 000 et non 20 000 : une marge pour les essais faits à la main. */
	get monthlyCap(): number {
		return capOf("RAWG_MONTHLY_CAP", 18_000);
	}

	get configured(): boolean {
		return !!process.env.RAWG_API_KEY;
	}

	get available(): boolean {
		return this.configured && Date.now() >= this.haltedUntil;
	}

	async get<T>(
		path: string,
		params: Record<string, string | number | boolean> = {}
	): Promise<T | null> {
		if (!this.available) return null;
		if (!(await this.reserve())) return null;

		const wait = this.lastCallAt + SPACING_MS - Date.now();
		if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
		this.lastCallAt = Date.now();

		const query = new URLSearchParams({
			key: process.env.RAWG_API_KEY,
			...Object.fromEntries(
				Object.entries(params).map(([name, value]) => [name, String(value)])
			),
		});

		try {
			const response = await fetch(`${RAWG_URL}${path}?${query}`, {
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});

			if (response.ok) return (await response.json()) as T;

			// La clé n'est jamais journalisée : seul le chemin l'est.
			this.logger.warn(`RAWG ${path} -> ${response.status}`);
			if (response.status === 401 || response.status === 429) {
				// Clé refusée ou quota épuisé chez RAWG : insister ne ferait que
				// brûler des appels. On reprend le lendemain.
				this.haltedUntil = nextUtcMidnight();
			} else if (response.status >= 500) {
				this.haltedUntil = Date.now() + SERVER_ERROR_PAUSE_MS;
			}
			return null;
		} catch (error) {
			this.logger.warn(`RAWG ${path} -> ${(error as Error).message}`);
			this.haltedUntil = Date.now() + SERVER_ERROR_PAUSE_MS;
			return null;
		}
	}

	/** Réserve un appel dans le quota, ou refuse. */
	private async reserve(): Promise<boolean> {
		const today = utcDay();
		const { todayCalls, monthCalls } = await this.counts(today);

		if (todayCalls >= this.dailyCap || monthCalls >= this.monthlyCap) {
			this.logger.warn(
				`RAWG quota reached (today ${todayCalls}/${this.dailyCap}, month ${monthCalls}/${this.monthlyCap})`
			);
			this.haltedUntil = nextUtcMidnight();
			return false;
		}

		await this.prisma.rawgApiUsage.upsert({
			where: { day: today },
			create: { day: today, calls: 1 },
			update: { calls: { increment: 1 } },
		});
		return true;
	}

	private async counts(today: Date) {
		const monthStart = new Date(
			Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
		);
		const [day, month] = await Promise.all([
			this.prisma.rawgApiUsage.findUnique({ where: { day: today } }),
			this.prisma.rawgApiUsage.aggregate({
				_sum: { calls: true },
				where: { day: { gte: monthStart } },
			}),
		]);
		return { todayCalls: day?.calls ?? 0, monthCalls: month._sum.calls ?? 0 };
	}

	async usage(): Promise<RawgUsage> {
		const { todayCalls, monthCalls } = await this.counts(utcDay());
		return {
			enabled: this.configured,
			today: todayCalls,
			month: monthCalls,
			dailyCap: this.dailyCap,
			monthlyCap: this.monthlyCap,
			haltedUntil:
				this.haltedUntil > Date.now()
					? new Date(this.haltedUntil).toISOString()
					: null,
		};
	}
}
