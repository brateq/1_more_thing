import { isAuthConfigured, isAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return Response.json(
    {
      authenticated: isAuthenticated(request),
      configured: isAuthConfigured(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
