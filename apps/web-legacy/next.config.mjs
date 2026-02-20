/** @type {import('next').NextConfig} */
import path from 'path';

const nextConfig = {
    output: "standalone",
    transpilePackages: [
        '@reown/appkit',
        '@reown/appkit-adapter-wagmi',
        'wagmi',
        '@tanstack/react-query',
        'viem',
        '@walletconnect/ethereum-provider'
    ],
    webpack: (config, { isServer }) => {
        config.externals.push('pino-pretty', 'lokijs', 'encoding');

        // Fallback for resolving walletconnect provider
        try {
            const walletConnectPath = path.dirname(require.resolve('@walletconnect/ethereum-provider/package.json'));
            config.resolve.alias['@walletconnect/ethereum-provider'] = path.join(walletConnectPath, 'dist/index.cjs.js');
        } catch (e) {
            // console.warn("Could not resolve @walletconnect/ethereum-provider");
        }

        return config;
    },
    // Acknowledge custom webpack config for Turbopack
    turbopack: {},
    // Disable the annoying dev indicator in bottom-right
    devIndicators: false,
    async rewrites() {
        return [
            {
                source: '/hls/:id/manifest.json',
                destination: '/api/hls/:id/manifest.json'
            },
            {
                source: '/hls/:path*',
                destination: '/api/hls/:path*'
            },
            {
                source: '/whip/:path*',
                // Use 127.0.0.1 for local dev (host resolving docker port)
                // In prod, this should be env var, but 127.0.0.1 works via host networking or mapped ports usually if not careful
                // Better: Use specific hostname, but for now fix local crash.
                destination: 'http://127.0.0.1:8889/:path*/whip',
            },
        ];
    },
    async headers() {
        return [
            {
                source: '/:path*',
                headers: [
                    {
                        key: 'X-DNS-Prefetch-Control',
                        value: 'on'
                    },
                    {
                        key: 'Strict-Transport-Security',
                        value: 'max-age=63072000; includeSubDomains; preload'
                    },
                    {
                        key: 'X-Frame-Options',
                        value: 'SAMEORIGIN' // Allow same origin for iframes? Or DENY. Let's start with SAMEORIGIN to allow internal embedding.
                    },
                    {
                        key: 'X-Content-Type-Options',
                        value: 'nosniff'
                    },
                    {
                        key: 'Referrer-Policy',
                        value: 'strict-origin-when-cross-origin'
                    }
                ]
            }
        ];
    }
};

export default nextConfig;
