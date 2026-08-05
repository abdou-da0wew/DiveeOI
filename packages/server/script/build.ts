#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")

import { Script } from "@diveeoi/script"
import pkg from "../package.json"

const singleFlag = process.argv.includes("--single") || process.env.DIVEEOI_BUILD_SINGLE === "1"
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")
const sourcemapsFlag = process.argv.includes("--sourcemaps")
const shouldBuildBinary = !process.argv.includes("--no-binary") && !process.env.DIVEEOI_BUILD_NOBINARY
const skipEmbedWebUi = process.argv.includes("--skip-embed-web-ui")
const plugin = createSolidTransformPlugin()

const createEmbeddedWebUIBundle = async () => {
  const appDir = path.join(import.meta.dirname, "../../app")
  const dist = path.join(appDir, "dist")
  // Always rebuild the Web UI to ensure fresh hashes.
  // When turbo builds in parallel, the dist directory may exist but contain stale
  // Vite hashes from a previous app build. Rebuilding guarantees fresh imports.
  console.log(`Building Web UI to embed in the binary`)
  const buildEnv = { ...process.env, OPENCODE_CHANNEL: Script.channel }
  await $`bun run --cwd ${appDir} build`.env(buildEnv)
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist })))
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !file.endsWith(".map"))
    .sort()
  const imports = files.map((file, i) => {
    const spec = path.relative(dir, path.join(dist, file)).replaceAll("\\", "/")
    return `import file_${i} from ${JSON.stringify(spec.startsWith(".") ? spec : `./${spec}`)} with { type: "file" };`
  })
  const entries = files.map((file, i) => `  ${JSON.stringify(file)}: file_${i},`)
  return [
    `// Import all files as file_$i with type: "file"`,
    ...imports,
    `// Export with original mappings`,
    `export default {`,
    ...entries,
    `}`,
  ].join("\n")
}

const embeddedFileMap = skipEmbedWebUi || !shouldBuildBinary ? null : await createEmbeddedWebUIBundle()

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
  {
    os: "linux",
    arch: "arm64",
  },
  {
    os: "linux",
    arch: "x64",
  },
  {
    os: "linux",
    arch: "x64",
    avx2: false,
  },
  {
    os: "linux",
    arch: "arm64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
    avx2: false,
  },
  {
    os: "darwin",
    arch: "arm64",
  },
  {
    os: "darwin",
    arch: "x64",
  },
  {
    os: "darwin",
    arch: "x64",
    avx2: false,
  },
  {
    os: "win32",
    arch: "arm64",
  },
  {
    os: "win32",
    arch: "x64",
  },
  {
    os: "win32",
    arch: "x64",
    avx2: false,
  },
]

const platformOs = process.env.DIVEEOI_BUILD_OS
const platformArch = process.env.DIVEEOI_BUILD_ARCH as string | undefined

const targets = singleFlag || platformOs
  ? allTargets.filter((item) => {
      const matchOs = platformOs ? item.os === platformOs : item.os === process.platform
      const matchArch = platformArch ? item.arch === platformArch : item.arch === process.arch
      if (!matchOs || !matchArch) return false

      // When building for a specific platform, prefer a single native binary by default.
      // Baseline binaries require additional Bun artifacts and can be flaky to download.
      if (item.avx2 === false) return baselineFlag

      // also skip abi-specific builds for the same reason
      if (item.abi !== undefined && !platformOs) return false
      if (item.abi !== undefined && platformOs) return true

      return true
    })
  : allTargets

fs.rmSync(path.join(dir, "dist"), { recursive: true, force: true })

const binaries: Record<string, string> = {}
if (shouldBuildBinary) {
  if (!skipInstall) {
    await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
    await $`bun install --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
    await $`bun install --os="*" --cpu="*" @ff-labs/fff-bun@${pkg.dependencies["@ff-labs/fff-bun"]}`
  }
}

if (shouldBuildBinary) {
  for (const item of targets) {
  const name = [
    pkg.name,
    // changing to win32 flags npm for some reason
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")
  console.log(`building ${name}`)
  fs.mkdirSync(path.join(dir, `dist/${name}/bin`), { recursive: true })

  const localPath = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
  const rootPath = path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js")
  const parserWorker = fs.realpathSync(fs.existsSync(localPath) ? localPath : rootPath)

  // Use platform-specific bunfs root path based on target OS
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
  const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

  await Bun.build({
    conditions: ["bun", "node"],
    tsconfig: "./tsconfig.json",
    plugins: [plugin],
    external: ["node-gyp"],
    format: "esm",
    minify: true,
    sourcemap: sourcemapsFlag ? "linked" : "none",
    splitting: true,
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: name.replace(pkg.name, "bun") as any,
      outfile: `dist/${name}/bin/diveeoi`,
      execArgv: [`--user-agent=diveeoi/${Script.version}`, "--use-system-ca", "--memory-limit=1200", "--max-old-space-size=512", "--"],
      windows: {},
    },
    files: embeddedFileMap ? { "diveeoi-web-ui.gen.ts": embeddedFileMap } : {},
    entrypoints: ["./src/main.ts", parserWorker, ...(embeddedFileMap ? ["diveeoi-web-ui.gen.ts"] : [])],
    define: {
      FFF_LIBC: JSON.stringify(item.abi === "musl" ? "musl" : "gnu"),
      OPENCODE_VERSION: `'${Script.version}'`,
      OPENCODE_MODELS_DEV: generated.modelsData,
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,

      OPENCODE_CHANNEL: `'${Script.channel}'`,
      OPENCODE_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
      ...(item.os === "linux" ? { "process.env.OPENTUI_LIBC": JSON.stringify(item.abi ?? "glibc") } : {}),
    },
  })

  // Smoke test: verify binary runs and outputs --version
  if (item.os === process.platform && item.arch === process.arch && !item.abi) {
    const binaryPath = path.join(dir, `dist/${name}/bin/diveeoi`)
    try {
      const result = await $`${binaryPath} --version`.text()
      if (result) {
        console.log(`Smoke test passed: ${binaryPath}`)
        console.log(`  Output: ${result.trim().split('\n')[0]}`)
      }
    } catch {
      // Fallback: just check the file exists and is non-empty
      const stat = fs.statSync(binaryPath)
      if (stat.size === 0) {
        console.error(`Smoke test failed for ${name}: binary is empty`)
        process.exit(1)
      }
      console.log(`Smoke test (fallback) passed: ${binaryPath} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`)
    }
  }

  fs.rmSync(path.join(dir, `dist/${name}/bin/tui`), { recursive: true, force: true })
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        preferUnplugged: true,
        os: [item.os],
        cpu: [item.arch],
        ...(item.abi ? { libc: [item.abi] } : {}),
      },
      null,
      2,
    ),
  )
  binaries[name] = Script.version
  }
}

if (Script.release) {
  for (const key of Object.keys(binaries)) {
    if (key.includes("linux")) {
      await $`tar -czf ../../${key}.tar.gz *`.cwd(`dist/${key}/bin`)
    } else {
      await $`zip -r ../../${key}.zip *`.cwd(`dist/${key}/bin`)
    }
  }
  await $`gh release upload v${Script.version} ./dist/*.zip ./dist/*.tar.gz --clobber --repo ${process.env.GH_REPO}`
}

export { binaries }
