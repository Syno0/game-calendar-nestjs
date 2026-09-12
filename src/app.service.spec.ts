import { AppService } from "./app.service";
import { IgdbApi } from "./clients/igdb";
import { Release_date } from "./common/interfaces/igdb.interface";

/**
 * Midi UTC plutôt que minuit : `format()` rend la date dans le fuseau de la
 * machine, et une ligne datée à minuit bascule la veille pour tout serveur à
 * l'ouest de Greenwich — le test passerait ici et échouerait ailleurs.
 */
const NOON_7_APRIL = Math.floor(Date.UTC(2027, 3, 7, 12) / 1000);
const NOON_8_APRIL = Math.floor(Date.UTC(2027, 3, 8, 12) / 1000);

const row = (
	id: number,
	date: number,
	slug: string,
	status?: { id: number; name: string },
	dateFormat?: number
): Release_date =>
	({
		id,
		date,
		game: 1,
		platform: { id: 1, name: slug, slug },
		status,
		date_format:
			dateFormat === undefined ? undefined : { id: dateFormat, format: "" },
	}) as Release_date;

const ADVANCED_ACCESS = { id: 34, name: "Advanced Access" };
const FULL_RELEASE = { id: 6, name: "Full Release" };

/**
 * Le cas Final Fantasy VII Revelation : chaque plateforme porte deux lignes,
 * l'accès anticipé de l'édition deluxe le 7 et la sortie complète le 8.
 */
const deluxeRows = [
	row(1, NOON_7_APRIL, "win", ADVANCED_ACCESS),
	row(2, NOON_7_APRIL, "ps5", ADVANCED_ACCESS),
	row(3, NOON_8_APRIL, "win", FULL_RELEASE),
	row(4, NOON_8_APRIL, "ps5", FULL_RELEASE),
];

const serviceWith = (rows: Release_date[]) =>
	new AppService({
		getGamesByIds: async () => [{ id: 1, name: "Game" }],
		getReleaseDatesByGameIds: async () => rows,
		getGamesBetweenDates: async () => rows,
	} as unknown as IgdbApi);

describe("AppService — sortie complète vs accès anticipé", () => {
	it("date le calendrier sur la sortie complète, pas sur l'accès anticipé", async () => {
		const [game] = await serviceWith(deluxeRows).getGames({
			start_date: "2027-04-01",
			end_date: "2027-04-30",
		});

		expect(game.date).toBe("08/04/2027");
		expect(game.day).toBe("08");
		expect(game.early_access_date).toBe("07/04/2027");
		expect(game.early_access_label).toBe("Advanced Access");
	});

	it("garde la sortie complète de la plateforme suivie en favori", async () => {
		const [game] = await serviceWith(deluxeRows).getGamesByIds(
			[1],
			new Map([[1, "win"]])
		);

		expect(game.date).toBe("08/04/2027");
		expect(game.platform.slug).toBe("win");
		expect(game.early_access_date).toBe("07/04/2027");
	});

	it("signale le jeu qui sort lui-même en accès anticipé", async () => {
		const earlyAccessRelease = [
			row(6, NOON_8_APRIL, "win", { id: 3, name: "Early Access" }),
		];
		const [game] = await serviceWith(earlyAccessRelease).getGamesByIds([1]);

		expect(game.is_early_access).toBe(true);
		expect(game.release_status).toBe("Early Access");
	});

	it("ne signale rien pour une sortie complète", async () => {
		const [game] = await serviceWith(deluxeRows).getGamesByIds([1]);

		expect(game.is_early_access).toBe(false);
		expect(game.release_status).toBe("Full Release");
	});

	it("retombe sur l'accès anticipé quand c'est la seule date annoncée", async () => {
		const earlyOnly = deluxeRows.filter((r) => r.status?.id === 34);
		const [game] = await serviceWith(earlyOnly).getGamesByIds([1]);

		// La date reste affichée — sinon le jeu n'aurait plus de date du tout —
		// mais elle ne se double pas d'une fiche « accès anticipé ».
		expect(game.date).toBe("07/04/2027");
		expect(game.early_access_date).toBeNull();
	});

	it("n'invente pas d'accès anticipé pour une sortie sans statut", async () => {
		const plain = [row(5, NOON_8_APRIL, "win")];
		const [game] = await serviceWith(plain).getGamesByIds([1]);

		expect(game.date).toBe("08/04/2027");
		expect(game.early_access_date).toBeNull();
		expect(game.early_access_label).toBeNull();
	});
});

