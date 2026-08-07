import { checkDatabase } from "@/lib/database";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    checkDatabase();
    return Response.json(
      { status: "ok" },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }
}
