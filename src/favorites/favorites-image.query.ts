import { BadRequestException } from "@nestjs/common";
import { ImageLayout } from "./favorites-image.service";

/** Bornes de bon sens : hors de là, la demande n'a pas de sens pour un calendrier. */
const MIN_YEAR = 1970;
const MAX_YEAR = 2100;

/**
 * Valide `?year=&layout=`, partagé par la route privée et la route publique.
 *
 * L'année est obligatoire et bornée : une valeur libre finirait interpolée dans
 * une clé de cache, et un `NaN` produirait une image titrée « NaN ».
 */
export const parseImageQuery = (
	year: string,
	layout: string
): { year: number; layout: ImageLayout } => {
	const parsedYear = Number.parseInt(year, 10);
	if (!Number.isInteger(parsedYear) || parsedYear < MIN_YEAR || parsedYear > MAX_YEAR) {
		throw new BadRequestException(`year must be an integer between ${MIN_YEAR} and ${MAX_YEAR}`);
	}

	if (layout !== undefined && layout !== "og" && layout !== "full") {
		throw new BadRequestException('layout must be "og" or "full"');
	}

	return { year: parsedYear, layout: (layout as ImageLayout) ?? "full" };
};
