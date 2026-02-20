const http = require('http');
const https = require('https');
const net = require('net');

const SERVICES = [
    { name: 'Next.js App', port: 5655, host: '127.0.0.1' },
    { name: 'Proxy Server', port: 5656, host: '127.0.0.1' },
    { name: 'MediaMTX', port: 8880, host: '127.0.0.1' }
];

async function checkPort(service) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(2000);
        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.on('error', (err) => {
            socket.destroy();
            resolve(false);
        });
        socket.connect(service.port, service.host);
    });
}

async function run() {
    console.log('🏥 dStream Infrastructure Health Check');
    console.log('-----------------------------------');

    let allUp = true;
    for (const service of SERVICES) {
        const isUp = await checkPort(service);
        console.log(`[${isUp ? 'OK' : 'FAIL'}] ${service.name} (Port ${service.port})`);
        if (!isUp) allUp = false;
    }

    if (!allUp) {
        console.error('\n❌ Verify all services are running!');
        console.error('   App: npm run dev');
        console.error('   Proxy: npm run dev:proxy');
        console.error('   MediaMTX: docker container');
        process.exit(1);
    }

    console.log('\n✅ Infrastructure Online');
    process.exit(0);
}

run();
