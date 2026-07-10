/**
 * build-sounds.ts
 *
 * Best-effort, cross-platform audio feedback for build scripts.
 *
 * Design goals:
 *  - Never throws, never rejects unhandled, never blocks a build.
 *    Any failure (missing binary, missing file, spawn error, hung
 *    process) degrades silently to a no-op.
 *  - Zero dependency on third-party audio libraries — shells out to
 *    whatever native player already exists on the box.
 *  - Looping "background music" works even on players with no native
 *    loop flag (afplay) via a respawn strategy, without ever leaking
 *    orphaned child processes.
 *  - Fully silence-able via DIVEEOI_BUILD_SILENT=1 or the constructor
 *    option, so CI and quiet terminals aren't forced to hear anything.
 */

import { spawn, which } from "bun";
import path from "path";

export interface SoundSystemOptions {
  /** Override the directory sound files live in. Defaults to ./sounds next to this file. */
  soundsDir?: string;
  /** Disable all playback outright (still safe to call every method). */
  silent?: boolean;
  /** Max time to wait on a single-shot effect before killing it. */
  effectTimeoutMs?: number;
}

type PlayerId = "afplay" | "ffplay" | "mpg123" | "powershell";

interface PlayerDefinition {
  id: PlayerId;
  binary: string;
  /** True if the player itself can loop a file forever via a flag. */
  supportsNativeLoop: boolean;
  /** Build the full argv for spawning this player against `target`. */
  buildCommand: (target: string, looping: boolean) => string[];
}

