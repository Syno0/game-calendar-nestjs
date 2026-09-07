import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Provider, User } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { OAUTH_PROVIDERS, OAuthProfile } from "./oauth.providers";

export interface PublicUser {
	id: string;
	displayName: string;
	avatarUrl: string | null;
	email: string | null;
	providers: Provider[];
}

@Injectable()
export class UserAuthService {
	private readonly logger = new Logger(UserAuthService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly jwtService: JwtService
	) {}

	buildAuthorizeUrl(provider: Provider, redirectUri: string, state: string) {
		const config = OAUTH_PROVIDERS[provider];
		const clientId = config.clientId();
		if (!clientId)
			throw new Error(`Missing client id for provider ${provider}`);

		const params = new URLSearchParams({
			client_id: clientId,
			redirect_uri: redirectUri,
			response_type: "code",
			scope: config.scope,
			state,
		});
		return `${config.authorizeUrl}?${params.toString()}`;
	}

	async exchange(provider: Provider, code: string, redirectUri: string) {
		const profile = await this.fetchProfile(provider, code, redirectUri);
		const user = await this.upsertUser(provider, profile);
		return {
			token: this.issueToken(user),
			user: await this.toPublicUser(user),
		};
	}

	private async fetchProfile(
		provider: Provider,
		code: string,
		redirectUri: string
	): Promise<OAuthProfile> {
		const config = OAUTH_PROVIDERS[provider];
		const response = await fetch(config.tokenUrl, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: config.clientId(),
				client_secret: config.clientSecret(),
				code,
				grant_type: "authorization_code",
				redirect_uri: redirectUri,
			}).toString(),
		});

		if (!response.ok) {
			// Never log the body: it echoes back the code and the client secret.
			this.logger.error(
				`Token exchange with ${provider} failed (${response.status})`
			);
			throw new UnauthorizedException("OAuth token exchange failed");
		}

		const { access_token } = await response.json();
		if (!access_token)
			throw new UnauthorizedException("OAuth provider returned no token");

		return config.fetchProfile(access_token);
	}

	private async upsertUser(provider: Provider, profile: OAuthProfile) {
		const existingAccount = await this.prisma.account.findUnique({
			where: {
				provider_providerAccountId: {
					provider,
					providerAccountId: profile.providerAccountId,
				},
			},
			include: { user: true },
		});

		if (existingAccount) {
			return this.prisma.user.update({
				where: { id: existingAccount.userId },
				data: {
					displayName: profile.displayName,
					avatarUrl: profile.avatarUrl,
				},
			});
		}

		// Only a verified address may attach this login to an account that
		// already exists — see the note in oauth.providers.ts.
		const linkable =
			profile.emailVerified && profile.email
				? await this.prisma.user.findUnique({
						where: { email: profile.email },
					})
				: null;

		if (linkable) {
			await this.prisma.account.create({
				data: {
					provider,
					providerAccountId: profile.providerAccountId,
					email: profile.email,
					userId: linkable.id,
				},
			});
			this.logger.log(`Linked ${provider} account to user ${linkable.id}`);
			return linkable;
		}

		const created = await this.prisma.user.create({
			data: {
				email: profile.emailVerified ? profile.email : null,
				displayName: profile.displayName,
				avatarUrl: profile.avatarUrl,
				accounts: {
					create: {
						provider,
						providerAccountId: profile.providerAccountId,
						email: profile.email,
					},
				},
			},
		});
		this.logger.log(`Created user ${created.id} from ${provider}`);
		return created;
	}

	private issueToken(user: User) {
		return this.jwtService.sign({ sub: user.id });
	}

	async toPublicUser(user: User): Promise<PublicUser> {
		const accounts = await this.prisma.account.findMany({
			where: { userId: user.id },
			select: { provider: true },
		});
		return {
			id: user.id,
			displayName: user.displayName,
			avatarUrl: user.avatarUrl,
			email: user.email,
			providers: accounts.map((account) => account.provider),
		};
	}

	async findById(id: string) {
		return this.prisma.user.findUnique({ where: { id } });
	}
}
