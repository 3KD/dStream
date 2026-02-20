const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const httpProxy = require('http-proxy');

// Configuration
const HTTP_PORT = 5655; // Next.js port (changed from 3000 to avoid conflicts)
const HTTPS_PORT = 5656; // Secure access port

// Global error handling to prevent crash
process.on('uncaughtException', (err) => {
    console.error('[Proxy] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Proxy] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Create proxy server for Next.js
const proxy = httpProxy.createProxyServer({
    target: `http://127.0.0.1:${HTTP_PORT}`,
    ws: true // Proxy WebSockets
});

// Create specialized proxy for WHIP (MediaMTX) to handle error suppression
const whipProxy = httpProxy.createProxyServer({
    target: `http://127.0.0.1:8889`,
    changeOrigin: true,
    selfHandleResponse: true // We need to intercept the response body to fix the 500 error
});

// Error handling to prevent crash on connection reset
const handleProxyError = (err, req, res) => {
    console.error('Proxy Error:', err);
    if (res && res.writeHead && !res.headersSent) {
        try {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end('Bad Gateway: Upstream server is down.');
        } catch (e) {
            console.error('[Proxy] Failed to send error response:', e);
        }
    }
};

proxy.on('error', handleProxyError);
whipProxy.on('error', handleProxyError);

// Standard Proxy Response (Next.js)
// REMOVED Cross-Origin-Embedder-Policy as it was blocking camera access!
proxy.on('proxyRes', (proxyRes, req, res) => {
    res.setHeader('Permissions-Policy', 'camera=*, microphone=*, display-capture=*');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    // NOTE: Cross-Origin-Embedder-Policy: require-corp was removed - it blocks getUserMedia
});

// WHIP Proxy Response (Intercepts 500 Errors)
whipProxy.on('proxyRes', (proxyRes, req, res) => {
    // Add CORS/Security headers
    res.setHeader('Permissions-Policy', 'camera=*, microphone=*, display-capture=*');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    // NOTE: Cross-Origin-Embedder-Policy: require-corp was removed - it blocks getUserMedia

    // Pass specific headers from upstream
    if (proxyRes.headers['location']) res.setHeader('Location', proxyRes.headers['location']);
    if (proxyRes.headers['content-type']) res.setHeader('Content-Type', proxyRes.headers['content-type']);
    if (proxyRes.headers['etag']) res.setHeader('ETag', proxyRes.headers['etag']);

    let body = [];
    proxyRes.on('data', chunk => body.push(chunk));
    proxyRes.on('end', () => {
        const bodyBuffer = Buffer.concat(body);

        // INTERCEPTION LOGIC: Check for the specific ParseAddr error
        if (proxyRes.statusCode === 500) {
            const bodyStr = bodyBuffer.toString();
            // Match the specific IPv6 parsing error from MediaMTX/Go's net library
            // Error: "ParseAddr(\"[fc00:...\"): each colon-separated field must have at least one digit"
            if (bodyStr.includes('ParseAddr') && bodyStr.includes('each colon-separated field must have at least one digit')) {
                // Suppress the error
                // console.log(`[Proxy] Suppressed known IPv6 ParseAddr error for ${req.url}`);
                res.writeHead(200); // OK
                res.end(); // Empty body
                return;
            }

            // Log other actual 500 errors
            console.error(`[Proxy] WebRTC Upstream 500 Error: ${bodyStr}`);
        }

        // Default: Write original status and body
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        res.end(bodyBuffer);
    });
});

// Load certificates
let httpsOptions = {};
try {
    httpsOptions = {
        key: fs.readFileSync(path.join(__dirname, '..', 'certs', 'localhost+2-key.pem')),
        cert: fs.readFileSync(path.join(__dirname, '..', 'certs', 'localhost+2.pem')),
    };
} catch (e) {
    console.error('[Proxy] Certificate load error:', e);
    // Proceed without certs might fail for https but let it run to show error
}

// Create HTTPS server
const server = https.createServer(httpsOptions, (req, res) => {
    try {
        if (req.url.startsWith('/hls')) {
            // Forward HLS requests to Next.js API to avoid MediaMTX auth and handle 404s
            req.url = req.url.replace(/^\/hls/, '/api/hls');
            try {
                proxy.web(req, res, { target: `http://127.0.0.1:${HTTP_PORT}` }, (e) => {
                    console.error('[Proxy] HTTPS Forward Error:', e);
                });
            } catch (e) {
                console.error('[Proxy] HTTPS forwarding sync error:', e);
            }
        } else if (req.url.startsWith('/whip')) {
            // 1. Initial WHIP Request: /whip/streamKey
            // Forward WHIP requests to MediaMTX (8889)
            // Rewrite /whip/streamKey?query -> /streamKey/whip?query
            const originalUrl = req.url;
            const urlObj = new URL(req.url, `http://${req.headers.host}`);
            const pathPart = urlObj.pathname.replace(/^\/whip/, ''); // /streamKey
            const queryPart = urlObj.search; // ?query
            req.url = pathPart + '/whip' + queryPart;
            console.log(`[Proxy] WHIP Init Rewrite: ${originalUrl} -> ${req.url}`);
            try {
                // Use whipProxy for MediaMTX requests
                whipProxy.web(req, res, (e) => {
                    console.error('[Proxy] WHIP Init Forward Error:', e);
                });
            } catch (e) {
                console.error('[Proxy] WHIP Init forwarding sync error:', e);
            }
        } else if (/\/[^\/]+\/whip(\/.*)?/.test(req.url)) {
            // 2. WHIP Resource Request: /streamKey/whip/uuid (PATCH/DELETE)
            try {
                whipProxy.web(req, res, (e) => {
                    console.error('[Proxy] WHIP Resource Forward Error:', e);
                });
            } catch (e) {
                console.error('[Proxy] WHIP Resource forwarding sync error:', e);
            }
        } else {
            proxy.web(req, res);
        }
    } catch (e) {
        console.error('[Proxy] HTTPS Request Loop Error:', e);
    }
});

server.on('secureConnection', (socket) => {
    // console.log(`[Proxy] New secure connection`);
});

server.on('tlsClientError', (err, socket) => {
    console.error(`[Proxy] TLS Error from ${socket.remoteAddress}: ${err.message}`);
});

server.on('error', (err) => {
    console.error('[Proxy] HTTPS Server Error:', err);
});

// Handle WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
    try {
        proxy.ws(req, socket, head);
    } catch (e) {
        console.error('[Proxy] WebSocket Upgrade Error:', e);
    }
});

// --- HTTP Server (For Mobile/LAN without SSL issues) ---
const HTTP_PROXY_PORT = 5657;
const httpServer = http.createServer((req, res) => {
    try {
        if (req.url.startsWith('/hls')) {
            // Consistency: Redirect HTTP HLS requests to Next.js API as well
            req.url = req.url.replace(/^\/hls/, '/api/hls');
            try {
                proxy.web(req, res, { target: `http://127.0.0.1:${HTTP_PORT}` }, (e) => {
                    console.error('[Proxy] HTTP Forward Error:', e);
                });
            } catch (e) {
                console.error('[Proxy] HTTP forwarding sync error:', e);
            }
        } else {
            proxy.web(req, res);
        }
    } catch (e) {
        console.error('[Proxy] HTTP Request Loop Error:', e);
    }
});

httpServer.on('upgrade', (req, socket, head) => {
    try {
        proxy.ws(req, socket, head);
    } catch (e) {
        console.error('[Proxy] HTTP WebSocket Upgrade Error:', e);
    }
});

// Force IPv4 binding
httpServer.listen(HTTP_PROXY_PORT, '0.0.0.0', () => {
    console.log(`> HTTP  Proxy running on http://0.0.0.0:${HTTP_PROXY_PORT} (Use for Mobile)`);
});

server.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`> HTTPS Proxy running on https://0.0.0.0:${HTTPS_PORT}`);
    console.log(`> Forwarding to Next.js on http://127.0.0.1:${HTTP_PORT}`);
});

