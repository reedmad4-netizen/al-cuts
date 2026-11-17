/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
  experimental: {
    serverComponentsExternalPackages: [
      "sql.js",
      "ws",
      "ffmpeg-static",
      "ffprobe-static",
    ],
    serverActions: {
      allowedOrigins: ["*.e2b.app", "localhost:3000", "127.0.0.1:3000", "0.0.0.0:3000"],
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Access-Control-Allow-Origin",
            value: "*",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
