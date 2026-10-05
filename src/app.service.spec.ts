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

/**
 * RAWG et les forçages admin : la date peut venir d'ailleurs qu'IGDB, et le
 * jeu doit alors changer de case — quitter le mois qu'IGDB lui donnait et
 * entrer dans celui de la date retenue.
 */
describe("AppService — dates venues de RAWG", () => {
	const unix = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);
	const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

	const igdbRow = (game: number, iso: string): Release_date =>
		({
			id: game,
			game,
			date: unix(iso),
			updated_at: unix("2026-05-01"),
			platform: { id: 6, name: "PC", slug: "win" },
		}) as Release_date;

	/** Un lien RAWG dont la date a changé le 30/09, après la ligne IGDB. */
	const linked = (igdbGameId: number, released: string) => ({
		link: {
			igdbGameId,
			rawgId: 100 + igdbGameId,
			method: "name",
			rawg: {
				rawgId: 100 + igdbGameId,
				slug: `game-${igdbGameId}`,
				released: utc(released),
				tba: false,
				releasedSeenAt: utc("2026-09-30"),
				metacritic: 88,
				rating: 4.2,
				ratingsCount: 120,
				added: 5000,
				addedByStatus: { toplay: 900 },
				esrb: "Mature",
				playtime: 30,
			},
		},
	});

	const service = (options: {
		october: Release_date[];
		elsewhere?: Release_date[];
		infos: Record<number, unknown>;
		movedInto?: number[];
	}) =>
		new AppService(
			{
				getGamesBetweenDates: async () => options.october,
				getGamesByIds: async (ids: number[]) =>
					[...new Set(ids)].map((id) => ({ id, name: `Game ${id}`, hypes: 50 })),
				getReleaseDatesByGameIds: async () => options.elsewhere ?? [],
			} as unknown as IgdbApi,
			{
				lookup: async (ids: number[]) =>
					new Map(
						ids
							.filter((id) => options.infos[id])
							.map((id) => [id, options.infos[id]])
					),
				findMovedInto: async () => options.movedInto ?? [],
				ensureMonths: () => undefined,
				observe: () => undefined,
			} as never
		);

	const october = { start_date: "2026-10-01", end_date: "2026-10-31" };

	it("retire du mois un jeu que RAWG, plus récent, envoie ailleurs", async () => {
		const games = await service({
			october: [igdbRow(1, "2026-10-15"), igdbRow(2, "2026-10-20")],
			infos: { 1: linked(1, "2026-11-12") },
		}).getGames(october);

		expect(games.map((game) => game.id)).toEqual([2]);
	});

	it("fait entrer dans le mois un jeu que RAWG y déplace", async () => {
		const games = await service({
			october: [igdbRow(2, "2026-10-20")],
			elsewhere: [igdbRow(3, "2026-12-01")],
			infos: { 3: linked(3, "2026-10-09") },
			movedInto: [3],
		}).getGames(october);

		const moved = games.find((game) => game.id === 3);
		expect(moved.date).toBe("09/10/2026");
		expect(moved.date_source).toBe("rawg");
		expect(moved.date_sources).toEqual({ igdb: "01/12/2026", rawg: "09/10/2026" });
	});

	it("expose les données RAWG du jeu lié", async () => {
		const [game] = await service({
			october: [igdbRow(1, "2026-10-15")],
			infos: { 1: { link: { ...linked(1, "2026-10-15").link } } },
		}).getGames(october);

		expect(game.date_source).toBe("igdb");
		expect(game.metacritic).toBe(88);
		expect(game.rawg).toMatchObject({
			url: "https://rawg.io/games/game-1",
			wishlist: 900,
			esrb: "Mature",
			playtime: 30,
		});
	});

	it("applique un forçage manuel posé depuis /admin", async () => {
		const [game] = await service({
			october: [igdbRow(1, "2026-10-15")],
			infos: {
				1: {
					override: {
						igdbGameId: 1,
						source: "manual",
						date: utc("2026-10-01"),
						precision: "month",
					},
				},
			},
		}).getGames(october);

		expect(game.date_source).toBe("manual");
		expect(game.date_label).toBe("October 2026");
		expect(game.date).toBe("31/10/2026");
	});

	it("laisse un jeu sans lien RAWG exactement comme IGDB le donne", async () => {
		const [game] = await service({
			october: [igdbRow(1, "2026-10-15")],
			infos: {},
		}).getGames(october);

		expect(game.date).toBe("15/10/2026");
		expect(game.date_source).toBe("igdb");
		expect(game.rawg).toBeNull();
		expect(game.metacritic).toBeNull();
	});

	it("ignore la date RAWG d'un portage, mais garde ses notes", async () => {
		// Kingdom Hearts III sur une nouvelle console en octobre 2026 : RAWG ne
		// connaît que la sortie de 2019, qui ne doit pas déplacer la carte.
		const port = new AppService(
			{
				getGamesBetweenDates: async () => [igdbRow(1, "2026-10-08")],
				getGamesByIds: async () => [
					{ id: 1, name: "Kingdom Hearts III", hypes: 110, first_release_date: unix("2019-01-25") },
				],
				getReleaseDatesByGameIds: async () => [],
			} as unknown as IgdbApi,
			{
				lookup: async () => new Map([[1, linked(1, "2019-01-25")]]),
				findMovedInto: async () => [],
				ensureMonths: () => undefined,
				observe: () => undefined,
			} as never
		);

		const [game] = await port.getGames(october);

		expect(game.date).toBe("08/10/2026");
		expect(game.date_source).toBe("igdb");
		expect(game.date_sources.rawg).toBeNull();
		expect(game.metacritic).toBe(88);
	});
});

