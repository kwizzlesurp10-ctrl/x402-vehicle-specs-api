const PRODUCTION_FALLBACK_ORIGIN =
  "https://x402-vehicle-specs-api.vercel.app";

export function normalizeApiBasePath(basePath: string): string {
  if (!basePath || basePath === "/") return "";
  const trimmed = basePath.replace(/\/$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function resolvePublicBaseUrl(options: {
  requestUrl?: string;
  apiBasePath: string;
  publicBaseUrl?: string;
}): string {
  const pathSuffix = normalizeApiBasePath(options.apiBasePath);
  if (options.publicBaseUrl) {
    return options.publicBaseUrl.replace(/\/$/, "");
  }
  if (options.requestUrl) {
    const origin = new URL(options.requestUrl).origin;
    return `${origin}${pathSuffix}`;
  }
  return `${PRODUCTION_FALLBACK_ORIGIN}${pathSuffix}`;
}