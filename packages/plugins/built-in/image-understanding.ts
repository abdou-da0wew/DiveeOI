import { type Plugin, tool } from "@opencode-ai/plugin";
import type { FilePart, Part } from "@opencode-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ─────────────────────────────────────────────────────────────
//  Configuration
// ─────────────────────────────────────────────────────────────
const API_URL = "https://opencode.ai/zen/v1/chat/completions";
const API_KEY = "public";
const MODEL = "mimo-v2.5-free";
const MAX_ATTACHMENTS = 10;
const MAX_TOKENS = 4096;
const TEMPERATURE = 0.2;

// ─────────────────────────────────────────────────────────────
//  Supported MIME types
//  Images: fully supported by MiMo v2.5
//  Video/Audio: model-dependent, included for forward compat
// ─────────────────────────────────────────────────────────────
const MIME_MAP: Record<string, string> = {
  // images
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  avif: "image/avif",
  // video
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  // audio
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  m4a: "audio/mp4",
  opus: "audio/opus",
  wma: "audio/x-ms-wma",
};

const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "image/svg+xml",
  "image/x-icon",
  "image/avif",
];

const SUPPORTED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
];

const SUPPORTED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/flac",
  "audio/aac",
  "audio/mp4",
  "audio/opus",
  "audio/x-ms-wma",
];

const ALL_SUPPORTED_TYPES = [
  ...SUPPORTED_IMAGE_TYPES,
  ...SUPPORTED_VIDEO_TYPES,
  ...SUPPORTED_AUDIO_TYPES,
];

function mimeFromExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  return MIME_MAP[ext] ?? "application/octet-stream";
}

function isSupportedMime(mime: string): boolean {
  return ALL_SUPPORTED_TYPES.includes(mime);
}

function mimeCategory(mime: string): "image" | "video" | "audio" | "unknown" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "unknown";
}

// ─────────────────────────────────────────────────────────────
//  System prompt — RISEN framework
// ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = [
  "<role>",
  "You are a precise media analyst. Your sole function is to analyze images and produce structured descriptions with ASCII art representations.",
  "</role>",
  "",
  "<task>",
  "For every image provided, produce TWO outputs:",
  "1. A CONCISE DESCRIPTION (max 3 sentences) covering: main subject, composition, colors, lighting, and notable elements.",
  "2. An ASCII ART REPRESENTATION showing the essential shapes, layout, proportions, and spatial relationships.",
  "</task>",
  "",
  "<output_format>",
  "Use exactly this structure for each image:",
  "",
  "Image N: <filename>",
  "  Description: <2-3 sentence description>",
  "  ASCII Art:",
  "  ```",
  "  <ascii art>",
  "  ```",
  "</output_format>",
  "",
  "<constraints>",
  "- Descriptions: max 3 sentences each. Precise, objective, no fluff.",
  "- ASCII art: max 20 lines tall, 40 characters wide. Text characters only.",
  "- Standard ASCII preferred: # @ % * + - | / \\ . and space.",
  "- Extended block chars optional: \u2588 \u2593 \u2592 \u2591 \u2584 \u2580 \u258C \u2590 \u25A0 \u25A1 \u25CF \u25CB \u25C6 \u25C7 \u25B2 \u25B3.",
  "- Be OBJECTIVE. Describe only what is actually visible.",
  "- Do NOT invent text, logos, or details not clearly present.",
  "- If text is visible, transcribe it accurately.",
  "- For multiple images: label Image 1, Image 2, ... sequentially.",
  "- Note relationships between images (same scene, different angles, before/after, etc.).",
  "</constraints>",
  "",
  "<narrowing>",
  "- NO commentary about your analysis process.",
  "- NO disclaimers, warnings, or safety notes.",
  "- NO questions. Just produce the structured output.",
  "- If an image is unclear or ambiguous, state that fact in the description.",
  "- If a video or audio file is provided, describe its visual/auditory content.",
  "</narrowing>",
].join("\n");

// ─────────────────────────────────────────────────────────────
//  Path resolution
// ─────────────────────────────────────────────────────────────
async function resolveImagePath(raw: string, base: string): Promise<string> {
  const abs = path.isAbsolute(raw) ? raw : path.resolve(base, raw);
  await fs.promises.access(abs, fs.constants.R_OK);
  return abs;
}

