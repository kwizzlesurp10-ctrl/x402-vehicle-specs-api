import { normalizeApiBasePath } from "./lib/public-base-url.js";

export function normalizeVercelRequestPath(
  pathname: string,
  apiPrefix = "/api",
): string {
  const prefix = normalizeApiBasePath(apiPrefix) || "/api";
  if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
    if (pathname === `${prefix}/`) return prefix;
    return pathname;
  }
  if (pathname === "/" || pathname === "") return prefix;
  const suffix = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${prefix}${suffix}`;
}

export function rewriteRequestForApiMount(
  request: Request,
  apiPrefix = "/api",
): Request {
  const url = new URL(request.url);
  const normalized = normalizeVercelRequestPath(url.pathname, apiPrefix);
  if (normalized === url.pathname) return request;
  url.pathname = normalized;
  return new Request(url, request);
}