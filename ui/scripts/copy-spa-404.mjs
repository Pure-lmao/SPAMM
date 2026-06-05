import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const indexPath = path.join(distDir, "index.html");
const notFoundPath = path.join(distDir, "404.html");

if (!fs.existsSync(indexPath)) {
   console.error("copy-spa-404: dist/index.html not found — run vite build first");
   process.exit(1);
}

fs.copyFileSync(indexPath, notFoundPath);
console.log("copy-spa-404: wrote dist/404.html for Cloudflare Pages client routes");
