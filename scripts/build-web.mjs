import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const watch = process.argv.includes("--watch");
const dist = path.join(root, "web/dist");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "fonts"), { recursive: true });

const jsOpts = {
  entryPoints: [path.join(root, "web/src/main.ts")],
  outfile: path.join(dist, "app.js"),
  bundle: true,
  minify: true,
  sourcemap: false,
  target: "es2022",
  format: "esm",
  legalComments: "none",
};

function buildCSS() {
  const cli = path.join(root, "node_modules/.bin/tailwindcss");
  const args = ["-i", path.join(root, "web/styles/app.css"), "-o", path.join(dist, "app.css"), "--minify"];
  if (watch) args.push("--watch");
  execFileSync(cli, args, { cwd: root, stdio: "inherit" });
}

function copyStatic() {
  for (const f of fs.readdirSync(path.join(root, "web/fonts"))) {
    fs.copyFileSync(path.join(root, "web/fonts", f), path.join(dist, "fonts", f));
  }
  fs.copyFileSync(path.join(root, "web/favicon.ico"), path.join(dist, "favicon.ico"));
}

function gzipFile(file) {
  fs.writeFileSync(file + ".gz", zlib.gzipSync(fs.readFileSync(file), { level: 9 }));
}

copyStatic();
if (watch) {
  const ctx = await esbuild.context(jsOpts);
  await ctx.watch();
  console.log("esbuild watching web/src");
  buildCSS();
} else {
  await esbuild.build(jsOpts);
  buildCSS();
  gzipFile(path.join(dist, "app.js"));
  gzipFile(path.join(dist, "app.css"));
  for (const f of ["app.js", "app.css"]) {
    const raw = fs.statSync(path.join(dist, f)).size;
    const gz = fs.statSync(path.join(dist, f + ".gz")).size;
    console.log(`${f}: ${(raw / 1024).toFixed(1)} KB (${(gz / 1024).toFixed(1)} KB gzip)`);
  }
}
