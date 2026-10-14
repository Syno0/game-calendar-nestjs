import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * La durée de conservation promise par la politique de confidentialité :
 * un compte sans activité depuis trois ans est supprimé. La changer ici,
 * c'est changer un engagement public — les deux pages (EN et FR) de
 * `frontend/src/pages/legal/` doivent bouger avec.
 */
export const INACTIVITY_YEARS = 3;

const FIRST_RUN_MS = 10 * 60 * 1000;
const EVERY_MS = 24 * 3600 * 1000;

/** En UTC : la date de coupure ne doit pas dépendre du fuseau du conteneur. */
export const inactivityCutoff = (now: Date, years = INACTIVITY_YEARS): Date => {
	const cutoff = new Date(now);
	cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
	return cutoff;
};

/**
 * La purge des comptes inactifs.
 *
 * Un minuteur et non une tâche externe : il n'y a pas de cron sur l'hôte, et
 * une purge oubliée ne se voit pas — c'est précisément le genre d'engagement
 * qui doit vivre avec le code qui le rend vrai. Une passe quotidienne suffit,
 * la granularité de la règle étant l'année.
 */
@Injectable()
export class AccountRetentionService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(AccountRetentionService.name);
	private timers: NodeJS.Timeout[] = [];

	constructor(private readonly prisma: PrismaService) {}

	onModuleInit() {
		// `unref` : un minuteur actif empêcherait node de s'arrêter dans les
		// tests et les scripts qui instancient le module.
		const first = setTimeout(() => this.purge(), FIRST_RUN_MS);
		const every = setInterval(() => this.purge(), EVERY_MS);
		first.unref();
		every.unref();
		this.timers = [first, every];
	}

	onModuleDestroy() {
		this.timers.forEach((timer) => clearTimeout(timer));
	}

	async purge(now = new Date()): Promise<number> {
		try {
			// Favoris, comptes OAuth et images partagées suivent par cascade.
			const { count } = await this.prisma.user.deleteMany({
				where: { lastSeenAt: { lt: inactivityCutoff(now) } },
			});
			if (count > 0)
				this.logger.log(`Deleted ${count} account(s) inactive for ${INACTIVITY_YEARS} years`);
			return count;
		} catch (error) {
			// Base indisponible : la passe du lendemain rattrapera.
			this.logger.error(`Inactive account purge failed: ${error}`);
			return 0;
		}
	}
}
