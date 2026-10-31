import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { cookies } from "next/headers";

export type SsoSession = { accessToken: string; refreshToken: string; expiresAt: number; subject: string };
export type SsoTransaction = { state: string; nonce: string; verifier: string; createdAt: number };

const issuerPath = "/auth/v1";
export const sessionCookie = process.env.NODE_ENV === "production" ? "__Host-tl-oauth" : "tl-oauth";
export const transactionCookie = process.env.NODE_ENV === "production" ? "__Host-tl-sso-tx" : "tl-sso-tx";

export function ssoConfig() {
  const id = process.env.SSO_CLIENT_ID;
  const secret = process.env.SSO_CLIENT_SECRET;
  const redirect = process.env.SSO_REDIRECT_URI;
  const supabase = process.env.SUPABASE_URL;
  const app = process.env.APP_URL;
  const key = process.env.SSO_SESSION_KEY;
  if (!id || !secret || !redirect || !supabase || !app || !key || !/^[0-9a-f]{64}$/i.test(key)) return null;
  try {
    const callback = new URL(redirect);
    const origin = new URL(app);
    const provider = new URL(supabase);
    if (callback.origin !== origin.origin || callback.pathname !== "/auth/sso/callback" || callback.search || callback.hash || callback.username || callback.password) return null;
    if (process.env.NODE_ENV === "production" && (callback.protocol !== "https:" || provider.protocol !== "https:")) return null;
    if (origin.href !== origin.origin + "/" || provider.href !== provider.origin + "/") return null;
    return { id, secret, redirect: callback.href, provider: provider.origin, issuer: `${provider.origin}${issuerPath}`, key: Buffer.from(key, "hex") };
  } catch { return null; }
}

export function seal(data: SsoSession | SsoTransaction, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function unseal<T>(value: string | undefined, key: Buffer): T | null {
  if (!value || value.length > 8192) return null;
  try {
    const raw = Buffer.from(value, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as T;
  } catch { return null; }
}

export function sameSecret(left: string, right: string) {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function challenge(verifier: string) { return createHash("sha256").update(verifier).digest("base64url"); }

export async function validateAccess(token: string, subject?: string) {
  const config = ssoConfig();
  if (!config) throw Error("SSO is not configured");
  const jwks = createRemoteJWKSet(new URL(`${config.issuer}/.well-known/jwks.json`));
  const { payload } = await jwtVerify(token, jwks, { issuer: config.issuer, audience: "authenticated", algorithms: ["ES256", "RS256"] });
  if (payload.client_id !== config.id || !payload.sub || (subject && payload.sub !== subject)) throw Error("Invalid SSO access token");
  return payload.sub;
}

export async function validateId(token: string, nonce: string, subject: string) {
  const config = ssoConfig();
  if (!config) throw Error("SSO is not configured");
  const jwks = createRemoteJWKSet(new URL(`${config.issuer}/.well-known/jwks.json`));
  const { payload } = await jwtVerify(token, jwks, { issuer: config.issuer, audience: config.id, algorithms: ["ES256", "RS256"] });
  if (payload.nonce !== nonce || payload.sub !== subject) throw Error("Invalid SSO ID token");
}

type TokenResponse = { access_token?: unknown; refresh_token?: unknown; id_token?: unknown; expires_in?: unknown };
export async function exchangeToken(grant: "authorization_code" | "refresh_token", value: string, verifier?: string) {
  const config = ssoConfig();
  if (!config) throw Error("SSO is not configured");
  const body = new URLSearchParams({ grant_type: grant });
  if (grant === "authorization_code") {
    body.set("code", value); body.set("code_verifier", verifier ?? ""); body.set("redirect_uri", config.redirect);
  } else body.set("refresh_token", value);
  const response = await fetch(`${config.issuer}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${config.id}:${config.secret}`).toString("base64")}` }, body, cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error("SSO token exchange failed");
  const tokens = await response.json() as TokenResponse;
  if (typeof tokens.access_token !== "string" || !tokens.access_token || typeof tokens.expires_in !== "number" || tokens.expires_in <= 0) throw Error("Invalid SSO token response");
  if (tokens.refresh_token !== undefined && typeof tokens.refresh_token !== "string") throw Error("Invalid SSO refresh token");
  return tokens as { access_token: string; refresh_token?: string; id_token?: string; expires_in: number };
}

export function cookieOptions(maxAge: number) { return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge }; }

export function parseSession(value: string | undefined, allowExpired = false): SsoSession | null {
  const config = ssoConfig();
  if (!config) return null;
  const session = unseal<SsoSession>(value, config.key);
  return session && typeof session.accessToken === "string" && typeof session.refreshToken === "string" && typeof session.subject === "string" && typeof session.expiresAt === "number" && (allowExpired || session.expiresAt > Date.now()) ? session : null;
}

export async function browserSsoSession() {
  const store = await cookies();
  return parseSession(store.get(sessionCookie)?.value);
}

export async function refreshSession(session: SsoSession) {
  const tokens = await exchangeToken("refresh_token", session.refreshToken);
  await validateAccess(tokens.access_token, session.subject);
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? session.refreshToken, expiresAt: Date.now() + tokens.expires_in * 1000, subject: session.subject } satisfies SsoSession;
}
