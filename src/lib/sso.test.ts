import { randomBytes } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, expect, test, vi } from "vitest";
import { challenge, parseSession, refreshSession, sameSecret, seal, ssoConfig, validateAccess, type SsoSession } from "./sso";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function configured() {
  vi.stubEnv("SSO_CLIENT_ID", "preview-client");
  vi.stubEnv("SSO_CLIENT_SECRET", "preview-secret");
  vi.stubEnv("SSO_REDIRECT_URI", "https://habits.example.com/auth/sso/callback");
  vi.stubEnv("APP_URL", "https://habits.example.com");
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SSO_SESSION_KEY", randomBytes(32).toString("hex"));
  return ssoConfig()!;
}

test("encrypted session cookie rejects tampering and expiry", () => {
  const config = configured();
  const session: SsoSession = { accessToken: "access", refreshToken: "refresh", expiresAt: Date.now() + 60000, subject: "user-id" };
  const value = seal(session, config.key);
  expect(parseSession(value)).toEqual(session);
  const bytes = Buffer.from(value, "base64url");
  bytes[bytes.length - 1] ^= 1;
  expect(parseSession(bytes.toString("base64url"))).toBeNull();
  expect(parseSession(seal({ ...session, expiresAt: Date.now() - 1 }, config.key))).toBeNull();
});

test("OAuth state uses exact comparison and PKCE S256", () => {
  expect(sameSecret("state", "state")).toBe(true);
  expect(sameSecret("state", "state2")).toBe(false);
  expect(challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("refresh rotates the token and validates the new access token", async () => {
  const config = configured();
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...await exportJWK(publicKey), kid: "refresh-test", alg: "ES256", use: "sig" };
  const accessToken = await new SignJWT({ client_id: config.id })
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid })
    .setIssuer(config.issuer)
    .setAudience("authenticated")
    .setSubject("user-id")
    .setExpirationTime("1h")
    .sign(privateKey);
  const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    if (String(input).endsWith("/.well-known/jwks.json")) return Response.json({ keys: [jwk] });
    expect(String(input)).toBe(`${config.issuer}/oauth/token`);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from(`${config.id}:${config.secret}`).toString("base64")}`,
    });
    const body = init?.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-refresh");
    return Response.json({ access_token: accessToken, refresh_token: "rotated-refresh", expires_in: 3600 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const now = Date.now();
  const refreshed = await refreshSession({ accessToken: "old-access", refreshToken: "old-refresh", expiresAt: now - 1, subject: "user-id" });
  expect(refreshed).toMatchObject({ accessToken, refreshToken: "rotated-refresh", subject: "user-id" });
  expect(refreshed.expiresAt).toBeGreaterThan(now + 3599000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await expect(validateAccess(accessToken, "another-user")).rejects.toThrow("Invalid SSO access token");
  const otherClientToken = await new SignJWT({ client_id: "other-client" })
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid })
    .setIssuer(config.issuer)
    .setAudience("authenticated")
    .setSubject("user-id")
    .setExpirationTime("1h")
    .sign(privateKey);
  await expect(validateAccess(otherClientToken, "user-id")).rejects.toThrow("Invalid SSO access token");
});
