import { Inject, Injectable, Logger } from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { createCanvas, loadImage, Image, SKRSContext2D } from "@napi-rs/canvas";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { join } from "path";
import type { DatePrecision } from "../app.service";

/**
 * Deux formats pour deux usages, une seule mise en page.
 *
 * `og` doit tenir dans le cadre 1,91:1 que Discord, X et WhatsApp recadrent
 * sans pitié : hauteur fixe, nombre de jeux plafonné. `full` est l'image qu'on
 * télécharge et qu'on regarde en entier : elle grandit avec la liste.
 */
export type ImageLayout = "og" | "full";

interface RenderOptions {
	displayName: string;
	year: number;
	layout: ImageLayout;
	/** Texte de la ligne de marque, à côté du logo. */
	siteUrl: string;
}

/** Un jeu tel que `AppService.enrichGames` le rend. */
interface RenderableGame {
	id: number;
	name: string;
	cover?: { url?: string } | null;
	/** « JJ/MM/AAAA » tel que rendu par l'API ; seul le jour et le mois servent. */
	date?: string | null;
	/** Ce qu'IGDB sait vraiment de la date : voir `dateBadgeLabel`. */
	date_precision?: DatePrecision | null;
	/** « April », « Q1 », « 2026 » quand le jour n'est pas connu. */
	day_label?: string | null;
}

const PALETTE = {
	/** Le pourtour, presque noir : c'est lui qui fait ressortir le panneau. */
	edge: "#08080A",
	/**
	 * Le panneau, d'un seul ton.
	 *
	 * Il portait un dégradé vertical et un halo rosé, qui laissaient tous deux
	 * voir leurs paliers de couleur : dix niveaux étalés sur mille pixels ne
	 * peuvent pas être lisses sur huit bits, et le halo trahissait en plus le
	 * cercle où il s'arrêtait. Le tramage masquait les paliers sans effacer ce
	 * cercle. Un aplat n'a ni l'un ni l'autre défaut, et laisse les jaquettes
	 * porter seules le contraste — ce qu'elles font mieux qu'une lueur.
	 */
	panel: "#131317",
	/** Filet clair d'un pixel : suffit à détacher le panneau du pourtour. */
	hairline: "rgba(255,255,255,0.07)",
	text: "#E9E9EC",
	muted: "#A1A1AA",
	faint: "#6B6B75",
	accent: "#F87171",
	accentEnd: "#EC4899",
	/** `from-primary to-info` du badge de jour, côté calendrier. */
	badgeStart: "#3B82F6",
	badgeEnd: "#06B6D4",
	coverFallback: "#1C1C21",
};

/**
 * Famille de police, citée explicitement.
 *
 * « sans-serif » ne veut rien dire de stable : sur une machine de dev il tombe
 * sur ce que fontconfig veut bien donner (un serif, en l'occurrence), et
 * l'image `node:22-alpine` n'embarque aucune police. Noto Sans est installé par
 * le Dockerfile et couvre le latin étendu ; le repli garde un rendu lisible si
 * elle venait à manquer.
 */
const FONT = '"Noto Sans", "DejaVu Sans", sans-serif';

const WIDTH = 1200;
/** Marge entre le bord de l'image et le panneau intérieur. */
const FRAME = 16;
const PAD = 52;
/** Hauteur du logo dans la ligne de marque. */
const LOGO_SIZE = 46;
/** Corps de l'année, dans le coin haut droit. */
const YEAR_SIZE = 68;
/** Rayon des coins d'une jaquette. La pastille de date s'y aligne. */
const COVER_RADIUS = 10;
/** Rapport hauteur/largeur d'une jaquette IGDB (264 × 374). */
const COVER_RATIO = 374 / 264;

const LAYOUTS: Record<
	ImageLayout,
	{ columns: number; maxGames: number; gap: number; titleLines: number; height?: number }
> = {
	og: { columns: 6, maxGames: 12, gap: 16, titleLines: 1, height: 630 },
	full: { columns: 5, maxGames: 40, gap: 22, titleLines: 2 },
};

/**
 * Le logo du site, copié dans `dist/` par `nest-cli.json`. `__dirname` pointe
 * sur le dossier du service compilé, donc `assets/` est bien à côté.
 */
const LOGO_PATH = join(__dirname, "..", "assets", "logo.png");

const COVER_CACHE_TTL = 7 * 24 * 3600 * 1000;
const IMAGE_CACHE_TTL = 6 * 3600 * 1000;

