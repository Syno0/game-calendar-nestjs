import { Provider } from "@prisma/client";

export interface OAuthProfile {
	providerAccountId: string;
	email: string | null;
	/**
	 * Only a verified email may be used to link this login to an existing user.
	 * Anything else would let anyone take over an account by signing up
	 * elsewhere with the victim's address.
	 */
	emailVerified: boolean;
	displayName: string;
	avatarUrl: string | null;
}

export interface OAuthProviderConfig {
	authorizeUrl: string;
	tokenUrl: string;
	scope: string;
	clientId: () => string;
	clientSecret: () => string;
	fetchProfile: (accessToken: string) => Promise<OAuthProfile>;
}

export const OAUTH_PROVIDERS: Record<Provider, OAuthProviderConfig> = {
	TWITCH: {
		authorizeUrl: "https://id.twitch.tv/oauth2/authorize",
		tokenUrl: "https://id.twitch.tv/oauth2/token",
		scope: "user:read:email",
		// Same Twitch application as the one backing the IGDB token.
		clientId: () => process.env.TWITCH_CLIENT,
		clientSecret: () => process.env.TWITCH_SECRET,
		fetchProfile: async (accessToken: string): Promise<OAuthProfile> => {
			const response = await fetch("https://api.twitch.tv/helix/users", {
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"Client-Id": process.env.TWITCH_CLIENT,
				},
			});
			if (!response.ok)
				throw new Error(`Twitch profile request failed (${response.status})`);
			const body = await response.json();
			const user = body?.data?.[0];
			if (!user) throw new Error("Twitch returned an empty profile");
			return {
				providerAccountId: String(user.id),
				email: user.email ?? null,
				// Twitch only hands out an address once it has been verified.
				emailVerified: Boolean(user.email),
				displayName: user.display_name || user.login,
				avatarUrl: user.profile_image_url ?? null,
			};
		},
	},
	DISCORD: {
		authorizeUrl: "https://discord.com/oauth2/authorize",
		tokenUrl: "https://discord.com/api/oauth2/token",
		scope: "identify email",
		clientId: () => process.env.DISCORD_CLIENT_ID,
		clientSecret: () => process.env.DISCORD_CLIENT_SECRET,
		fetchProfile: async (accessToken: string): Promise<OAuthProfile> => {
			const response = await fetch("https://discord.com/api/users/@me", {
				headers: { Authorization: `Bearer ${accessToken}` },
			});
			if (!response.ok)
				throw new Error(`Discord profile request failed (${response.status})`);
			const user = await response.json();
			return {
				providerAccountId: String(user.id),
				email: user.email ?? null,
				emailVerified: Boolean(user.email && user.verified),
				displayName: user.global_name || user.username,
				avatarUrl: user.avatar
					? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
					: null,
			};
		},
	},
};

export const parseProvider = (value: string): Provider | null => {
	const normalized = String(value || "").toUpperCase();
	return normalized === "TWITCH" || normalized === "DISCORD"
		? (normalized as Provider)
		: null;
};
