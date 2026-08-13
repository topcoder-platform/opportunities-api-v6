/** Minimal Express application seam needed to configure trusted proxy hops. */
export interface TrustProxyConfigurableApplication {
  set(setting: "trust proxy", value: number): unknown;
}

/**
 * Configures Express to derive the client address through a fixed number of
 * trusted reverse-proxy hops.
 *
 * This setting is consumed by Nest's throttler through `request.ip`. The
 * deployment must restrict direct origin access and ensure the trusted edge
 * replaces or safely appends forwarding headers; otherwise clients could
 * forge their apparent address.
 *
 * @param application Nest Express application to configure before listening.
 * @param trustedProxyHops Positive number of proxy hops between the client and
 * this process.
 * @returns Nothing after applying the Express setting.
 * @throws Propagates an adapter error if Express rejects the setting.
 */
export function configureTrustProxy(
  application: TrustProxyConfigurableApplication,
  trustedProxyHops: number,
): void {
  application.set("trust proxy", trustedProxyHops);
}
