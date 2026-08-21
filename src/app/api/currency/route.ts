import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { getUserCurrency, setUserCurrency } from "@/lib/db/repositories/profile";
import { SUPPORTED_CURRENCIES } from "@/lib/currency/rates";

const bodySchema = z.object({ currency: z.enum(SUPPORTED_CURRENCIES) });

// GET/PUT /api/currency — the authenticated user's display-currency
// preference. Guests never call this (see lib/currency/context.tsx —
// localStorage only, section 5's "guests may use localStorage").
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    return NextResponse.json({ currency: await getUserCurrency(userId) });
  } catch (err) {
    console.error("[GET /api/currency] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  try {
    await setUserCurrency(userId, parsed.data.currency);
    return NextResponse.json({ currency: parsed.data.currency });
  } catch (err) {
    console.error("[PUT /api/currency] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
