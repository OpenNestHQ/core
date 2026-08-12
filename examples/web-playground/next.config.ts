import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@opennest/lang-core', '@opennest/vm'],
}

export default nextConfig