@Injectable()
export class FavoritesImageService {
	private readonly logger = new Logger(FavoritesImageService.name);
	/** Décodé une fois pour toutes : il est identique sur chaque image. */
	private logo: Image | null = null;
	private logoLoaded = false;

	constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

	private async loadLogo(): Promise<Image | null> {
		if (this.logoLoaded) return this.logo;
		this.logoLoaded = true;
		try {
			this.logo = await loadImage(await readFile(LOGO_PATH));
		} catch (err) {
			// L'image reste valable sans lui : c'est le texte de marque qui porte
			// l'essentiel, le logo n'est qu'un ornement.
			this.logger.warn(`Logo unavailable (${LOGO_PATH}): ${err}`);
			this.logo = null;
		}
		return this.logo;
	}

	/**
	 * L'image partageable d'une année, en PNG.
	 *
	 * Le résultat est mis en cache sous une empreinte des identifiants affichés :
	 * ajouter ou retirer un favori change l'empreinte, donc l'image, sans qu'on
	 * ait à invalider quoi que ce soit à la main.
	 *
	 * `fromCache` remonte avec l'image parce que l'appelant en journalise une
	 * par une : une demande servie du cache n'a rien fait dessiner, et le
	 * back-office distingue les deux.
	 */
	async render(
		games: RenderableGame[],
		options: RenderOptions,
		cacheScope: string
	): Promise<{ buffer: Buffer; fromCache: boolean }> {
		const preset = LAYOUTS[options.layout];
		const shown = games.slice(0, preset.maxGames);
		// Le nom entre dans l'empreinte au même titre que les jeux : il est écrit
		// en toutes lettres sur l'image, et changer de pseudo chez Twitch ou
		// Discord doit se voir tout de suite, pas au bout des six heures de cache.
		const fingerprint = createHash("sha1")
			.update(`${options.displayName}|${games.map((game) => game.id).join(",")}`)
			.digest("hex")
			.slice(0, 12);
		const cacheKey = `fav_image_v2_${cacheScope}_${options.year}_${options.layout}_${fingerprint}`;

		const cached = await this.cacheManager.get<string>(cacheKey);
		if (cached) return { buffer: Buffer.from(cached, "base64"), fromCache: true };

		const [covers, logo] = await Promise.all([
			Promise.all(shown.map((game) => this.loadCover(game))),
			this.loadLogo(),
		]);
		const buffer = this.draw(shown, covers, logo, games.length, options);

		await this.cacheManager.set(cacheKey, buffer.toString("base64"), IMAGE_CACHE_TTL);
		return { buffer, fromCache: false };
	}

	/**
	 * Une jaquette décodée, ou `null` si elle manque.
	 *
	 * Les images sont récupérées ici, côté serveur : pas de question de CORS, et
	 * la même jaquette resservie à plusieurs personnes n'est téléchargée qu'une
	 * fois.
	 */
	private async loadCover(game: RenderableGame): Promise<Image | null> {
		const url = game.cover?.url;
		if (!url) return null;

		const absolute = url.startsWith("//") ? `https:${url}` : url;
		const cacheKey = `fav_cover_${absolute}`;

		try {
			const cached = await this.cacheManager.get<string>(cacheKey);
			if (cached) return await loadImage(Buffer.from(cached, "base64"));

			const response = await fetch(absolute);
			if (!response.ok) return null;

			const bytes = Buffer.from(await response.arrayBuffer());
			await this.cacheManager.set(cacheKey, bytes.toString("base64"), COVER_CACHE_TTL);
			return await loadImage(bytes);
		} catch (err) {
			// Une jaquette manquante laisse une case sobre : ce n'est pas une
			// raison pour rendre toute l'image indisponible.
			this.logger.warn(`Cover unavailable (${absolute}): ${err}`);
			return null;
		}
	}

