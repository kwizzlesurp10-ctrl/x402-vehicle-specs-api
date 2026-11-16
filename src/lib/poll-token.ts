import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function generatePollToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPollToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function pollTokensMatch(storedHash: string, providedToken: string): boolean {
  const providedHash = hashPollToken(providedToken);
  if (storedHash.length !== providedHash.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(storedHash, "utf8"),
      Buffer.from(providedHash, "utf8"),
    );
  } catch {
    return false;
  }
}