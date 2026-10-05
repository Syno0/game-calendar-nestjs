import { Release_date } from "../common/interfaces/igdb.interface";
import { manualDateRow, rawgDateRow, resolveReleaseDate } from "./date-resolution";

const unix = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Une ligne IGDB modifiée le `updated`, datant la sortie du `date`. */
const igdb = (date: string, updated: string, format?: number): Release_date =>
	({
		id: 1,
		game: 1,
		date: unix(date),
		updated_at: unix(updated),
		platform: { id: 6, name: "PC", slug: "win" },
		date_format: format === undefined ? undefined : { id: format, format: "" },
	}) as Release_date;

const rawg = (released: string | null, seen: string | null, tba = false) => ({
	released: released ? utc(released) : null,
	tba,
	releasedSeenAt: seen ? utc(seen) : null,
});

describe("resolveReleaseDate", () => {
	it("garde IGDB quand RAWG n'a pas de date", () => {
		const result = resolveReleaseDate(igdb("2026-11-19", "2026-05-01"), rawg(null, null, true));
		expect(result.source).toBe("igdb");
		expect(result.rawgRow).toBeUndefined();
	});

	it("garde IGDB tant qu'on n'a jamais vu la date RAWG changer", () => {
		const result = resolveReleaseDate(igdb("2026-11-19", "2026-05-01"), rawg("2026-12-03", null));
		expect(result.source).toBe("igdb");
		expect(result.rawgRow?.date).toBe(unix("2026-12-03"));
	});

	it("prend RAWG quand sa date a changé après la dernière modification IGDB", () => {
		const result = resolveReleaseDate(
			igdb("2026-11-19", "2026-05-01"),
			rawg("2026-12-03", "2026-09-30")
		);
		expect(result.source).toBe("rawg");
		expect(result.row?.date).toBe(unix("2026-12-03"));
	});

	it("garde IGDB quand c'est lui qui a bougé en dernier", () => {
		const result = resolveReleaseDate(
			igdb("2026-11-19", "2026-10-01"),
			rawg("2026-12-03", "2026-09-30")
		);
		expect(result.source).toBe("igdb");
	});

	it("ne revendique rien quand les deux tombent le même jour", () => {
		const result = resolveReleaseDate(
			igdb("2026-11-19", "2026-05-01"),
			rawg("2026-11-19", "2026-09-30")
		);
		expect(result.source).toBe("igdb");
	});

	it("tient un jour d'écart pour un effet de fuseau, pas un désaccord", () => {
		const result = resolveReleaseDate(
			igdb("2026-10-16", "2026-05-01"),
			rawg("2026-10-15", "2026-09-30")
		);
		expect(result.source).toBe("igdb");
	});

	it("prend RAWG faute de toute date IGDB", () => {
		const result = resolveReleaseDate(undefined, rawg("2027-03-12", null));
		expect(result.source).toBe("rawg");
	});

	it("ignore une date RAWG marquée TBA", () => {
		const result = resolveReleaseDate(undefined, rawg("2027-03-12", "2026-09-30", true));
		expect(result.source).toBe("igdb");
		expect(result.row).toBeUndefined();
	});

	it("obéit au forçage IGDB même quand RAWG est plus récent", () => {
		const result = resolveReleaseDate(
			igdb("2026-11-19", "2026-05-01"),
			rawg("2026-12-03", "2026-09-30"),
			{ source: "igdb", date: null, precision: null }
		);
		expect(result.source).toBe("igdb");
	});

	it("obéit au forçage RAWG même quand IGDB est plus récent", () => {
		const result = resolveReleaseDate(
			igdb("2026-11-19", "2026-10-01"),
			rawg("2026-12-03", null),
			{ source: "rawg", date: null, precision: null }
		);
		expect(result.source).toBe("rawg");
		expect(result.row?.date).toBe(unix("2026-12-03"));
	});

	it("applique une date manuelle", () => {
		const result = resolveReleaseDate(igdb("2026-11-19", "2026-05-01"), null, {
			source: "manual",
			date: utc("2027-02-14"),
			precision: "day",
		});
		expect(result.source).toBe("manual");
		expect(result.row?.date).toBe(unix("2027-02-14"));
	});
});

describe("rawgDateRow", () => {
	it("lit un 31 décembre comme une année annoncée", () => {
		expect(rawgDateRow(rawg("2027-12-31", null))?.date_format?.id).toBe(2);
		expect(rawgDateRow(rawg("2027-03-12", null))?.date_format?.id).toBe(0);
	});
});

describe("manualDateRow", () => {
	const manual = (date: string, precision: "day" | "month" | "quarter" | "year" | "tbd") =>
		manualDateRow({ source: "manual", date: utc(date), precision });

	it("recale chaque précision sur la convention d'IGDB", () => {
		expect(manual("2027-04-17", "month")).toEqual({
			date: unix("2027-04-01"),
			date_format: { id: 1, format: "" },
		});
		expect(manual("2027-05-17", "quarter")).toEqual({
			date: unix("2027-06-30"),
			date_format: { id: 4, format: "" },
		});
		expect(manual("2027-05-17", "year")?.date).toBe(unix("2027-12-31"));
		expect(manual("2027-05-17", "tbd")?.date_format?.id).toBe(7);
	});
});
