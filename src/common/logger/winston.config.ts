import { WinstonModuleOptions } from "nest-winston";
import * as winston from "winston";
import "winston-daily-rotate-file";

const logFormat = winston.format.combine(
	winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
	winston.format.printf(({ timestamp, level, message, context }) => {
		const ctx = context ? ` [${String(context)}]` : "";
		return `${String(timestamp)} ${level.toUpperCase()}${ctx} ${String(message)}`;
	})
);

export const winstonConfig: WinstonModuleOptions = {
	level: process.env.LOG_LEVEL ?? "debug",
	transports: [
		// Keep console output so `docker logs` still works
		new winston.transports.Console({
			format: logFormat,
		}),
		// One file per day, e.g. logs/app-2026-06-11.log
		new winston.transports.DailyRotateFile({
			dirname: process.env.LOG_DIR ?? "logs",
			filename: "app-%DATE%.log",
			datePattern: "YYYY-MM-DD",
			zippedArchive: true,
			maxFiles: process.env.LOG_MAX_FILES ?? "14d",
			format: logFormat,
		}),
		// Errors also go to a dedicated daily file
		new winston.transports.DailyRotateFile({
			dirname: process.env.LOG_DIR ?? "logs",
			filename: "error-%DATE%.log",
			datePattern: "YYYY-MM-DD",
			level: "error",
			zippedArchive: true,
			maxFiles: process.env.LOG_MAX_FILES ?? "14d",
			format: logFormat,
		}),
	],
};
