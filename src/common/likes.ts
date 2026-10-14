/**
 * Ce qu'un like sur GameCalendar (un jeu mis en favori) ajoute à la hype d'un
 * jeu. La hype d'IGDB mesure l'attente de *sa* communauté ; celle de nos
 * utilisateurs n'y figure pas, et un jeu suivi ici restait invisible dès que
 * le filtre de hype dépassait son score IGDB. Dix, c'est le pas qui fait
 * franchir à un jeu liké une fois le seuil de 10.
 */
export const LIKE_HYPE = 10;

/**
 * La hype d'IGDB seule, même sur un jeu déjà enrichi. Le cache d'IGDB peut
 * rendre l'objet qu'un enrichissement précédent a modifié : partir de
 * `hypes`, qui inclut déjà les likes, les compterait deux fois.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const igdbHypesOf = (game: any): number =>
	game?.igdb_hypes ?? game?.hypes ?? 0;

export const hypeWithLikes = (igdbHypes: number, likes: number): number =>
	(igdbHypes ?? 0) + LIKE_HYPE * (likes ?? 0);
