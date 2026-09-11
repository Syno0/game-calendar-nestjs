import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ADMIN_JWT_SECRET } from "../admin.config";

/**
 * Session d'administration, transmise par le BFF en en-tête Bearer.
 *
 * Troisième famille de jetons, après "jwt" (compte de service, cookie) et
 * "user-jwt" (session utilisateur, Bearer). Les deux premières partagent
 * JWT_KEY et ne se distinguent que par l'audience ; celle-ci ne peut pas se
 * contenter du même arrangement.
 *
 * La raison est précise : `AuthService.validateUser` accepte le compte de
 * service quand le mot de passe vaut `process.env.JWT_KEY` — le secret de
 * signature *est* le mot de passe. Et ce mot de passe est écrit en clair dans
 * le BFF (`server.py`, API_CREDENTIALS), donc versionné. JWT_KEY est par
 * conséquent un secret public : signer un jeton d'administration avec lui
 * reviendrait à laisser n'importe quel lecteur du dépôt en forger un.
 *
 * D'où ADMIN_JWT_KEY, sans rapport avec JWT_KEY. L'audience "admin" reste,
 * mais ce n'est plus elle qui porte la séparation — c'est le secret.
 */
@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, "admin-jwt") {
	constructor() {
		super({
			jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
			ignoreExpiration: false,
			secretOrKey: ADMIN_JWT_SECRET,
			audience: "admin",
		});
	}

	/**
	 * Il n'y a pas de table à interroger : le compte vit dans les variables
	 * d'environnement. On revérifie tout de même le nom porté par le jeton
	 * contre ADMIN_USERNAME, pour qu'un changement d'identifiant invalide
	 * immédiatement les sessions en cours au lieu de les laisser courir
	 * jusqu'à expiration.
	 */
	async validate(payload: { sub?: string }) {
		const expected = process.env.ADMIN_USERNAME;
		if (!payload?.sub || !expected || payload.sub !== expected) {
			throw new UnauthorizedException();
		}
		return { username: payload.sub };
	}
}
