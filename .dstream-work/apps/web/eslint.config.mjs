import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // This codebase intentionally tolerates `any` in a few integration-heavy areas (Nostr + WebRTC).
      // We can tighten this incrementally once behavior is stable.
      "@typescript-eslint/no-explicit-any": "off",
      // Some client-only pages derive state from localStorage/identity; allow the pattern for now.
      "react-hooks/set-state-in-effect": "off"
    }
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"])
]);

export default eslintConfig;
