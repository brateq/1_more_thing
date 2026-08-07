import {
  createSessionCookie,
  isAuthConfigured,
  verifyPassword,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

const attempts = new Map<string, { count: number; resetAt: number }>();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function requestKey(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export async function POST(request: Request) {
  if (!isAuthConfigured()) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }

  const key = requestKey(request);
  const now = Date.now();
  const current = attempts.get(key);
  if (current && current.resetAt > now && current.count >= MAX_ATTEMPTS) {
    return Response.json(
      { error: "too_many_attempts" },
      { status: 429, headers: { "Retry-After": "900" } },
    );
  }

  let password = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    password =
      typeof body.password === "string" && body.password.length <= 512
        ? body.password
        : "";
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  if (!verifyPassword(password)) {
    const previous = current && current.resetAt > now ? current.count : 0;
    attempts.set(key, { count: previous + 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return Response.json({ error: "invalid_credentials" }, { status: 401 });
  }

  attempts.delete(key);
  return Response.json(
    { authenticated: true },
    { headers: { "Set-Cookie": createSessionCookie(request) } },
  );
}
