import { configureTrustProxy } from "./trust-proxy.config";

describe("configureTrustProxy", () => {
  it("applies the validated hop count to the Express adapter", () => {
    const set = jest.fn();

    configureTrustProxy({ set }, 2);

    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith("trust proxy", 2);
  });
});
