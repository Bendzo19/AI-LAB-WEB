import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Discord CDN avatars
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'cdn.discordapp.com' }],
  },
};

export default nextConfig;
