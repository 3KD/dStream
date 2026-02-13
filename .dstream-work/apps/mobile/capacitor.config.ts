import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "stream.dstream.mobile",
  appName: "dStream",
  webDir: "www",
  server: {
    androidScheme: "https",
    allowNavigation: ["*"]
  }
};

export default config;
