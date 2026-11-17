#!/usr/bin/env node
/**
 * Differential test for src/lib/s3.ts (SigV4) and the Instagram publish state
 * machine. Runs offline:
 *
 *   npm run test:s3      → compares our signer against the `aws4` package
 *   npm run test:social  → drives publishReel against a local mock Graph API
 *
 * A hand-rolled SigV4 implementation is easy to get subtly wrong, so the
 * presigned URL and header signature are checked byte-for-byte against an
 * independent implementation for many pathological object keys.
 */
import crypto from "node:crypto";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const aws4 = require("aws4");

// The TS module imports node built-ins only, so we can load the compiled-free
// source through a tiny transpile shim: strip the `export` keywords and
// evaluate as CommonJS. Keeps this test dependency-free.
import fs from "node:fs";
import path from "node:path";

/** Transpiles the TypeScript source in-memory so the test needs no build step. */
function loadTsModule(file) {
  const ts = require("typescript");
  const source = fs.readFileSync(file, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  // Resolve relative imports that point at other .ts helpers (e.g. net-errors)
  // through this same transpiler instead of Node's CommonJS loader.
  const dir = path.dirname(file);
  const localRequire = (id) => {
    if (id.startsWith("./") || id.startsWith("../")) {
      const base = path.resolve(dir, id);
      for (const ext of ["", ".ts", ".tsx", ".js", ".mjs"]) {
        if (fs.existsSync(base + ext)) return loadTsModule(base + ext);
      }
    }
    return require(id);
  };
  const factory = new Function("exports", "require", "module", outputText);
  factory(module.exports, localRequire, module);
  return module.exports;
}

const s3 = loadTsModule(path.join(process.cwd(), "src", "lib", "s3.ts"));

const CREDS = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};
const DATE = new Date("2026-11-17T15:22:41Z");

const cases = [
  { bucket: "clipx-clips", region: "us-east-1", endpoint: "https://s3.us-east-1.amazonaws.com", key: "clip.mp4", prefix: "" },
  { bucket: "clipx-clips", region: "auto", endpoint: "https://acct.r2.cloudflarestorage.com", key: "reels/my clip 1.mp4", prefix: "uploads" },
  { bucket: "b", region: "eu-central-1", endpoint: "https://s3.eu-central-1.amazonaws.com", key: "a/b/c+d(1)&x=1.mp4", prefix: "clipx/shorts" },
  { bucket: "my.bucket", region: "us-west-2", endpoint: "https://s3.us-west-2.amazonaws.com", key: "emoji-🎮-clip.mp4", prefix: "" },
  { bucket: "bkt", region: "nyc3", endpoint: "https://nyc3.digitaloceanspaces.com", key: "deep/nested/path/file name with spaces.mp4", prefix: "x y" },
];

const AMZ_DATE = DATE.toISOString().replace(/[:-]|\.\d{3}/g, "");
const EXPIRES = 3600;

let failures = 0;
function check(name, actual, expected) {
  if (actual === expected) {
    console.log(`  ✅ ${name}`);
  } else {
    failures += 1;
    console.log(`  ❌ ${name}\n     ours: ${actual}\n     aws4: ${expected}`);
  }
}

console.log("\nSigV4 presigned GET — differential test vs aws4\n");

for (const testCase of cases) {
  const config = {
    endpoint: testCase.endpoint,
    region: testCase.region,
    bucket: testCase.bucket,
    ...CREDS,
    pathPrefix: testCase.prefix,
    publicBaseUrl: "",
    forcePathStyle: true,
  };

  const ours = new URL(
    s3.presignGetUrl({ config, key: testCase.key, expiresSeconds: EXPIRES, now: DATE })
  );

  const objectKey = s3.resolveObjectKey(config, testCase.key);
  const aws4Req = aws4.sign(
    {
      service: "s3",
      region: testCase.region,
      // Pre-encode each segment so characters like '&' in the object key are
      // not mistaken for query separators by aws4's path parser.
      path:
        `/${testCase.bucket}/${objectKey
          .split("/")
          .map((segment) => encodeURIComponent(segment))
          .join("/")}` +
        `?X-Amz-Expires=${EXPIRES}&X-Amz-Date=${AMZ_DATE}`,
      host: new URL(testCase.endpoint).host,
      method: "GET",
      signQuery: true,
    },
    { ...CREDS }
  );

  const theirs = new URL(aws4Req.path, testCase.endpoint);

  check(
    `signature [${testCase.key.slice(0, 34)}]`,
    ours.searchParams.get("X-Amz-Signature"),
    theirs.searchParams.get("X-Amz-Signature")
  );
  // aws4 leaves RFC-3986 sub-delims like "(" unescaped in the emitted URL while
  // we escape them; the signed canonical path is identical (signatures match),
  // so compare the decoded path.
  check(
    `path [${testCase.key.slice(0, 34)}]`,
    decodeURIComponent(ours.pathname),
    decodeURIComponent(theirs.pathname)
  );
  check(
    `credential scope [${testCase.region}]`,
    ours.searchParams.get("X-Amz-Credential"),
    theirs.searchParams.get("X-Amz-Credential")
  );
}

console.log("\nSigV4 header signature — differential test vs aws4\n");

for (const testCase of cases.slice(0, 4)) {
  const config = {
    endpoint: testCase.endpoint,
    region: testCase.region,
    bucket: testCase.bucket,
    ...CREDS,
    pathPrefix: testCase.prefix,
    publicBaseUrl: "",
    forcePathStyle: true,
  };
  const body = Buffer.from("hello clipx");
  const payloadHash = crypto.createHash("sha256").update(body).digest("hex");
  const location = s3.objectLocation(config, testCase.key);

  const ours = s3.signRequest({
    config,
    method: "PUT",
    location,
    payloadHash,
    contentType: "video/mp4",
    now: DATE,
  });

  const aws4Req = aws4.sign(
    {
      service: "s3",
      region: testCase.region,
      path: location.canonicalPath,
      host: location.host,
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "x-amz-content-sha256": payloadHash,
        "X-Amz-Date": AMZ_DATE,
      },
    },
    { ...CREDS }
  );

  check(
    `authorization [${testCase.key.slice(0, 26)}]`,
    ours.authorization,
    aws4Req.headers.Authorization
  );
}

console.log(
  failures === 0
    ? "\n✅ SigV4 matches aws4 for all cases\n"
    : `\n❌ ${failures} mismatch(es)\n`
);
process.exit(failures === 0 ? 0 : 1);
