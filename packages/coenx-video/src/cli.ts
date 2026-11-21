#!/usr/bin/env bun
import { readFile } from "node:fs/promises"
import path from "node:path"
import { compileInteractiveProject } from "./compiler/interactive"
import { validateComposition, RENDER_PROFILES } from "./model/validate"
import { renderStandardVideo } from "./render/standard"
import type { VideoComposition } from "./model/types"
import { compileCmlProject } from "./format"

function usage(): never {
  console.error(
    "Usage: coenx-video <validate|render|interactive> <composition.json|project.cml> [--out <path>] [--profile low|balanced|quality] [--renderer svg|native]",
  )
  process.exit(2)
}

function option(args: string[], name: string) {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith("--")) throw new Error("Missing value after " + name)
  return value
}

async function readOptional(file: string) {
  try {
    return await readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function loadComposition(inputPath: string): Promise<VideoComposition> {
  if (path.extname(inputPath).toLowerCase() !== ".cml") {
    return JSON.parse(await readFile(inputPath, "utf8")) as VideoComposition
  }
  const parsed = path.parse(inputPath)
  const base = path.join(parsed.dir, parsed.name)
  const [markup, styles, script] = await Promise.all([
    readFile(inputPath, "utf8"),
    readOptional(base + ".css"),
    readOptional(base + ".js"),
  ])
  return compileCmlProject({ markup, styles, script })
}

async function main() {
  const [command, input, ...args] = process.argv.slice(2)
  if (!command || !input) usage()
  const inputPath = path.resolve(input)
  const composition = await loadComposition(inputPath)
  const profileName = option(args, "--profile") as keyof typeof RENDER_PROFILES | undefined
  const profile = profileName ? RENDER_PROFILES[profileName] : RENDER_PROFILES.balanced
  if (command === "validate") {
    const summary = validateComposition(composition, profile)
    console.log(
      JSON.stringify(
        { valid: true, ...summary, durationSeconds: summary.totalFrames / composition.stage.fps },
        null,
        2,
      ),
    )
    return
  }
  const output = option(args, "--out")
  if (!output) usage()
  if (command === "render") {
    const result = await renderStandardVideo(composition, {
      outputPath: output,
      projectRoot: path.dirname(inputPath),
      profile,
      renderer: (option(args, "--renderer") as "svg" | "native" | undefined) ?? "svg",
      onProgress: (progress) =>
        process.stderr.write("\r" + progress.percent + "% " + progress.frame + "/" + progress.totalFrames),
    })
    process.stderr.write("\n")
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (command === "interactive") {
    const result = await compileInteractiveProject(composition, {
      outputDirectory: output,
      projectRoot: path.dirname(inputPath),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  usage()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
