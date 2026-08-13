import { HealthController } from "./health.controller";

describe("HealthController", () => {
  it("returns a stable healthy response", () => {
    expect(new HealthController().getHealth()).toEqual({ status: "ok" });
  });
});
