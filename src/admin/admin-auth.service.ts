import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { ADMIN_CONFIGURED } from "./admin.config";

/**
 * Hash de rebut, utilisé quand l'identifiant est inconnu.
 *
 * Sans lui, un nom d'utilisateur erroné répondrait immédiatement là où un nom
 * correct ferait attendre le temps d'un bcrypt (~100 ms) : l'écart suffit à
 * découvrir l'identifiant par simple chronométrage. On compare donc toujours,
 * quitte à comparer contre rien.
 *
 * C'est le hash de la chaîne "*", sans intérêt en soi — seul son coût compte,
 * et il doit être le même (12) que celui des vrais mots de passe.
 */
const DECOY_HASH = "$2b$12$/uTcK9hloZgKIJqmoyV75OmCZhMoaVd6kl9zbbqeVW.8oYjTAGFd2";

@Injectable()
export class AdminAuthService {
	private readonly logger = new Logger(AdminAuthService.name);

	constructor(private readonly jwtService: JwtService) {}

	/**
	 * Ne journalise jamais les identifiants reçus, ni en cas d'échec. Le nom
	 * d'utilisateur essayé est déjà une information : c'est la moitié du
	 * secret, et les journaux sont rotatifs sur quatorze jours.
	 */
	async login(username: string, password: string): Promise<{ token: string }> {
		// Mal configuré : on refuse avant même de comparer. `admin.config`
		// a déjà journalisé la raison au démarrage.
		if (!ADMIN_CONFIGURED) throw new UnauthorizedException("Invalid credentials");

		const expectedUser = process.env.ADMIN_USERNAME;
		const expectedHash = process.env.ADMIN_PASSWORD_HASH;

		const known = Boolean(expectedUser) && username === expectedUser;
		const valid = await bcrypt.compare(
			password,
			known && expectedHash ? expectedHash : DECOY_HASH
		);

		if (!known || !valid) {
			this.logger.warn("Failed admin login attempt");
			throw new UnauthorizedException("Invalid credentials");
		}

		this.logger.log("Admin signed in");
		return { token: this.jwtService.sign({ sub: username }) };
	}
}
