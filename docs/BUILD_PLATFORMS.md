# Build & Deployment Guide (Cross-Platform)

dStream is built on **Docker**, making it compatible with Windows, Mac, and Linux.

## 1. Windows (WSL2)
**Recommendation**: Do NOT build directly on Windows PowerShell. Use **WSL2** (Windows Subsystem for Linux).

1.  **Install WSL2**:
    ```powershell
    wsl --install
    ```
    (Restart computer).
2.  **Install Docker Desktop for Windows**:
    *   Enable "WSL2 Backend" in Docker Settings.
3.  **Open Ubuntu Terminal**:
    ```bash
    git clone https://github.com/your-repo/dstream.git
    cd dstream
    ./infra/prod/deploy.sh
    ```

## 2. Linux (Ubuntu/Debian/Arch)
This is the native environment. Works best.

1.  **Install Docker & Compose**:
    ```bash
    sudo apt update && sudo apt install docker.io docker-compose-plugin
    ```
2.  **Run**:
    ```bash
    docker compose -f infra/stream/docker-compose.prod.yml up -d
    ```

## 3. Mac (macOS)
**Development**:
```bash
npm install
npm run dev
```
**Production Test**:
```bash
docker compose -f infra/stream/docker-compose.prod.yml up -d
```
(Note: On M1/M2/M3 chips, ensure Docker Desktop is updated to handle `linux/amd64` emulation if needed, though dStream builds natively on ARM too).

## 4. Mobile (iOS & Android)
dStream is currently a **Progressive Web App (PWA)**.

### How to "Install" the App:
*   **iOS**: Open Safari -> Share Button -> "Add to Home Screen".
*   **Android**: Open Chrome -> Menu -> "Install App".

### Native App Path (Future Roadmap):
To maximize performance, we plan to wrap the application using **CapacitorJS**:
1.  `npm install @capacitor/core @capacitor/cli`
2.  `npx cap add ios`
3.  `npx cap add android`
This converts the web code into a genuine `.ipa` (iOS) and `.apk` (Android) for the App Stores.
