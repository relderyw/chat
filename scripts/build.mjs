import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

for (const args of [
  ["node_modules/typescript/bin/tsc", "-b"],
  [
    "node_modules/typescript/bin/tsc",
    "--noEmit",
    "--target", "ES2022",
    "--module", "ESNext",
    "--moduleResolution", "Bundler",
    "--esModuleInterop",
    "--skipLibCheck",
    "--strict",
    "api/image.ts",
    "api/admin/invite.ts",
    "api/admin/users.ts",
    "api/account/password.ts",
    "server/firebase.ts",
    "server/types.ts",
    "shared/identity.ts",
  ],
  ["node_modules/vite/bin/vite.js", "build"],
]) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
