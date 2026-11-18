/**
 * The public origin the browser used, as seen through a reverse proxy.
 *
 * `new URL(req.url).origin` is wrong behind an ingress (Arena previews, Render,
 * Fly, nginx…): it reports the internal host, which then ends up in an OAuth
 * redirect_uri that Meta rejects. Prefer the forwarded headers the proxy sets.
 */
export function resolveRequestOrigin(req: Request): string {
  const headers = req.headers;
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = headers.get("x-forwarded-proto")

    ?.split(",")[0]
    ?.trim();
  const host = forwardedHost || headers.get("host") || "";

  if (host) {
    const proto =
      forwardedProto ||
      (host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https");
    return `${proto}://${host}`;
  }

  return new URL(req.url).origin;
}
