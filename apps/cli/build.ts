#!/usr/bin/env bun
import { execSync } from "child_process"

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  naming: "openrelay",
  target: "bun",
  plugins: [
    {
      name: "stub-react-devtools-core",
      setup(build) {
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
          path: "react-devtools-core",
          namespace: "stub",
        }))
        build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: "export default null;",
          loader: "js",
        }))
      },
    },
  ],
})

if (!result.success) {
  for (const msg of result.logs) console.error(msg)
  process.exit(1)
}

const out = result.outputs[0]!
execSync(`chmod +x ${out.path}`)
console.log(`Built ${out.path} (${(out.size / 1024).toFixed(0)} KB)`)
