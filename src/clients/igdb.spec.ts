import { mergeSearchHits, sanitizeSearchTerm } from "./igdb";

const hit = (id: number, name: string) => ({ id, name });

/**
 * La fusion des deux recherches. Les cas viennent tous d'une requête réelle :
 * « Clockwork Rev » ne renvoie rien par `search`, et « clockwork » y noie le
 * jeu attendu sous huit titres obscurs.
 */
describe("mergeSearchHits", () => {
	it("remonte le titre exact en tête, avant un titre plus long et plus hypé", () => {
		const byName = [hit(2, "Clockwork Revolution"), hit(1, "Clockwork")];

		expect(mergeSearchHits("clockwork", [], byName, 8)[0]).toEqual(
			hit(1, "Clockwork")
		);
	});

	it("préfère les titres commencés à ce que `search` a classé", () => {
		const byRelevance = [hit(9, "Clockwork Pussy"), hit(8, "Clockwork Dawn")];
		const byName = [hit(2, "Clockwork Revolution")];

		const merged = mergeSearchHits("clockwork rev", byRelevance, byName, 8);

		expect(merged[0]).toEqual(hit(2, "Clockwork Revolution"));
		expect(merged).toHaveLength(3);
	});

	it("garde les résultats de `search` que le nom seul ne trouve pas", () => {
		// Le cas « ff7 » : aucun titre ne contient la chaîne tapée.
		const byRelevance = [hit(5, "Final Fantasy VII")];

		expect(mergeSearchHits("ff7", byRelevance, [], 8)).toEqual([
			hit(5, "Final Fantasy VII"),
		]);
	});

	it("ne rend jamais deux fois le même jeu", () => {
		const both = [hit(2, "Clockwork Revolution")];

		expect(mergeSearchHits("clockwork", both, both, 8)).toHaveLength(1);
	});

	it("s'arrête à la limite demandée", () => {
		const byName = [hit(1, "A"), hit(2, "B"), hit(3, "C")];

		expect(mergeSearchHits("x", [], byName, 2)).toHaveLength(2);
	});
});

describe("sanitizeSearchTerm", () => {
	it("neutralise ce qui refermerait la chaîne de la requête IGDB", () => {
		expect(sanitizeSearchTerm('clock"; where id = 1; //')).toBe(
			"clock where id = 1 //"
		);
	});

	it("réduit les espaces et coupe les termes interminables", () => {
		expect(sanitizeSearchTerm("  clockwork   revolution ")).toBe(
			"clockwork revolution"
		);
		expect(sanitizeSearchTerm("a".repeat(200))).toHaveLength(100);
	});
});