	private draw(
		games: RenderableGame[],
		covers: (Image | null)[],
		logo: Image | null,
		totalCount: number,
		{ displayName, year, layout, siteUrl }: RenderOptions
	): Buffer {
		const preset = LAYOUTS[layout];
		const contentWidth = WIDTH - PAD * 2;
		const cellWidth =
			(contentWidth - preset.gap * (preset.columns - 1)) / preset.columns;
		const titleHeight = preset.titleLines * 22 + 10;
		const rows = Math.max(1, Math.ceil(games.length / preset.columns));

		// Marque (ligne de base PAD+19) et titre (PAD+84) à gauche, année à droite
		// sur la même ligne de base, son trait descendant jusqu'à PAD+102 — plus
		// une respiration avant la première rangée de jaquettes.
		const headerHeight = PAD + 102 + 30;
		const footerHeight = 58;
		let coverHeight = cellWidth * COVER_RATIO;
		let height =
			preset.height ??
			headerHeight + rows * (coverHeight + titleHeight) + (rows - 1) * preset.gap + footerHeight + PAD;

		// Décalage vertical de la mosaïque sous l'en-tête. Il ne bouge que dans le
		// format à hauteur fixe, où il faut occuper la place restante.
		let gridTop = headerHeight;

		if (preset.height) {
			const available =
				preset.height - headerHeight - footerHeight - PAD - rows * titleHeight - (rows - 1) * preset.gap;
			// Bornée par le rapport naturel : sans ce plafond, une seule rangée
			// étirait les jaquettes sur toute la hauteur et les rognait de moitié.
			coverHeight = Math.max(40, Math.min(available / rows, cellWidth * COVER_RATIO));
			const gridHeight = rows * (coverHeight + titleHeight) + (rows - 1) * preset.gap;
			const slot = available + rows * titleHeight + (rows - 1) * preset.gap;
			gridTop = headerHeight + Math.max(0, (slot - gridHeight) / 2);
			height = preset.height;
		}

		// Une rangée unique et incomplète collée à gauche laisse un grand vide à
		// droite : on la centre. Au-delà, la grille reste alignée à gauche.
		const rowOffset =
			rows === 1
				? Math.max(
						0,
						(contentWidth - games.length * cellWidth - (games.length - 1) * preset.gap) / 2
					)
				: 0;

		const canvas = createCanvas(WIDTH, height);
		const ctx = canvas.getContext("2d");

		this.drawBackground(ctx, height);
		this.drawHeader(ctx, logo, siteUrl, displayName, year);

		games.forEach((game, index) => {
			const column = index % preset.columns;
			const row = Math.floor(index / preset.columns);
			const x = PAD + rowOffset + column * (cellWidth + preset.gap);
			const y = gridTop + row * (coverHeight + titleHeight + preset.gap);

			this.drawCover(ctx, covers[index], x, y, cellWidth, coverHeight);
			this.drawDateBadge(ctx, this.dateBadgeLabel(game), x, y, cellWidth, coverHeight);
			this.drawTitle(ctx, game.name, x, y + coverHeight + 20, cellWidth, preset.titleLines);
		});

		this.drawFooter(ctx, height, totalCount, games.length);
		this.drawFrame(ctx, height);

		return canvas.toBuffer("image/png");
	}

	/**
	 * Pourtour presque noir, panneau intérieur à peine plus clair.
	 *
	 * L'ancien liseré rouge de six pixels faisait tout le bruit de l'image et
	 * écrasait les jaquettes. Ici c'est la matière qui structure : un fond très
	 * sombre, un panneau détaché par un simple filet clair, et une lueur diffuse
	 * derrière l'en-tête pour la profondeur. La couleur d'accent ne subsiste que
	 * sur l'année et sur un court trait sous la marque.
	 */
	private drawBackground(ctx: SKRSContext2D, height: number) {
		ctx.fillStyle = PALETTE.edge;
		ctx.fillRect(0, 0, WIDTH, height);

		ctx.fillStyle = PALETTE.panel;
		this.roundedRect(ctx, FRAME, FRAME, WIDTH - FRAME * 2, height - FRAME * 2, 26);
		ctx.fill();
	}

	/** Le filet clair qui détache le panneau du pourtour. Un pixel suffit. */
	private drawFrame(ctx: SKRSContext2D, height: number) {
		ctx.strokeStyle = PALETTE.hairline;
		ctx.lineWidth = 1;
		this.roundedRect(ctx, FRAME + 0.5, FRAME + 0.5, WIDTH - FRAME * 2 - 1, height - FRAME * 2 - 1, 26);
		ctx.stroke();
	}

