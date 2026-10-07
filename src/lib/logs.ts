import { PassThrough, Transform } from "stream";
import {
  containerHasTty,
  containersInStack,
  dockerOpenStream,
  openContainerLogsPath,
  validateContainerRef,
  validateStackName,
} from "./docker";

export async function openContainerLogStream(
  ref: string,
): Promise<NodeJS.ReadableStream> {
  validateContainerRef(ref);
  const path = await openContainerLogsPath(ref);
  const tty = await containerHasTty(ref);
  const { stream } = await dockerOpenStream(path);

  if (tty) {
    return stream;
  }

  return demuxDockerLogs(stream);
}

function linePrefixTransform(prefix: string): Transform {
  let pending = "";
  return new Transform({
    transform(chunk, _encoding, callback) {
      pending += chunk.toString("utf8");
      const parts = pending.split("\n");
      pending = parts.pop() ?? "";
      for (const line of parts) {
        this.push(`${prefix}${line}\n`);
      }
      callback();
    },
    flush(callback) {
      if (pending) this.push(`${prefix}${pending}`);
      callback();
    },
  });
}

export async function openStackLogStream(
  stack: string,
): Promise<NodeJS.ReadableStream> {
  validateStackName(stack);
  const containers = await containersInStack(stack);
  if (containers.length === 0) {
    throw new Error("Nenhum container nesta stack");
  }

  const out = new PassThrough();
  let pending = containers.length;

  const onStreamDone = () => {
    pending -= 1;
    if (pending === 0) out.end();
  };

  for (const c of containers) {
    void (async () => {
      let finished = false;
      const finish = (err?: unknown) => {
        if (finished) return;
        finished = true;
        if (err) {
          out.write(
            `[${c.name}] erro: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        }
        onStreamDone();
      };
      try {
        const raw = await openContainerLogStream(c.id);
        const prefixed = raw.pipe(linePrefixTransform(`[${c.name}] `));
        prefixed.on("data", (buf) => {
          out.write(buf);
        });
        prefixed.on("end", () => finish());
        prefixed.on("error", (err) => finish(err));
        raw.on("error", (err) => finish(err));
      } catch (err) {
        finish(err);
      }
    })();
  }

  return out;
}

function demuxDockerLogs(stream: NodeJS.ReadableStream): NodeJS.ReadableStream {
  const out = new PassThrough();

  stream.on("data", (chunk: Buffer) => {
    let offset = 0;
    while (offset + 8 <= chunk.length) {
      const size = chunk.readUInt32BE(offset + 4);
      offset += 8;
      if (size <= 0) continue;
      if (offset + size > chunk.length) break;
      out.write(chunk.subarray(offset, offset + size));
      offset += size;
    }
  });
  stream.on("end", () => out.end());
  stream.on("error", (err) => out.destroy(err));

  return out;
}