/**
 * IGDB date quand même les sorties imprécises : le 1er du mois pour un mois
 * seul, le dernier jour de la période pour un trimestre ou une année. La carte
 * doit rester à cette place — c'est le seul repère disponible — mais la date
 * affichée ne doit pas prétendre à un jour qui n'a jamais été annoncé.
 */
describe("AppService — précision de la date", () => {
	const FIRST_DAY_OF_JULY = Math.floor(Date.UTC(2026, 6, 1, 12) / 1000);
	const LAST_DAY_OF_MARCH = Math.floor(Date.UTC(2027, 2, 31, 12) / 1000);
	const LAST_DAY_OF_YEAR = Math.floor(Date.UTC(2026, 11, 31, 12) / 1000);

	const labelsOf = async (date: number, dateFormat?: number) => {
		const [game] = await serviceWith([
			row(9, date, "win", undefined, dateFormat),
		]).getGamesByIds([1]);
		return game;
	};

	it("écrit le mois quand seul le mois est connu", async () => {
		const game = await labelsOf(FIRST_DAY_OF_JULY, 1);

		expect(game.date_precision).toBe("month");
		expect(game.date_label).toBe("July 2026");
		expect(game.day_label).toBe("July");
	});

	it("renvoie un mois seul en fin de mois, pas en tête", async () => {
		const game = await labelsOf(FIRST_DAY_OF_JULY, 1);

		// IGDB le date du 1er ; le laisser là le ferait ouvrir le mois, devant
		// tous les jeux qui sortent un jour connu.
		expect(game.date).toBe("31/07/2026");
		expect(game.day).toBe("31");
		expect(game.release_at.slice(0, 10)).toBe("2026-07-31");
	});

	it("laisse trimestre et année là où IGDB les met, déjà en fin de période", async () => {
		const quarter = await labelsOf(LAST_DAY_OF_MARCH, 3);
		const year = await labelsOf(LAST_DAY_OF_YEAR, 2);

		expect(quarter.date).toBe("31/03/2027");
		expect(year.date).toBe("31/12/2026");
	});

	it("écrit l'année quand seule l'année est connue", async () => {
		const game = await labelsOf(LAST_DAY_OF_YEAR, 2);

		expect(game.date).toBe("31/12/2026");
		expect(game.date_precision).toBe("year");
		expect(game.date_label).toBe("2026");
		expect(game.day_label).toBe("2026");
	});

	it("écrit le trimestre quand la sortie est annoncée par trimestre", async () => {
		const game = await labelsOf(LAST_DAY_OF_MARCH, 3);

		expect(game.date_precision).toBe("quarter");
		expect(game.date_label).toBe("Q1 2027");
		expect(game.day_label).toBe("Q1");
	});

	it("garde la date au jour près quand IGDB la donne", async () => {
		const game = await labelsOf(NOON_8_APRIL, 0);

		expect(game.date_precision).toBe("day");
		expect(game.date_label).toBe("08/04/2027");
		expect(game.day_label).toBe("08");
	});

	it("traite une ligne sans date_format comme une date exacte", async () => {
		const game = await labelsOf(NOON_8_APRIL);

		expect(game.date_precision).toBe("day");
		expect(game.date_label).toBe("08/04/2027");
	});
});
