import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const COOKIE_NAME = "and1_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const SCRYPT_KEY_LENGTH = 64;

function encode(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }
  return secret;
}

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return `scrypt.${encode(salt)}.${encode(hash)}`;
}

export function verifyPassword(password: string) {
  const storedHash = process.env.AUTH_PASSWORD_HASH;
  if (!storedHash) return false;

  const [algorithm, saltValue, expectedValue] = storedHash.split(".");
  if (algorithm !== "scrypt" || !saltValue || !expectedValue) return false;

  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(expectedValue, "base64url");
    const actual = scryptSync(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function isAuthConfigured() {
  return Boolean(
    process.env.AUTH_PASSWORD_HASH &&
      process.env.SESSION_SECRET &&
      process.env.SESSION_SECRET.length >= 32,
  );
}

export function createSessionCookie(request: Request) {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `v1.${expiresAt}`;
  const signature = createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  const secure =
    forwardedProtocol === "https" || new URL(request.url).protocol === "https:";

  return `${COOKIE_NAME}=${payload}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(request: Request) {
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  const secure =
    forwardedProtocol === "https" || new URL(request.url).protocol === "https:";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function isAuthenticated(request: Request) {
  if (!isAuthConfigured()) return false;

  const cookieHeader = request.headers.get("cookie") ?? "";
  const token = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);

  if (!token) return false;
  const [version, expiresValue, signature] = token.split(".");
  if (version !== "v1" || !expiresValue || !signature) return false;

  const expiresAt = Number(expiresValue);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

  const payload = `${version}.${expiresValue}`;
  const expected = createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");
  return safeEqual(signature, expected);
}

export function unauthorizedResponse() {
  return Response.json(
    { error: "unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}
