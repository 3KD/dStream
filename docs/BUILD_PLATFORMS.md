# Build and Development Platforms

The canonical runtime lives in `.dstream-work` and uses Node.js 22, npm, Docker, and Docker Compose. The same source runs on macOS, Linux, and Windows through WSL2, but production deployment targets a Linux host.

## macOS

Install Node.js 22 and Docker Desktop, then:

```bash
cd .dstream-work
npm ci
cp .env.example .env.local
npm run infra:up:test
npm run dev
```

Use Xcode only when building the Capacitor iOS shell.

## Linux

Install Node.js 22 and the Docker Compose plugin. Use the same local commands as macOS. Linux is the supported production host for the Compose stack and operator scripts.

## Windows

Use WSL2 with Docker Desktop's WSL integration. Clone the repository inside the WSL filesystem, then run the canonical commands from `.dstream-work`. Native PowerShell paths are not used by the deployment scripts.

## Mobile Shells

The maintained mobile shell is `.dstream-work/apps/mobile`, not the root legacy `apps/mobile` scaffold. Building iOS or Android source packages does not mean a signed store artifact has been submitted or published.

See:

- [Mobile app](../.dstream-work/docs/MOBILE_APP.md)
- [Mobile store deployment](../.dstream-work/docs/MOBILE_STORE_DEPLOY.md)
- [Mobile release checklist](../.dstream-work/docs/MOBILE_RELEASE_CHECKLIST.md)

## Production

Prepare `.dstream-work/.env.production`, run the hardening and production gates, then use the canonical deployment script. Full instructions are in [the deployment guide](../.dstream-work/docs/DEPLOYMENT.md).
