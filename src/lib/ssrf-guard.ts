import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const BLOCKED_IPV4_RANGES: Array<{ base: number; mask: number }> = [
  { base: ipv4ToInt("0.0.0.0"), mask: 8 },
  { base: ipv4ToInt("10.0.0.0"), mask: 8 },
  { base: ipv4ToInt("127.0.0.0"), mask: 8 },
  { base: ipv4ToInt("169.254.0.0"), mask: 16 },
  { base: ipv4ToInt("172.16.0.0"), mask: 12 },
  { base: ipv4ToInt("192.168.0.0"), mask: 16 },
  { base: ipv4ToInt("100.64.0.0"), mask: 10 },
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return 0;
  const [a, b, c, d] = parts;
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    return 0;
  }
  return (
    ((a << 24) >>> 0) +
    ((b << 16) >>> 0) +
    ((c << 8) >>> 0) +
    (d >>> 0)
  );
}

function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return BLOCKED_IPV4_RANGES.some(({ base, mask }) => (value & mask) === base);
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:0:")
  ) {
    return true;
  }
  return false;
}

function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedIpv4(ip);
  if (kind === 6) return isBlockedIpv6(ip);
  return true;
}

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

export async function assertPublicHttpsWebhookUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError("invalid_webhook_url");
  }

  if (parsed.protocol !== "https:") {
    throw new SsrfBlockedError("webhook_must_use_https");
  }

  if (parsed.username || parsed.password) {
    throw new SsrfBlockedError("webhook_userinfo_not_allowed");
  }

  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new SsrfBlockedError("webhook_host_blocked");
  }

  if (isBlockedIp(host)) {
    throw new SsrfBlockedError("webhook_host_blocked");
  }

  const resolved = await lookup(host, { all: true, verbatim: true });
  for (const entry of resolved) {
    if (isBlockedIp(entry.address)) {
      throw new SsrfBlockedError("webhook_resolves_to_private_ip");
    }
  }

  return parsed;
}

export const WEBHOOK_MAX_RESPONSE_BYTES = 256 * 1024;
export const WEBHOOK_FETCH_TIMEOUT_MS = 5_000;

export async function fetchWebhookSafely(
  url: string,
  init: RequestInit & { body?: string },
): Promise<void> {
  await assertPublicHttpsWebhookUrl(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      throw new SsrfBlockedError("webhook_redirect_not_allowed");
    }

    const reader = response.body?.getReader();
    if (!reader) return;

    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > WEBHOOK_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new SsrfBlockedError("webhook_response_too_large");
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}