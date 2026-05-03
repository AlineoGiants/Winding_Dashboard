/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: ['10.13.24.123'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; connect-src 'self' http://localhost:3001 ws://localhost:3001 wss://localhost:3001 http://localhost:3000 ws://localhost:3000 wss://localhost:3000; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:;",
          },
        ],
      },
    ]
  },
}

export default nextConfig
