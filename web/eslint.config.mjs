import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // @opennextjs/cloudflare のビルド成果物（wrangler がデプロイする worker.js と assets）。
    // 除外しないと 3 万件超の警告が出て src/ の本物の指摘が埋もれる。
    ".open-next/**",
  ]),
]);

export default eslintConfig;
