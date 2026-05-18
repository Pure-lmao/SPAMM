/**
 * Builds `public/favicon.png` from `public/brand.png` with a circular alpha mask
 * (transparent corners). Run: `bun run gen:favicon` (from `ui/`).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const srcPath = path.join(publicDir, "brand.png");
const outPath = path.join(publicDir, "favicon.png");

const SIZE = 64;

async function main() {
   await mkdir(publicDir, { recursive: true });
   let inputBuf;
   try {
      inputBuf = await readFile(srcPath);
   } catch {
      console.error(`Missing source image: ${srcPath}`);
      process.exit(1);
   }

   const circleMask = Buffer.from(
      `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
         <circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${SIZE / 2}" fill="white"/>
      </svg>`,
   );

   const resized = await sharp(inputBuf)
      .resize(SIZE, SIZE, { fit: "cover", position: "centre" })
      .ensureAlpha()
      .png()
      .toBuffer();

   const out = await sharp(resized)
      .composite([{ input: circleMask, blend: "dest-in" }])
      .png()
      .toBuffer();

   await writeFile(outPath, out);
   console.log(`Wrote ${outPath} (${SIZE}×${SIZE}, circular alpha)`);
}

await main();
