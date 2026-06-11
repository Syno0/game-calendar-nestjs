import { Injectable, Logger, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
	private readonly logger = new Logger("HTTP");

	use(req: Request, res: Response, next: NextFunction) {
		const startHrTime = process.hrtime.bigint();

		res.on("finish", () => {
			const endHrTime = process.hrtime.bigint();
			const durationMs = Number(endHrTime - startHrTime) / 1_000_000;
			const isLogin = req.originalUrl.split("?")[0] === "/auth/login";
			const body = !isLogin && req.body ? JSON.stringify(req.body) : "";
			this.logger.log(
				`${req.method} ${req.originalUrl} - ${res.statusCode} - ${body} - ${durationMs.toFixed(1)}ms`
			);
		});

		// If POST then show req.body
		// if (req.method == 'POST' && req.body)
		//   console.log(
		//     `${req.method} ${req.originalUrl} - ${res.statusCode}\n${JSON.stringify(req.body)}`,
		//   );
		// else console.log(`${req.method} ${req.originalUrl} - ${res.statusCode}`);

		// Display full information (opt-in by uncommenting)
		// console.log({ headers: req.headers, originalUrl: req.originalUrl, body: req.body, query: req.query });

		// Ends middleware function execution, hence allowing to move on
		if (next) next();
	}
}
