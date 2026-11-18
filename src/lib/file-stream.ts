import fs from "node:fs";

/**
 * Streams a file as a web ReadableStream without ever throwing on disconnect.
 *
 * `Readable.toWeb()` re-throws when the consumer cancels mid-flight ("Controller
 * is already closed") and Node surfaces that as an uncaughtException, which can
 * take the whole server down when a client aborts a video download. Guarding
 * every controller call keeps a dropped connection a non-event.
 */
export function fileStream(
  filePath: string,
  options: { start?: number; end?: number } = {}
): ReadableStream<Uint8Array> {
  const nodeStream = fs.createReadStream(filePath, {
    start: options.start,
    end: options.end,
  });

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* consumer already went away */
        }
      };

      nodeStream.on("data", (chunk) => {
        if (closed) return;
        try {
          controller.enqueue(new Uint8Array(chunk as Buffer));
        } catch {
          closed = true;
          nodeStream.destroy();
        }
      });
      nodeStream.on("end", safeClose);
      nodeStream.on("error", (err) => {
        if (closed) return;
        closed = true;
        try {
          controller.error(err);
        } catch {
          /* already closed by the consumer */
        }
      });
      nodeStream.on("close", safeClose);
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}
