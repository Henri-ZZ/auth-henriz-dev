import { authenticationOptions } from "@/lib/webauthn";
import { getSession } from "@/lib/session";
import { json, publicError } from "@/lib/http";
export const runtime = "nodejs";
export async function POST() { try { const session = await getSession(); return json(await authenticationOptions(session?.adminId, Boolean(session))); } catch (error) { return publicError(error); } }

