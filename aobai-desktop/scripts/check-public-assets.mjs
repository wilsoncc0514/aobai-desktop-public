import { cpSync, lstatSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const publicDir = resolve("public/builtin");
const rejected = [];

function inspect(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = lstatSync(path);
    if (entry.startsWith(".") || stat.isSymbolicLink()) {
      rejected.push(relative(publicDir, path));
    } else if (stat.isDirectory()) {
      inspect(path);
    }
  }
}

const root = lstatSync(publicDir);
if (root.isSymbolicLink() || !root.isDirectory()) {
  rejected.push("builtin root");
} else {
  inspect(publicDir);
}
if (rejected.length > 0) {
  console.error(`Builtin assets contain hidden files or links: ${rejected.join(", ")}`);
  process.exitCode = 1;
} else if (process.argv[2] === "--copy") {
  cpSync(publicDir, resolve("dist/builtin"), { recursive: true });
}
