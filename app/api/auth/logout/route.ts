import { clearSessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return Response.json(
    { authenticated: false },
    { headers: { "Set-Cookie": clearSessionCookie(request) } },
  );
}
