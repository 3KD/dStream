const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const httpProxy = require('http-proxy');

// Configuration
const HTTP_PORT = 5655; // Next.js port (changed from 3000 to avoid conflicts)
const HTTPS_PORT = 5656; // Secure access port

// Create proxy server
const proxy = httpProxy.createProxyServer({
    target: `http://127.0.0.1:${HTTP_PORT}`,
    ws: true // Proxy WebSockets
});

// Error handling to prevent crash on connection reset
proxy.on('error', (err, req, res) => {
    console.error('Proxy Error:', err);
    if (res && res.writeHead) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Bad Gateway: Next.js server might be restarting or down.');
    }
});

// Load certificates
const httpsOptions = {
    key: fs.readFileSync(path.join(__dirname, '..', 'certs', 'localhost+2-key.pem')),
    cert: fs.readFileSync(path.join(__dirname, '..', 'certs', 'localhost+2.pem')),
};

// Create HTTPS server
const server = https.createServer(httpsOptions, (req, res) => {
    if (req.url.startsWith('/hls')) {
        req.url = req.url.replace(/^\/hls/, '');
        proxy.web(req, res, { target: 'http://127.0.0.1:8880' });
    } else {
        proxy.web(req, res);
    }
});

// Handle WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
    proxy.ws(req, socket, head);
});

// --- HTTP Server (For Mobile/LAN without SSL issues) ---
const HTTP_PROXY_PORT = 5657;
const httpServer = http.createServer((req, res) => {
    if (req.url.startsWith('/hls')) {
        req.url = req.url.replace(/^\/hls/, '');
        proxy.web(req, res, { target: 'http://127.0.0.1:8880' });
    } else {
        proxy.web(req, res);
    }
});

httpServer.on('upgrade', (req, socket, head) => {
    proxy.ws(req, socket, head);
});

httpServer.listen(HTTP_PROXY_PORT, '0.0.0.0', () => {
    console.log(`> HTTP  Proxy running on http://0.0.0.0:${HTTP_PROXY_PORT} (Use for Mobile)`);
});

server.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`> HTTPS Proxy running on https://0.0.0.0:${HTTPS_PORT}`);
    console.log(`> Forwarding to Next.js on http://localhost:${HTTP_PORT}`);
});
