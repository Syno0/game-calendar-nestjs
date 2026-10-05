/**
 * Rapprocher un jeu IGDB de sa fiche RAWG.
 *
 * IGDB ne connaît pas RAWG parmi ses sources externes (`/external_game_sources`),
 * et RAWG ignore tout des identifiants IGDB : le nom est la seule clé commune.
 * D'où une normalisation assez agressive pour absorber les variantes d'écriture
 * (« Marvel's Spider-Man 2 » / « Marvel’s Spider‑Man 2 »), puis un départage
 * par l'année et les plateformes pour les homonymes — les remakes portent
 * souvent le nom exact de l'original.
 *
 * Mieux vaut pas de correspondance qu'une fausse : une erreur ici déplacerait
 * un jeu dans le calendrier sur la foi de la date d'un autre.
 */

const ROMAN: Record<string, number> = {
	ii: 2,
	iii: 3,
	iv: 4,
	vi: 6,
	vii: 7,
	viii: 8,
	ix: 9,
	xi: 11,
	xii: 12,
	xiii: 13,
	xiv: 14,
	xv: 15,
	xvi: 16,
};

/**
 * Le nom réduit à ce qui le distingue.
 *
 * Les chiffres romains d'une seule lettre (« v », « x ») restent tels quels :
 * « Mega Man X » n'est pas « Mega Man 10 », et les deux existent.
 */
export const nameKey = (name: string | null | undefined): string => {
	if (!name) return "";

	return name
		// Avant NFKD, qui décompose « ™ » en « TM » : retiré après, il
		// laisserait « 2tm » au bout du titre.
		.replace(/[™®©]/g, "")
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.split(" ")
		.map((word) => (ROMAN[word] !== undefined ? String(ROMAN[word]) : word))
		.filter((word, index) => !(index === 0 && word === "the"))
		.join(" ");
};

/**
 * Slugs IGDB → slugs RAWG, pour les plateformes que le calendrier propose.
 * Une plateforme absente ici ne pénalise rien : elle ne fait juste pas
 * pencher la balance.
 */
const RAWG_PLATFORM: Record<string, string> = {
	win: "pc",
	mac: "macos",
	linux: "linux",
	ps5: "playstation5",
	"ps4--1": "playstation4",
	ps3: "playstation3",
	"series-x-s": "xbox-series-x",
	xboxone: "xbox-one",
	// Pas de Switch 2 : RAWG n'a pas (encore) de plateforme pour elle.
	switch: "nintendo-switch",
	wiiu: "wii-u",
	wii: "wii",
	ios: "ios",
	android: "android",
};

export const rawgPlatformOf = (igdbSlug?: string | null): string | undefined =>
	igdbSlug ? RAWG_PLATFORM[igdbSlug] : undefined;

/** Ce que l'on sait du jeu IGDB au moment de le rapprocher. */
export interface IgdbMatchInput {
	id: number;
	name: string;
	slug?: string | null;
	alternativeNames?: string[];
	/** L'année de la sortie retenue, si IGDB en annonce une. */
	year?: number | null;
	/** Le jour de sortie, seulement quand IGDB le connaît au jour près. */
	releaseDay?: Date | null;
	platformSlugs?: string[];
}

/** Une fiche RAWG candidate, telle qu'elle est stockée. */
export interface RawgCandidate {
	rawgId: number;
	slug: string;
	name: string;
	nameKey: string;
	released: Date | null;
	platformSlugs: string[];
}

export interface RawgMatch {
	rawgId: number;
	score: number;
}

/** En dessous, on préfère ne rien lier. */
export const MATCH_THRESHOLD = 0.75;

/** Écart maximal entre les deux dates pour qu'un nom approché suffise. */
export const FUZZY_DAYS = 14;

/**
 * Deux noms proches sans être identiques : « Phantom Blade 0 » chez IGDB,
 * « Phantom Blade Zero » chez RAWG. Au moins deux mots en commun, et la
 * moitié des mots des deux noms réunis.
 */
const similarNames = (a: string, b: string): boolean => {
	const left = new Set(a.split(" ").filter(Boolean));
	const right = new Set(b.split(" ").filter(Boolean));
	const shared = [...left].filter((word) => right.has(word)).length;
	const union = new Set([...left, ...right]).size;
	return shared >= 2 && union > 0 && shared / union >= 0.5;
};

/** Les clés sous lesquelles chercher le jeu en base. */
export const matchKeys = (game: IgdbMatchInput): string[] =>
	[
		...new Set(
			[game.name, ...(game.alternativeNames ?? [])].map(nameKey).filter(Boolean)
		),
	];

const scoreOf = (game: IgdbMatchInput, candidate: RawgCandidate): number => {
	let score: number;

	if (game.slug && candidate.slug === game.slug) score = 1;
	else if (candidate.nameKey === nameKey(game.name)) score = 1;
	else if (matchKeys(game).includes(candidate.nameKey)) score = 0.9;
	else if (
		// Un nom seulement approché ne suffit jamais seul : il faut que les
		// deux sources s'accordent aussi sur le jour, à deux semaines près.
		// C'est volontairement conservateur — un jeu dont IGDB et RAWG
		// divergent sur la date ne sera pas lié par ce chemin-là.
		game.releaseDay &&
		candidate.released &&
		Math.abs(game.releaseDay.getTime() - candidate.released.getTime()) <=
			FUZZY_DAYS * 86_400_000 &&
		matchKeys(game).some((key) => similarNames(key, candidate.nameKey))
	)
		score = 0.8;
	else return 0;

	// L'année tranche entre un jeu et son remake homonyme. Un an d'écart reste
	// courant (un jeu repoussé, une base qui n'a pas suivi) ; au-delà, c'est
	// presque toujours un autre jeu.
	const candidateYear = candidate.released?.getUTCFullYear();
	if (game.year && candidateYear) {
		const gap = Math.abs(game.year - candidateYear);
		if (gap === 1) score -= 0.1;
		else if (gap > 1) score -= 0.5;
	} else {
		score -= 0.05;
	}

	const wanted = (game.platformSlugs ?? [])
		.map(rawgPlatformOf)
		.filter((slug): slug is string => !!slug);
	if (wanted.length > 0 && candidate.platformSlugs.length > 0) {
		const shared = wanted.some((slug) => candidate.platformSlugs.includes(slug));
		score += shared ? 0.05 : -0.2;
	}

	return score;
};

/**
 * La meilleure fiche RAWG pour ce jeu, ou rien.
 *
 * Deux candidats à égalité en tête, c'est un homonyme qu'on ne sait pas
 * départager : on s'abstient plutôt que de tirer au sort.
 */
export const matchRawg = (
	game: IgdbMatchInput,
	candidates: RawgCandidate[]
): RawgMatch | null => {
	const scored = candidates
		.map((candidate) => ({
			rawgId: candidate.rawgId,
			score: scoreOf(game, candidate),
		}))
		.filter((match) => match.score >= MATCH_THRESHOLD)
		.sort((a, b) => b.score - a.score);

	if (scored.length === 0) return null;
	if (scored.length > 1 && scored[1].score === scored[0].score) return null;

	return { rawgId: scored[0].rawgId, score: Math.min(scored[0].score, 1) };
};
