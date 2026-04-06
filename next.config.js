/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build optimization
  swcMinify: true,
  productionBrowserSourceMaps: false,
  compress: true,
  
  // Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600, must-revalidate',
          },
        ],
      },
    ];
  },

  // Vercel-specific optimizations
  images: {
    unoptimized: true, // Disable Image Optimization API
  },

  // Webpack optimizations to reduce deprecation warnings
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push('pino-pretty');
    }
    return config;
  },
};

module.exports = nextConfig;

