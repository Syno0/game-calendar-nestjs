import { Logger } from "@nestjs/common";
import { randomBytes } from "crypto";

/**
 * Validation de la configuration du back-office, faite une seule fois au
 * chargement du module.
 *
 * Le parti pris : ne jamais empêcher l'application de démarrer. Une variable
 * d'environnement oubliée sur le VPS couperait sinon le calendrier public,
 * l'authentification Twitch/Discord et les favoris — tout ça pour une page
 * d'administration que personne n'attend dans la seconde. On échoue donc
 * *fermé* plutôt que fort : mal configuré, le back-office refuse toute
 * connexion, et le reste du site continue de tourner.
 *
 * Deux défauts distincts, même traitement :
 *
 *  - ADMIN_JWT_KEY absent, ou ADMIN_USERNAME / ADMIN_PASSWORD_HASH manquants :
 *    le back-office n'est simplement pas configuré ;
 *  - ADMIN_JWT_KEY égal à JWT_KEY : c'est une faille, pas un oubli. JWT_KEY
 *    sert aussi de mot de passe au compte de service (auth.service.ts) et ce
 *    mot de passe est écrit en clair dans le BFF, donc versionné. Réutiliser
 *    la même valeur laisserait n'importe quel lecteur du dépôt forger un
 *    jeton d'administration. Ce cas doit être aussi mort que le précédent.
 *
 * Quand la configuration est invalide, le secret devient une valeur aléatoire
 * éphémère : la stratégie Passport se construit normalement (elle exige un
 * secret non vide), mais aucun jeton au monde ne peut la satisfaire — et de
 * toute façon `AdminAuthService` refuse de signer.
 */

const logger = new Logger("AdminConfig");

function validate(): { ok: boolean; reason?: string } {
	const { ADMIN_JWT_KEY, ADMIN_USERNAME, ADMIN_PASSWORD_HASH, JWT_KEY } =
		process.env;

	if (!ADMIN_JWT_KEY) return { ok: false, reason: "ADMIN_JWT_KEY is not set" };
	if (JWT_KEY && ADMIN_JWT_KEY === JWT_KEY) {
		return {
			ok: false,
			reason:
				"ADMIN_JWT_KEY must differ from JWT_KEY — JWT_KEY doubles as the " +
				"service account password and is committed to the repository",
		};
	}
	if (!ADMIN_USERNAME) return { ok: false, reason: "ADMIN_USERNAME is not set" };
	if (!ADMIN_PASSWORD_HASH) {
		return { ok: false, reason: "ADMIN_PASSWORD_HASH is not set" };
	}
	if (!/^\$2[aby]\$\d{2}\$/.test(ADMIN_PASSWORD_HASH)) {
		return {
			ok: false,
			reason: "ADMIN_PASSWORD_HASH is not a bcrypt hash — store the hash, not the password",
		};
	}
	return { ok: true };
}

const result = validate();

if (!result.ok) {
	logger.error(
		`Backoffice disabled: ${result.reason}. /admin will reject every sign-in ` +
			`until this is fixed; the rest of the API is unaffected.`
	);
}

export const ADMIN_CONFIGURED = result.ok;

/** Le secret réel, ou une valeur éphémère qu'aucun jeton ne peut satisfaire. */
export const ADMIN_JWT_SECRET = result.ok
	? process.env.ADMIN_JWT_KEY
	: randomBytes(48).toString("hex");
