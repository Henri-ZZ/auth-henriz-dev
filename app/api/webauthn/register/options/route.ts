import { assertCsrf } from "@/lib/csrf";
import { json, publicError } from "@/lib/http";
import { requireRecentStepUp, requireSession } from "@/lib/session";
import { registrationOptions } from "@/lib/webauthn";
export const runtime = "nodejs";
export async function POST(request: Request) { try { const session = await requireSession(); assertCsrf(request, session.csrfTokenHash); requireRecentStepUp(session); return json(await registrationOptions(session.adminId)); } catch (error) { return publicError(error); } }

