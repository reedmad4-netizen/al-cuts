// Node.js 18–26+ cross-version compatibility shim (Windows, macOS, Linux)
import buffer from "node:buffer";
import { syncBuiltinESMExports } from "node:module";

// 1. Node 25/26 removed legacy buffer.SlowBuffer, which some bundled CJS dependencies reference
if (typeof buffer.SlowBuffer === "undefined") {
  buffer.SlowBuffer = buffer.Buffer;
  try {
    syncBuiltinESMExports();
  } catch {
    // ignore
  }
}

// 2. Node 25/26 exposes a lazy globalThis.localStorage getter when --localstorage-file
//    is not set; neutralize it without triggering experimental warnings so SSR stays clean.
try {
  const desc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  if (desc && (typeof desc.get === "function" || typeof desc.value?.getItem !== "function")) {
    Object.defineProperty(globalThis, "localStorage", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  }
} catch {
  // ignore
}
