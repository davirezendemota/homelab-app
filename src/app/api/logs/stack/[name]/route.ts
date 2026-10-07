import { openStackLogStream } from "@/lib/logs";

export const runtime = "nodejs";

type Params = { params: Promise<{ name: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { name: raw } = await params;
  const stack = decodeURIComponent(raw);
  try {
    const stream = await openStackLogStream(stack);
    return new Response(stream as unknown as BodyInit, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    const status = message.includes("inválid") ? 400 : 502;
    return new Response(message, {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