	/**
	 * Marque, titre, année — de haut en bas, alignés à gauche.
	 *
	 * La marque passe en tête plutôt que sur le flanc : l'image circule seule,
	 * détachée du site, et doit dire d'où elle vient avant de dire ce qu'elle
	 * montre. Elle a remplacé le filigrane latéral, qui répétait la même adresse
	 * une seconde fois.
	 */
	private drawHeader(
		ctx: SKRSContext2D,
		logo: Image | null,
		brand: string,
		displayName: string,
		year: number
	) {
		ctx.textBaseline = "alphabetic";

		// ── Année, en grand dans le coin droit ───────────────────────────────
		// Elle équilibre le bloc de gauche et donne son sujet à l'image d'un coup
		// d'œil, ce qu'un petit label sous le titre ne faisait pas.
		const yearLabel = String(year);
		ctx.font = `bold ${YEAR_SIZE}px ${FONT}`;
		const yearWidth = ctx.measureText(yearLabel).width;
		const yearRight = WIDTH - PAD;
		const gradient = ctx.createLinearGradient(yearRight - yearWidth, 0, yearRight, 0);
		gradient.addColorStop(0, PALETTE.accent);
		gradient.addColorStop(1, PALETTE.accentEnd);
		ctx.fillStyle = gradient;
		ctx.textAlign = "right";
		ctx.fillText(yearLabel, yearRight, PAD + 84);
		// Trait sous l'année : la seule autre trace de couleur de l'image.
		ctx.fillRect(yearRight - yearWidth, PAD + 98, yearWidth, 4);
		ctx.textAlign = "left";

		// ── Ligne de marque ──────────────────────────────────────────────────
		let brandX = PAD;
		if (logo) {
			ctx.drawImage(logo, PAD, PAD - 12, LOGO_SIZE, LOGO_SIZE);
			brandX = PAD + LOGO_SIZE + 12;
		}
		ctx.fillStyle = PALETTE.muted;
		ctx.font = `600 23px ${FONT}`;
		ctx.fillText(brand, brandX, PAD + 19);

		// ── Titre ────────────────────────────────────────────────────────────
		// Tronqué avant l'année : un pseudo à rallonge ne doit pas venir buter
		// dedans.
		ctx.fillStyle = PALETTE.text;
		ctx.font = `bold 42px ${FONT}`;
		const title = `Games tracked by ${displayName}`;
		const room = WIDTH - PAD * 2 - yearWidth - 40;
		ctx.fillText(this.ellipsize(ctx, title, room), PAD, PAD + 84);
	}

	private drawCover(
		ctx: SKRSContext2D,
		cover: Image | null,
		x: number,
		y: number,
		width: number,
		height: number
	) {
		ctx.save();
		this.roundedRect(ctx, x, y, width, height, COVER_RADIUS);
		ctx.clip();

		if (cover) {
			// `cover` au sens CSS : on remplit la case et on rogne le débord,
			// sinon les jaquettes hors format écrasent la mosaïque.
			const scale = Math.max(width / cover.width, height / cover.height);
			const drawWidth = cover.width * scale;
			const drawHeight = cover.height * scale;
			ctx.drawImage(
				cover,
				x + (width - drawWidth) / 2,
				y + (height - drawHeight) / 2,
				drawWidth,
				drawHeight
			);
		} else {
			ctx.fillStyle = PALETTE.coverFallback;
			ctx.fillRect(x, y, width, height);
		}
		ctx.restore();
	}

	private drawTitle(
		ctx: SKRSContext2D,
		name: string,
		x: number,
		y: number,
		width: number,
		maxLines: number
	) {
		ctx.fillStyle = PALETTE.text;
		ctx.font = `600 17px ${FONT}`;
		ctx.textBaseline = "alphabetic";

		const words = name.split(" ");
		const lines: string[] = [];
		let line = "";
		let dropped = false;

		for (const word of words) {
			const candidate = line ? `${line} ${word}` : word;
			if (ctx.measureText(candidate).width <= width || !line) {
				line = candidate;
			} else {
				lines.push(line);
				line = word;
				if (lines.length === maxLines) {
					// Il reste des mots qu'on n'écrira pas.
					dropped = true;
					break;
				}
			}
		}
		if (!dropped && line) lines.push(line);

		lines.forEach((text, index) => {
			const isLast = index === lines.length - 1;
			// L'ellipse doit apparaître même quand la dernière ligne tient : c'est
			// le seul signe que le titre continue. « Gears of War: » sans elle se
			// lit comme un nom complet.
			const rendered =
				isLast && dropped
					? this.truncate(ctx, text, width)
					: this.ellipsize(ctx, text, width);
			ctx.fillText(rendered, x, y + index * 22);
		});
	}

