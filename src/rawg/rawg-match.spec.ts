import { matchRawg, nameKey, RawgCandidate } from "./rawg-match";

const candidate = (
	rawgId: number,
	name: string,
	released: string | null,
	platformSlugs: string[] = [],
	slug = `rawg-${rawgId}`
): RawgCandidate => ({
	rawgId,
	slug,
	name,
	nameKey: nameKey(name),
	released: released ? new Date(`${released}T00:00:00Z`) : null,
	platformSlugs,
});

describe("nameKey", () => {
	it("absorbe ponctuation, apostrophes typographiques et marques", () => {
		expect(nameKey("Marvel’s Spider‑Man 2™")).toBe(nameKey("Marvel's Spider-Man 2"));
		expect(nameKey("Pokémon Legends: Z-A")).toBe("pokemon legends z a");
	});

	it("convertit les chiffres romains de plusieurs lettres", () => {
		expect(nameKey("Final Fantasy VII Rebirth")).toBe("final fantasy 7 rebirth");
		expect(nameKey("Kingdom Hearts III")).toBe(nameKey("Kingdom Hearts 3"));
	});

	it("laisse les lettres seules, qui ne sont pas toujours des chiffres", () => {
		expect(nameKey("Mega Man X")).not.toBe(nameKey("Mega Man 10"));
	});

	it("retire l'article initial et traduit l'esperluette", () => {
		expect(nameKey("The Witcher 4")).toBe("witcher 4");
		expect(nameKey("Ratchet & Clank")).toBe("ratchet and clank");
	});
});

describe("matchRawg", () => {
	it("retrouve le jeu par son nom", () => {
		const match = matchRawg({ id: 1, name: "Hollow Knight: Silksong", year: 2025 }, [
			candidate(10, "Hollow Knight Silksong", "2025-09-04"),
		]);
		expect(match?.rawgId).toBe(10);
	});

	it("retrouve le jeu par un nom alternatif", () => {
		const match = matchRawg(
			{ id: 1, name: "Biohazard 9", alternativeNames: ["Resident Evil Requiem"], year: 2026 },
			[candidate(10, "Resident Evil Requiem", "2026-02-27")]
		);
		expect(match?.rawgId).toBe(10);
		expect(match?.score).toBeLessThan(1);
	});

	it("départage un remake de l'original par l'année", () => {
		const match = matchRawg({ id: 1, name: "Silent Hill f", year: 2025 }, [
			candidate(10, "Silent Hill F", "1999-01-01"),
			candidate(11, "Silent Hill F", "2025-09-25"),
		]);
		expect(match?.rawgId).toBe(11);
	});

	it("refuse un homonyme sorti des années plus tôt", () => {
		const match = matchRawg({ id: 1, name: "Prey", year: 2027 }, [
			candidate(10, "Prey", "2017-05-05"),
		]);
		expect(match).toBeNull();
	});

	it("s'abstient entre deux candidats indiscernables", () => {
		const match = matchRawg({ id: 1, name: "Untitled Game" }, [
			candidate(10, "Untitled Game", null),
			candidate(11, "Untitled Game", null),
		]);
		expect(match).toBeNull();
	});

	it("préfère le candidat qui partage une plateforme", () => {
		const match = matchRawg(
			{ id: 1, name: "Tetris", year: 2026, platformSlugs: ["ps5"] },
			[
				candidate(10, "Tetris", "2026-03-01", ["nintendo-switch"]),
				candidate(11, "Tetris", "2026-03-01", ["playstation5"]),
			]
		);
		expect(match?.rawgId).toBe(11);
	});

	it("reconnaît le slug identique même quand le nom diverge", () => {
		const match = matchRawg({ id: 1, name: "GTA VI", slug: "grand-theft-auto-vi", year: 2026 }, [
			candidate(10, "Grand Theft Auto VI", "2026-11-19", [], "grand-theft-auto-vi"),
		]);
		expect(match?.rawgId).toBe(10);
	});

	it("accepte un nom approché quand la date concorde (Phantom Blade 0 / Zero)", () => {
		const match = matchRawg(
			{ id: 1, name: "Phantom Blade 0", year: 2026, releaseDay: new Date("2026-10-29T00:00:00Z") },
			[candidate(10, "Phantom Blade Zero", "2026-10-29", ["playstation5"])]
		);
		expect(match?.rawgId).toBe(10);
	});

	it("refuse le même nom approché quand les dates divergent", () => {
		const match = matchRawg(
			{ id: 1, name: "Phantom Blade 0", year: 2026, releaseDay: new Date("2026-10-29T00:00:00Z") },
			[candidate(10, "Phantom Blade Zero", "2026-12-15")]
		);
		expect(match).toBeNull();
	});

	it("ne lie pas deux jeux différents sortis le même jour", () => {
		const match = matchRawg(
			{ id: 1, name: "Dragon Quest XII", year: 2026, releaseDay: new Date("2026-10-29T00:00:00Z") },
			[candidate(10, "Dragon Ball Sparking Zero", "2026-10-29")]
		);
		expect(match).toBeNull();
	});
});
