/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // The app serves its own media through /api/media, never through the
    // Next.js image optimizer. Keeping this disabled removes an entire
    // attack surface (see GHSA-2xp9-vwfh-vxw4 / GHSA-2464-fhr4-w9xw).
    unoptimized: true,
  },
  // Packages that must stay outside the bundler (WASM + native binaries).
  serverExternalPackages: ["sql.js", "ws", "ffmpeg-static", "ffprobe-static"],
  // Allow the sandbox preview hostname in development so live previews work.
  allowedDevOrigins: ["*.e2b.app", "localhost", "127.0.0.1", "0.0.0.0"],
  async headers() {
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
    ];

    if (process.env.NODE_ENV === "production") {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      });
    }

    return [
      { source: "/:path*", headers: securityHeaders },
      // API responses are same-origin only; never advertise a wildcard CORS grant.
      {
        source: "/api/:path*",
        headers: [{ key: "Vary", value: "Origin" }],
      },
    ];
  },
};

export default nextConfig;
