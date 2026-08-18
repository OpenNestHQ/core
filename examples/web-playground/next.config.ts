import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@opennest/sdk', '@opennest/lang-core', '@opennest/vm'],
}

export default nextConfig