// --- VOD Archiver ---
// Detects streams with .record flag and archives segments to avoid retention deletion
const HLS_SOURCE_DIR = '/tmp/dStream_hls';
const STORAGE_DIR = '/tmp/dStream_storage';

if (!fs.existsSync(STORAGE_DIR)) {
    try { fs.mkdirSync(STORAGE_DIR, { recursive: true }); } catch (e) { }
}

function runArchiver() {
    try {
        if (!fs.existsSync(HLS_SOURCE_DIR)) return;

        const streams = fs.readdirSync(HLS_SOURCE_DIR);
        for (const streamId of streams) {
            const sourcePath = path.join(HLS_SOURCE_DIR, streamId);
            const flagPath = path.join(sourcePath, '.record');

            // Stats check to ensure it's a directory
            try {
                if (!fs.statSync(sourcePath).isDirectory()) continue;
            } catch (e) { continue; }

            if (fs.existsSync(flagPath)) {
                // Recording Enabled
                const destPath = path.join(STORAGE_DIR, streamId);
                if (!fs.existsSync(destPath)) {
                    fs.mkdirSync(destPath, { recursive: true });
                    console.log(`[Archiver] New recording session started for: ${streamId}`);
                }

                // Copy Segments
                const files = fs.readdirSync(sourcePath);
                let newSegmentsFound = false;

                for (const file of files) {
                    if (file.endsWith('.ts') || file.endsWith('.m4s') || file.endsWith('.mp4')) {
                        const srcFile = path.join(sourcePath, file);
                        const destFile = path.join(destPath, file);
                        if (!fs.existsSync(destFile)) {
                            // Copy with retries or safe copy
                            try {
                                fs.copyFileSync(srcFile, destFile);
                                newSegmentsFound = true;
                            } catch (copyErr) {
                                // Might be writing still
                            }
                        }
                    }
                }

                // Update VOD Playlist if new segments added
                if (newSegmentsFound) {
                    // Read existing TS files in Dest
                    const archivedFiles = fs.readdirSync(destPath)
                        .filter(f => f.endsWith('.ts') || f.endsWith('.m4s') || f.endsWith('.mp4'))
                        .sort((a, b) => {
                            // Sort by numeric sequence in filename (seg0, seg1, etc)
                            const numA = parseInt((a.match(/\d+/) || ['0'])[0]);
                            const numB = parseInt((b.match(/\d+/) || ['0'])[0]);
                            return numA - numB;
                        });

                    if (archivedFiles.length > 0) {
                        let vodContent = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n";

                        for (const seg of archivedFiles) {
                            // Assume 4.0s duration for simplicity (MediaMTX default)
                            // A real parser would read duration from source m3u8 or probe file
                            vodContent += `#EXTINF:4.000000,\n${seg}\n`;
                        }

                        vodContent += "#EXT-X-ENDLIST\n";
                        fs.writeFileSync(path.join(destPath, 'vod.m3u8'), vodContent);
                    }
                }
            }
        }
    } catch (e) {
        console.error("[Archiver] Iteration Error:", e.message);
    }
}

// Run archiver every 2 seconds
setInterval(runArchiver, 2000);
console.log(`> VOD Archiver active. Watching ${HLS_SOURCE_DIR}`);