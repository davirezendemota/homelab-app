import { errorJson, jsonResponse } from "@/lib/api-utils";
import { recordLifecycleFromRef } from "@/lib/container-start-history";
import { containerRemove, containerStart, containerStop, containerRestart } from "@/lib/docker";

export const runtime = "nodejs";

type Params = { params: Promise<{ ref: string; action?: string[] }> };

async function handleAction(ref: string, action: string): Promise<Response> {
  try {
    if (action === "start") {
      await containerStart(ref);
      await recordLifecycleFromRef(ref, "started");
    } else if (action === "stop") await containerStop(ref);
    else if (action === "restart") {
      await containerRestart(ref);
      await recordLifecycleFromRef(ref, "restarted");
    } else return errorJson("Not Found", 404);
    return jsonResponse({ ok: true });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    if (message.includes("inválida")) return errorJson(message, 400);
    return errorJson(message, 502);
  }
}

export async function POST(_request: Request, { params }: Params) {
  const { ref: rawRef, action } = await params;
  const ref = decodeURIComponent(rawRef);
  const act = action?.[0];
  if (!act) return errorJson("Not Found", 404);
  return handleAction(ref, act);
}

export async function DELETE(request: Request, { params }: Params) {
  const { ref: rawRef } = await params;
  const ref = decodeURIComponent(rawRef);
  const url = new URL(request.url);
  const forceParam = url.searchParams.get("force") ?? "true";
  const force = ["1", "true", "yes"].includes(forceParam.toLowerCase());
  try {
    await containerRemove(ref, force);
    return jsonResponse({ ok: true });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    if (message.includes("inválida")) return errorJson(message, 400);
    return errorJson(message, 502);
  }
}