// ─────────────────────────────────────────────────────────────
//  Attachment discovery via OpenCode client API
// ─────────────────────────────────────────────────────────────
interface AttachmentInfo {
  source: "path" | "data-url";
  mime: string;
  filename: string;
  /** Filesystem path (if source === "path") */
  filePath?: string;
  /** Pre-read base64 content (if source === "data-url") */
  dataUrl?: string;
}

/**
 * Fetch recent user messages from the session and extract
 * FileParts with supported MIME types.
 *
 * Uses the v1 SDK format: messages({ path: { id }, query: { directory, limit } })
 * returns Promise<{ data?: Array<{ info: Message; parts: Part[] }>, error?: ... }>
 */
async function findAttachments(
  client: SDKClient,
  sessionID: string,
  directory: string,
): Promise<AttachmentInfo[]> {
  try {
    const result = await client.session.messages({
      path: { id: sessionID },
      query: { directory, limit: 5 },
    } as never);

    // result is { data?: Array<{ info: { role: string }; parts: Part[] }>, error?: ... }
    const res = result as {
      data?: Array<{ info: { role: string }; parts: Part[] }>;
      error?: unknown;
    };

    if (res.error || !res.data) {
      return [];
    }

    // Find the latest user message that has FileParts
    for (const msg of res.data) {
      if (msg.info.role !== "user") continue;

      const fileParts = msg.parts.filter(
        (p): p is FilePart =>
          p.type === "file" && isSupportedMime(p.mime),
      );

      if (fileParts.length === 0) continue;

      const attachments: AttachmentInfo[] = [];

      for (const fp of fileParts) {
        const resolved = await resolveFilePart(fp, directory);
        if (resolved) attachments.push(resolved);
      }

      if (attachments.length > 0) return attachments;
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * Resolve a single FilePart to either a local file path or
 * an inline base64 data URL.
 */
async function resolveFilePart(
  fp: FilePart,
  baseDir: string,
): Promise<AttachmentInfo | null> {
  const filename = fp.filename ?? "attachment";
  const mime = fp.mime;

  // Priority 1: file source with explicit path
  if (fp.source?.type === "file" && fp.source.path) {
    try {
      await fs.promises.access(fp.source.path, fs.constants.R_OK);
      return {
        source: "path",
        mime,
        filename,
        filePath: fp.source.path,
      };
    } catch {
      // file not found at source path, try next strategy
    }
  }

  // Priority 2: file:// URL
  if (fp.url.startsWith("file://")) {
    const filePath = fileURLToPath(fp.url);
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
      return {
        source: "path",
        mime,
        filename,
        filePath,
      };
    } catch {
      // not accessible, try next strategy
    }
  }

  // Priority 3: relative path resolved against base directory
  if (
    !fp.url.startsWith("data:") &&
    !fp.url.startsWith("http://") &&
    !fp.url.startsWith("https://") &&
    !fp.url.startsWith("file://")
  ) {
    try {
      const resolved = await resolveImagePath(fp.url, baseDir);
      return {
        source: "path",
        mime,
        filename,
        filePath: resolved,
      };
    } catch {
      // not found as relative path, try next strategy
    }
  }

  // Priority 4: data URL → read inline
  if (fp.url.startsWith("data:")) {
    return {
      source: "data-url",
      mime,
      filename,
      dataUrl: fp.url,
    };
  }

  // Unresolvable
  return null;
}

// ─────────────────────────────────────────────────────────────
//  Plugin definition
// ─────────────────────────────────────────────────────────────
type SDKClient = {
  session: {
    messages: (opts: Record<string, unknown>) => Promise<{
      data?: Array<{ info: { role: string }; parts: Part[] }>;
      error?: unknown;
    }>;
  };
};

export const ImageUnderstandingPlugin: Plugin = async (input) => {
  const client = input.client as unknown as SDKClient;
  const baseDir = input.directory || input.worktree;

  return {
    tool: {
      describe_images: tool({
        description: [
          "Analyze images, screenshots, and other visual files using the MiMo v2.5 vision model, returning structured descriptions with ASCII art.",
          "",
          "Use this tool whenever the user attaches image files or asks you to look at images or screenshots.",
          "",
          "Supports multiple sources:",
          "  - File paths (absolute or relative to project root)",
          "  - UI-attached files (images, screenshots dropped into the chat)",
          "  - Data URLs (inline base64-encoded content)",
          "",
          "When `image_paths` is empty and `auto_detect` is true (default), the tool automatically",
          "scans the most recent user message for any file attachments with supported MIME types",
          "(image/*, video/*, audio/*) and includes them in the analysis.",
          "",
          "Supports up to 10 files in a single call.",
          "",
          "Args:",
          "  image_paths (string[], optional): File paths to images to analyze.",
          "    Absolute paths preferred. If empty, auto_detect must find attachments.",
          "  auto_detect (boolean, optional, default: true): Automatically find file",
          "    attachments in the current session's recent user messages.",
          "  detail_level ('high' | 'low'): Detail level.",
          "    'high' (default): Full description + ASCII art for each image.",
          "    'low': Brief description only, no ASCII art.",
          "",
          "Returns:",
          "  Structured text with descriptions for each image. When detail_level='high',",
          "  each description includes an ASCII art representation.",
          "  If some files couldn't be read, a warning is appended.",
          "",
          "Note: Video and audio files are sent to the model as base64 data. The model's",
          "ability to process these depends on its current capabilities. Images are",
          "fully supported.",
          "",
          "Examples:",
          '  - describe_images({ image_paths: ["/path/to/photo.jpg"] })',
          '  - describe_images({ image_paths: [], auto_detect: true, detail_level: "high" })',
          '  - describe_images({ auto_detect: true })',
        ].join("\n"),
        args: {
          image_paths: tool.schema
            .array(
              tool.schema
                .string()
                .describe("Path to an image file (absolute or relative)"),
            )
            .min(0)
            .max(MAX_ATTACHMENTS)
            .default([])
            .describe(
              "File paths to the images to analyze. Empty array = use auto_detect.",
            ),
          auto_detect: tool.schema
            .boolean()
            .default(true)
            .describe(
              "Automatically find file attachments in recent user messages",
            ),
          detail_level: tool.schema
            .enum(["high", "low"])
            .default("high")
            .describe(
              "Detail level: 'high' for description + ASCII art, 'low' for description only",
            ),
        },
        async execute(args, context) {
          const { image_paths = [], auto_detect = true, detail_level = "high" } = args;
          const workDir = context.worktree || context.directory || baseDir;

          // ── Phase 1: Resolve all sources ───────────────
          const validSources: AttachmentInfo[] = [];
          const errors: string[] = [];

          // 1a. Explicit file paths
          if (image_paths.length > 0) {
            for (const raw of image_paths) {
              try {
                const resolved = await resolveImagePath(raw, workDir);
                const mime = mimeFromExt(resolved);
                validSources.push({
                  source: "path",
                  mime,
                  filename: path.basename(resolved),
                  filePath: resolved,
                });
              } catch {
                errors.push(raw);
              }
            }
          }

          // 1b. Auto-detect attachments from session
          if (image_paths.length === 0 && auto_detect) {
            const attachments = await findAttachments(
              client,
              context.sessionID,
              context.directory,
            );
            for (const att of attachments) {
              validSources.push(att);
            }

            if (attachments.length === 0 && errors.length === 0) {
              return {
                title: "No images found",
                output: [
                  "No images or file attachments were found to analyze.",
                  "",
                  "To use this tool:",
                  "  1. Provide explicit file paths via `image_paths`, or",
                  "  2. Attach files to your message in the chat UI",
                  "     (drag & drop or use the attachment button)",
                  "",
                  "If you attached files but they weren't detected, try providing",
                  "their explicit file paths instead.",
                ].join("\n"),
                metadata: {
                  error: "no_sources",
                  auto_detect_attempted: true,
                },
              };
            }
          }

          if (validSources.length === 0) {
            return {
              title: "Analysis failed",
              output: [
                "Error: Could not find any valid files to analyze.",
                "",
                "Sources checked:",
                `  - image_paths: ${image_paths.length > 0 ? image_paths.join(", ") : "(none)"}`,
                `  - auto_detect: ${auto_detect ? "yes" : "no"}`,
                ...(errors.length > 0
                  ? ["", "Failed paths:", ...errors.map((p) => `  - ${p}`)]
                  : []),
              ].join("\n"),
              metadata: {
                error: "no_valid_sources",
                attempted_paths: image_paths,
                auto_detect,
                base_dir: workDir,
              },
            };
          }

          // Trim to max
          const sources = validSources.slice(0, MAX_ATTACHMENTS);
          if (validSources.length > MAX_ATTACHMENTS) {
            errors.push(
              `${validSources.length - MAX_ATTACHMENTS} additional file(s) omitted (max ${MAX_ATTACHMENTS})`,
            );
          }

          // ── Phase 2: Read & encode media ───────────────
          const content: Array<Record<string, unknown>> = [];

          const detailInstruction =
            detail_level === "high"
              ? "Provide a full description AND ASCII art."
              : "Provide a brief description only (no ASCII art).";

          const hasNonImage = sources.some(
            (s) => mimeCategory(s.mime) !== "image",
          );

          content.push({
            type: "text",
            text: [
              `Analyze the following media file(s). ${detailInstruction}`,
              "",
              "Label each file as Image 1, Image 2, etc.",
              "Use the exact output format specified in the system instructions.",
              ...(hasNonImage
                ? [
                    "",
                    "Note: Some files are video or audio. Describe what you can",
                    "perceive from them. If visual content is limited, note that.",
                  ]
                : []),
            ].join("\n"),
          });

          for (let i = 0; i < sources.length; i++) {
            const src = sources[i];
            let dataUrl: string;

            if (src.source === "data-url" && src.dataUrl) {
              dataUrl = src.dataUrl;
            } else if (src.source === "path" && src.filePath) {
              try {
                const buffer = await fs.promises.readFile(src.filePath);
                dataUrl = `data:${src.mime};base64,${buffer.toString("base64")}`;
              } catch (err) {
                errors.push(`${src.filename} (read error: ${err instanceof Error ? err.message : String(err)})`);
                continue;
              }
            } else {
              errors.push(`${src.filename} (no readable source)`);
              continue;
            }

            const category = mimeCategory(src.mime);

            content.push({
              type: "text",
              text: [
                `--- ${category === "image" ? "Image" : category === "video" ? "Video" : "Audio"} ${i + 1}: ${src.filename} ---`,
                `MIME: ${src.mime}`,
              ].join("\n"),
            });

            content.push({
              type: "image_url",
              image_url: {
                url: dataUrl,
              },
            });
          }

          // If we ended up with no images in the content array
          if (content.length <= 1) {
            return {
              title: "Analysis failed",
              output: [
                "Error: Could not read any of the specified files.",
                ...(errors.length > 0
                  ? ["", "Failed:", ...errors.map((p) => `  - ${p}`)]
                  : []),
              ].join("\n"),
              metadata: { error: "read_failed", failed: errors },
            };
          }

          // ── Phase 3: Call MiMo vision API ──────────────
          try {
            const response = await fetch(API_URL, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${API_KEY}`,
              },
              body: JSON.stringify({
                model: MODEL,
                messages: [
                  { role: "system", content: SYSTEM_PROMPT },
                  { role: "user", content },
                ],
                max_tokens: MAX_TOKENS,
                temperature: TEMPERATURE,
              }),
            });

            if (!response.ok) {
              const errText = await response.text().catch(() => "unknown");
              let reason = `Vision API returned status ${response.status}`;
              if (response.status === 429) {
                reason =
                  "Rate limited by the API. Please wait a moment and try again.";
              } else if (response.status >= 500) {
                reason = `Vision API server error (${response.status}). The API may be temporarily unavailable.`;
              }
              return {
                title: "Analysis failed",
                output: [
                  `Error: ${reason}`,
                  "",
                  response.status >= 400 && response.status < 500
                    ? `Details: ${errText}`
                    : "",
                ]
                  .filter(Boolean)
                  .join("\n"),
                metadata: { error: "api_error", status: response.status },
              };
            }

            const data = (await response.json()) as {
              choices?: Array<{ message?: { content?: string } }>;
            };
            const result = data.choices?.[0]?.message?.content?.trim();

            if (!result || result.length === 0) {
              return {
                title: "Analysis failed",
                output: "Error: The vision model returned an empty response.",
                metadata: { error: "empty_response" },
              };
            }

            // ── Phase 4: Build response ──────────────────
            const warning =
              errors.length > 0
                ? [
                    "",
                    "── WARNING ──────────────────────────────────",
                    `${errors.length} issue(s):`,
                    ...errors.map((p) => `  - ${p}`),
                    "────────────────────────────────────────────",
                  ].join("\n")
                : "";

            return {
              title: `Analyzed ${sources.length} file(s)`,
              output: result + warning,
              metadata: {
                file_count: sources.length,
                failed_count: errors.length,
                auto_detect,
                detail_level,
                model: MODEL,
              },
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              title: "Analysis failed",
              output: [
                "Error: Network request to vision API failed.",
                "",
                `Details: ${msg}`,
                "",
                "Check your network connection and try again.",
              ].join("\n"),
              metadata: { error: "network_error", details: msg },
            };
          }
        },
      }),
    },
  };
};