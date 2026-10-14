import { AccountRetentionService, inactivityCutoff } from "./account-retention.service";

describe("inactivityCutoff", () => {
	it("recule de trois ans, à l'heure UTC près", () => {
		expect(inactivityCutoff(new Date("2026-10-14T09:30:00Z")).toISOString()).toBe(
			"2023-10-14T09:30:00.000Z"
		);
	});

	it("tombe au 1er mars quand le 29 février n'existe plus", () => {
		expect(inactivityCutoff(new Date("2028-02-29T00:00:00Z")).toISOString()).toBe(
			"2025-03-01T00:00:00.000Z"
		);
	});
});

describe("AccountRetentionService.purge", () => {
	it("ne supprime que les comptes vus avant la coupure", async () => {
		const deleteMany = jest.fn().mockResolvedValue({ count: 2 });
		const service = new AccountRetentionService({ user: { deleteMany } } as any);

		await expect(service.purge(new Date("2026-10-14T00:00:00Z"))).resolves.toBe(2);
		expect(deleteMany).toHaveBeenCalledWith({
			where: { lastSeenAt: { lt: new Date("2023-10-14T00:00:00Z") } },
		});
	});

	it("rend zéro sans lever quand la base est indisponible", async () => {
		const deleteMany = jest.fn().mockRejectedValue(new Error("connection refused"));
		const service = new AccountRetentionService({ user: { deleteMany } } as any);

		await expect(service.purge()).resolves.toBe(0);
	});
});
