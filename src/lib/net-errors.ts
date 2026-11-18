/**
 * Node's fetch throws a bare "fetch failed" for every transport problem. Wrap
 * it with the underlying cause and the host involved so users can actually fix
 * their configuration (wrong endpoint, TLS interception, DNS, refused port…).
 */
export function describeNetworkError(
  err: unknown,
  context: { action: string; url?: string }
): string {
  const base = err instanceof Error ? err.message : String(err);
  const cause = (err as { cause?: unknown })?.cause;
  const causeMessage =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
      ? cause
      : "";
  const code = (cause as { code?: string } | undefined)?.code;

  const host = (() => {
    try {
      return context.url ? new URL(context.url).host : "";
    } catch {
      return "";
    }
  })();

  if (!/fetch failed|network|socket/i.test(base) && !causeMessage) return base;

  const target = host ? ` to ${host}` : "";
  const detail = [causeMessage, code].filter(Boolean).join(" · ");

  let hint = "";
  if (code === "ECONNREFUSED") {
    hint =
      " Connection refused — is the endpoint URL correct and reachable from the server?";
  } else if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    hint = " Host could not be resolved — check the endpoint/bucket URL.";
  } else if (
    code === "CERT_HAS_EXPIRED" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT"
  ) {
    hint =
      " TLS certificate verification failed (often a corporate proxy or sandbox interception). Use a trusted certificate or set NODE_EXTRA_CA_CERTS.";
  } else if (code === "ETIMEDOUT" || /timeout/i.test(base + causeMessage)) {
    hint = " The request timed out — check connectivity and firewall rules.";
  }

  return `${context.action}${target} failed${detail ? `: ${detail}` : ""}.${hint}`;
}
