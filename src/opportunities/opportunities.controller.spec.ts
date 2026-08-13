import { OpportunitiesController } from "./opportunities.controller";
import { OpportunitiesSummaryService } from "./opportunities-summary.service";

describe("OpportunitiesController", () => {
  it("wraps the summary in the standard v6 response contract", async () => {
    const content = {
      cells: {
        competitions: { amount: 38500, count: 12 },
        engagements: { count: 8 },
        copilots: { count: 2 },
        reviews: { count: 3 },
      },
      generatedAt: "2026-08-13T01:23:45.678Z",
    };
    const summaryService = {
      getSummary: jest.fn().mockResolvedValue(content),
    } as unknown as OpportunitiesSummaryService;

    await expect(
      new OpportunitiesController(summaryService).getSummary(),
    ).resolves.toEqual({
      result: {
        success: true,
        status: 200,
        content,
      },
    });
  });
});