	/**
	 * Ce qu'écrit la pastille d'une jaquette.
	 *
	 * L'API rend « JJ/MM/AAAA » : dans une image déjà titrée par son année,
	 * répéter l'année sur chaque jaquette n'apprendrait rien, donc le jour et le
	 * mois suffisent. Mais cette date-là n'existe que pour les sorties connues
	 * au jour près : pour les autres, IGDB a fabriqué un jour (le 1er du mois,
	 * le 31/12 d'une année) qu'il ne faut pas afficher. On écrit alors ce que
	 * l'API sait vraiment — « April », « Q1 », « 2026 » — comme la pastille du
	 * calendrier. L'année répétée est ici le moindre mal : elle dit que ce jeu
	 * n'a pas de date, là où « 31/12 » prétendrait le contraire.
	 */
	private dateBadgeLabel(game: RenderableGame): string | null {
		if (game.date_precision && game.date_precision !== "day") {
			return game.day_label ?? null;
		}

		return game.date ? game.date.slice(0, 5) : null;
	}

	/**
	 * La date de sortie, en pastille dans le coin de la jaquette.
	 *
	 * Reprend le badge de jour des cartes du calendrier : posé à ras du coin,
	 * arrondi du seul côté qui n'est pas contre un bord, dégradé bleu → cyan.
	 * Découpée avec la jaquette pour épouser son coin arrondi, et ombrée parce
	 * qu'une jaquette claire avalerait sinon le bleu.
	 */
	private drawDateBadge(
		ctx: SKRSContext2D,
		label: string | null | undefined,
		x: number,
		y: number,
		coverWidth: number,
		coverHeight: number
	) {
		if (!label) return;

		ctx.save();
		this.roundedRect(ctx, x, y, coverWidth, coverHeight, COVER_RADIUS);
		ctx.clip();

		ctx.font = `bold 16px ${FONT}`;
		const padX = 9;
		const badgeWidth = ctx.measureText(label).width + padX * 2;
		const badgeHeight = 27;
		const corner = 9;

		ctx.beginPath();
		ctx.moveTo(x, y);
		ctx.lineTo(x + badgeWidth, y);
		ctx.lineTo(x + badgeWidth, y + badgeHeight - corner);
		ctx.arcTo(x + badgeWidth, y + badgeHeight, x + badgeWidth - corner, y + badgeHeight, corner);
		ctx.lineTo(x, y + badgeHeight);
		ctx.closePath();

		const gradient = ctx.createLinearGradient(x, y, x + badgeWidth, y + badgeHeight);
		gradient.addColorStop(0, PALETTE.badgeStart);
		gradient.addColorStop(1, PALETTE.badgeEnd);
		ctx.fillStyle = gradient;
		ctx.shadowColor = "rgba(0,0,0,0.45)";
		ctx.shadowBlur = 8;
		ctx.shadowOffsetY = 2;
		ctx.fill();
		ctx.shadowColor = "transparent";
		ctx.shadowBlur = 0;
		ctx.shadowOffsetY = 0;

		ctx.fillStyle = "#FFFFFF";
		ctx.textBaseline = "alphabetic";
		ctx.fillText(label, x + padX, y + 19);
		ctx.restore();
	}

	private drawFooter(
		ctx: SKRSContext2D,
		height: number,
		totalCount: number,
		shownCount: number
	) {
		ctx.fillStyle = PALETTE.muted;
		ctx.font = `500 20px ${FONT}`;
		ctx.textBaseline = "alphabetic";
		const plural = totalCount > 1 ? "games tracked" : "game tracked";
		const partial = totalCount > shownCount ? `  ·  ${shownCount} shown` : "";
		ctx.fillText(`${totalCount} ${plural}${partial}`, PAD, height - PAD + 12);
	}

	/** Coupe si nécessaire, en signalant la coupe. */
	private ellipsize(ctx: SKRSContext2D, text: string, maxWidth: number): string {
		if (ctx.measureText(text).width <= maxWidth) return text;
		return this.truncate(ctx, text, maxWidth);
	}

	/**
	 * Ajoute l'ellipse dans tous les cas, quitte à raccourcir.
	 *
	 * Distinct d'`ellipsize` : ici on *sait* qu'il manque du texte, même si ce
	 * qui reste tient dans la largeur. C'est la seule marque qui dit au lecteur
	 * que le titre continue.
	 */
	private truncate(ctx: SKRSContext2D, text: string, maxWidth: number): string {
		let cut = text;
		while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
			cut = cut.slice(0, -1);
		}
		return `${cut.trimEnd()}…`;
	}

	private roundedRect(
		ctx: SKRSContext2D,
		x: number,
		y: number,
		width: number,
		height: number,
		radius: number
	) {
		const r = Math.min(radius, width / 2, height / 2);
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + width, y, x + width, y + height, r);
		ctx.arcTo(x + width, y + height, x, y + height, r);
		ctx.arcTo(x, y + height, x, y, r);
		ctx.arcTo(x, y, x + width, y, r);
		ctx.closePath();
	}
}