const PLAYER_DEFINITIONS: Record<PlayerId, PlayerDefinition> = {
  afplay: {
    id: "afplay",
    binary: "afplay",
    supportsNativeLoop: false, // no loop flag — handled via respawn
    buildCommand: (target) => ["afplay", target],
  },
  ffplay: {
    id: "ffplay",
    binary: "ffplay",
    supportsNativeLoop: true,
    buildCommand: (target, looping) => [
      "ffplay",
      ...(looping ? ["-loop", "0"] : []), // ffplay's loop flag is `-loop <n>` (0 = forever); NOT ffmpeg's `-stream_loop`
      "-nodisp",
      "-autoexit",
      "-loglevel",
      "quiet",
      target,
    ],
  },
  mpg123: {
    id: "mpg123",
    binary: "mpg123",
    supportsNativeLoop: true,
    buildCommand: (target, looping) => [
      "mpg123",
      "-q",
      ...(looping ? ["--loop", "-1"] : []),
      target,
    ],
  },
  powershell: {
    id: "powershell",
    binary: "powershell",
    supportsNativeLoop: true, // SoundPlayer.PlayLooping() loops natively
    buildCommand: (target, looping) => [
      "powershell",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$p = New-Object System.Media.SoundPlayer '${target}'; ` +
        (looping ? "$p.PlayLooping()" : "$p.PlaySync()"),
    ],
  },
};

/** Preference order per platform; first binary found on PATH wins. */
const DETECTION_ORDER: PlayerId[] =
  process.platform === "win32"
    ? ["powershell", "ffplay"]
    : process.platform === "darwin"
      ? ["afplay", "ffplay", "mpg123"]
      : ["ffplay", "mpg123"];

const PREFIX = "[sound-system]";
const warn = (msg: string) => console.warn(`${PREFIX} ${msg}`);
const err = (msg: string, e?: unknown) => console.error(`${PREFIX} ${msg}`, e ?? "");

type Proc = ReturnType<typeof spawn>;

export class BuildSoundSystem {
  private readonly soundsDir: string;
  private readonly silent: boolean;
  private readonly effectTimeoutMs: number;
  private readonly debug: boolean;

  private player: PlayerDefinition | null = null;
  private readonly ready: Promise<void>;

  private musicProc: Proc | null = null;
  private musicGeneration = 0;
  private stopping = false;

  private readonly missingFiles = new Set<string>();
  private cleanupRegistered = false;

  constructor(options: SoundSystemOptions = {}) {
    this.soundsDir = options.soundsDir ?? path.resolve(import.meta.dir, "sounds");
    this.silent = options.silent ?? process.env.DIVEEOI_BUILD_SILENT === "1";
    this.effectTimeoutMs = options.effectTimeoutMs ?? 15_000;
    this.debug = process.env.DIVEEOI_SOUND_DEBUG === "1";

    this.ready = this.silent ? Promise.resolve() : this.detectPlayer();
    this.registerCleanup();
  }

  /** Scan PATH once for the first supported player on this platform. */
  private async detectPlayer(): Promise<void> {
    try {
      for (const id of DETECTION_ORDER) {
        const def = PLAYER_DEFINITIONS[id];
        // Bun.which is synchronous — it returns string | null directly, not a Promise.
        const resolved = which(def.binary);
        if (resolved) {
          this.player = def;
          return;
        }
      }
      warn(
        `No supported audio player found (looked for: ${DETECTION_ORDER.join(", ")}). Running silent.`,
      );
    } catch (e) {
      err("Player detection failed unexpectedly, running silent.", e);
      this.player = null;
    }
  }

  /** Resolve + validate a sound filename against soundsDir. Warns once per missing file. */
  private async resolveFile(filename: string): Promise<string | null> {
    const target = path.join(this.soundsDir, filename);
    try {
      const exists = await Bun.file(target).exists();
      if (!exists) {
        if (!this.missingFiles.has(target)) {
          this.missingFiles.add(target);
          warn(`Sound file not found, skipping: ${target}`);
        }
        return null;
      }
      return target;
    } catch (e) {
      err(`Could not check sound file "${target}"`, e);
      return null;
    }
  }

  private spawnPlayer(target: string, looping: boolean): Proc | null {
    if (!this.player) return null;
    const cmd = this.player.buildCommand(target, looping);
    try {
      const proc = spawn(cmd, {
        stdout: "ignore",
        stderr: this.debug ? "inherit" : "ignore",
        stdin: "ignore",
      });
      // Prevent unhandled rejection noise if the child dies unexpectedly.
      proc.exited.catch(() => {});
      return proc;
    } catch (e) {
      err(`Failed to spawn "${cmd[0]}" for ${path.basename(target)}`, e);
      return null;
    }
  }

  /**
   * Start a looping background track. No-op if already playing, silenced,
   * or no player is available. Safe to call repeatedly.
   */
  public async startMusic(filename = "chirp.ogg"): Promise<void> {
    if (this.silent || this.musicProc) return;
    await this.ready;
    if (!this.player) return;

    const target = await this.resolveFile(filename);
    if (!target) return;

    this.stopping = false;
    const generation = ++this.musicGeneration;

    if (this.player.supportsNativeLoop) {
      const proc = this.spawnPlayer(target, true);
      if (!proc) return;
      this.musicProc = proc;
      return;
    }

    // No native loop support (e.g. afplay): respawn on natural exit.
    const playOnce = () => {
      if (this.stopping || generation !== this.musicGeneration) return;
      const proc = this.spawnPlayer(target, false);
      if (!proc) return;
      this.musicProc = proc;
      proc.exited
        .then(() => {
          if (!this.stopping && generation === this.musicGeneration) playOnce();
        })
        .catch(() => {
          // Spawn/exit error mid-loop — stop retrying rather than spin forever.
        });
    };
    playOnce();
  }

  /** Stop the background track immediately. Safe if nothing is playing. */
  public stopMusic(): void {
    this.stopping = true;
    this.musicGeneration++; // invalidate any pending respawn closures
    if (this.musicProc) {
      try {
        this.musicProc.kill();
      } catch (e) {
        err("Error stopping background music", e);
      }
      this.musicProc = null;
    }
  }

  /**
   * Play a one-shot effect and wait for it to finish (bounded by
   * effectTimeoutMs so a hung player can never stall the build).
   */
  public async playEffect(filename: string): Promise<void> {
    if (this.silent) return;
    await this.ready;
    if (!this.player) return;

    const target = await this.resolveFile(filename);
    if (!target) return;

    const proc = this.spawnPlayer(target, false);
    if (!proc) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        proc.exited,
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            warn(`Effect "${filename}" exceeded ${this.effectTimeoutMs}ms, killing it.`);
            try {
              proc.kill();
            } catch {
              /* already dead */
            }
            resolve();
          }, this.effectTimeoutMs);
          timer.unref?.();
        }),
      ]);
    } catch (e) {
      err(`Effect playback failed for "${filename}"`, e);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Stop everything and detach cleanup hooks. Call once at process end. */
  public dispose(): void {
    this.stopMusic();
  }

  private registerCleanup(): void {
    if (this.cleanupRegistered) return;
    this.cleanupRegistered = true;
    const cleanup = () => this.stopMusic();
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
}
