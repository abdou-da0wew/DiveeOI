export type RendererId = "static-svg" | "native-cairo" | "interactive-canvas" | "interactive-svg"
export type FeatureSupport = "supported" | "partial" | "unsupported"

export interface RendererCapability {
  id: RendererId
  label: string
  targets: string[]
  acceleration: "cpu"
  status: "available"
  features: string[]
  limitations: string[]
}

export interface FeatureCapability {
  id: string
  support: Record<RendererId, FeatureSupport>
  notes: string[]
}

export const COENX_VIDEO_CAPABILITIES = {
  schemaVersion: 1,
  composition: {
    version: 1,
    sharedAcrossOutputs: true,
    rule: "One validated serializable composition model is authoritative for every output backend.",
  },
  renderers: [
    {
      id: "static-svg",
      label: "Static SVG / ImageMagick / FFmpeg",
      targets: ["mp4"],
      acceleration: "cpu",
      status: "available",
      features: [
        "2d-shapes",
        "text",
        "images",
        "buttons",
        "inputs",
        "selects",
        "inline-paths",
        "reusable-paths",
        "clip-paths",
        "masks",
        "paint-resources",
        "filter-effects",
        "linear-gradients",
        "radial-gradients",
        "software-3d-projection",
        "animation",
        "scene-transitions",
        "audio",
      ],
      limitations: [
        "3D is CPU software projection; no GPU renderer, glTF, skeletal animation, full PBR or shadow maps.",
      ],
    },
    {
      id: "native-cairo",
      label: "Rust / Cairo / Pango / FFmpeg",
      targets: ["mp4"],
      acceleration: "cpu",
      status: "available",
      features: [
        "2d-shapes",
        "text",
        "images",
        "buttons",
        "inputs",
        "inline-paths",
        "reusable-paths",
        "clip-paths",
        "masks",
        "paint-resources",
        "filter-effects",
        "linear-gradients",
        "radial-gradients",
        "software-3d-projection",
        "animation",
        "scene-transitions",
        "audio",
      ],
      limitations: [
        "Select controls are not supported by the native renderer.",
        "3D is CPU software projection; no GPU renderer, glTF, skeletal animation, full PBR or shadow maps.",
      ],
    },
    {
      id: "interactive-canvas",
      label: "Interactive browser Canvas",
      targets: ["interactive"],
      acceleration: "cpu",
      status: "available",
      features: [
        "2d-shapes",
        "text",
        "images",
        "buttons",
        "inputs",
        "selects",
        "inline-paths",
        "reusable-paths",
        "clip-paths",
        "masks",
        "paint-resources",
        "filter-effects",
        "linear-gradients",
        "radial-gradients",
        "software-3d-projection",
        "animation",
        "scene-transitions",
        "interactions",
        "audio",
      ],
      limitations: [
        "3D is CPU software projection; no GPU 3D backend, glTF, skeletal animation, full PBR or shadow maps.",
      ],
    },
    {
      id: "interactive-svg",
      label: "Interactive browser SVG",
      targets: ["interactive"],
      acceleration: "cpu",
      status: "available",
      features: [
        "2d-shapes",
        "text",
        "images",
        "buttons",
        "inputs",
        "selects",
        "inline-paths",
        "reusable-paths",
        "clip-paths",
        "masks",
        "paint-resources",
        "filter-effects",
        "linear-gradients",
        "radial-gradients",
        "software-3d-projection",
        "animation",
        "scene-transitions",
        "interactions",
        "audio",
      ],
      limitations: [
        "3D is CPU software projection; no GPU 3D backend, glTF, skeletal animation, full PBR or shadow maps.",
      ],
    },
  ] satisfies RendererCapability[],
  features: [
    {
      id: "reusable-paths",
      support: {
        "static-svg": "supported",
        "native-cairo": "supported",
        "interactive-canvas": "supported",
        "interactive-svg": "supported",
      },
      notes: ["Scene path definitions have an explicit view box and scale into each referencing node's local bounds."],
    },
    {
      id: "clip-paths",
      support: {
        "static-svg": "supported",
        "native-cairo": "supported",
        "interactive-canvas": "supported",
        "interactive-svg": "supported",
      },
      notes: [
        "Node-local reusable clips support nonzero and evenodd fill rules.",
        "2D clip paths cannot currently be attached to mesh3d nodes.",
      ],
    },
    {
      id: "linear-gradients",
      support: {
        "static-svg": "supported",
        "native-cairo": "supported",
        "interactive-canvas": "supported",
        "interactive-svg": "supported",
      },
      notes: [
        "Spread modes (pad/repeat/reflect) and gradient transforms (rotate/translate/scale) are supported on static SVG, interactive SVG and native Cairo.",
        "The interactive Canvas backend implements transforms but only pad spread; repeat/reflect degrade to pad with a player warning (explicit partial capability).",
        "Conic gradients are not implemented.",
      ],
    },
    {
      id: "radial-gradients",
      support: {
        "static-svg": "supported",
        "native-cairo": "supported",
        "interactive-canvas": "supported",
        "interactive-svg": "supported",
      },
      notes: [
        "Spread modes and gradient transforms are supported on static SVG, interactive SVG and native Cairo.",
        "The interactive Canvas backend implements transforms but only pad spread (explicit partial capability).",
        "Conic gradients are not implemented.",
      ],
    },
    {
      id: "paint-resources",
      support: {
        "static-svg": "supported",
        "native-cairo": "supported",
        "interactive-canvas": "supported",
        "interactive-svg": "supported",
      },
      notes: ["Scene-level reusable gradient paints referenced with { paintRef }; nodes can also share CML <gradient> defs via fill=\"url(#id)\"."],
    },
    {
      id: "interactions",
      support: {
        "static-svg": "unsupported",
        "native-cairo": "unsupported",
        "interactive-canvas": "supported",
        "interactive-svg": "supported",
      },
      notes: [
        "Interactive triggers/state/branching run in the browser backends through the restricted interaction AST.",
        "MP4 backends render the timeline but never execute interaction logic.",
      ],
    },
    {
      id: "masks",
      support: {
        "static-svg": "supported",
        "native-cairo": "supported",
        "interactive-canvas": "supported",
        "interactive-svg": "supported",
      },
      notes: [
        "Reusable alpha masks (v1): flat shape lists (rect/ellipse/path with reusable path references); alpha comes from paint alpha only.",
        "Masks are node-local: the mask view box scales onto the node box, the node transform is inherited, and content outside the node box is hidden.",
        "Luminance masks are not implemented and stay capability-gated off.",
        "SVG backends emit white-with-alpha shapes so luminance and alpha mask semantics agree without mask-type support.",
        "Masked nodes composite inside a node-box-bounded offscreen on Canvas and native Cairo (bounded memory).",
      ],
    },
    {
      id: "filter-effects",
      support: {
        "static-svg": "supported",
        "native-cairo": "supported",
        "interactive-canvas": "partial",
        "interactive-svg": "supported",
      },
      notes: [
        "Bounded chain: blur, drop-shadow, color-adjust (brightness/contrast/saturate/hueRotate), grain and vignette; at most 4 effects per node.",
        "Effects apply to node content before clipping, masking and opacity, in chain order (SVG rendering model); grain and vignette are finishing layers applied last (grain alpha-composites noise over the node, vignette paints a radial edge-darkening overlay).",
        "Blur and shadow radii are Gaussian sigmas (CSS blur() semantics) so SVG, Canvas and native Cairo agree.",
        "Static/interactive SVG emit generated, scoped filter defs (feGaussianBlur/feDropShadow/feColorMatrix/feTurbulence grain) and radial-gradient vignette overlays; caller-provided SVG filters are never imported.",
        "Native Cairo rasterizes the node into a node-bounded padded offscreen and applies the same chain in pixels (grain is a deterministic per-seed splitmix noise pass, vignette a radial multiplier); the padded surface is capped at 8,388,608 pixels.",
        "Grain seeds are mixed per frame by the render pipeline so animated grain shimmers while staying reproducible.",
        "Interactive Canvas uses the CSS filter chain (feature-detected) plus built-in noise-tile grain and radial-gradient vignette overlays; when ctx.filter is unavailable the player warns via coenx:renderer-warning and renders without blur/shadow/color effects (explicit partial capability).",
        "mesh3d nodes cannot carry effects; effects are not animated (a blur radius change requires a new composition version).",
      ],
    },
    {
      id: "gpu-3d",
      support: {
        "static-svg": "unsupported",
        "native-cairo": "unsupported",
        "interactive-canvas": "unsupported",
        "interactive-svg": "unsupported",
      },
      notes: ["GPU acceleration is a planned backend milestone and must not be described as currently available."],
    },
  ] satisfies FeatureCapability[],
  authoring: {
    formats: [
      {
        id: "cml",
        supportedNodes: ["rect", "ellipse", "line", "path", "text", "image", "button", "input", "select"],
        unsupportedAuthoringFeatures: [
          "mesh3d",
          "gradient-transform-literals-in-nodes (use <defs><gradient> instead)",
        ],
      },
      {
        id: "json-typescript",
        supportedNodes: ["rect", "ellipse", "line", "path", "text", "image", "button", "input", "select", "mesh3d"],
        unsupportedAuthoringFeatures: ["luminance-masks", "gpu-3d"],
      },
    ],
    safety: [
      "CML script files compile to a restricted expression/action AST; they are not executed as JavaScript.",
      "Project source never uses eval, Function, arbitrary callbacks or unrestricted shader code.",
    ],
  },
  threeD: {
    current: {
      renderer: "software-projected-cpu",
      available: true,
      features: [
        "perspective-camera",
        "ambient-directional-point-lights",
        "flat-and-subdivided-smooth-shading",
        "diffuse-and-specular-material-response",
        "morph-targets",
        "frame-keyed-transforms",
        "deterministic-gravity-and-collision-simulation",
      ],
      limitations: [
        "No glTF loader or reusable hierarchical scene graph.",
        "No skeletal/skin animation, shadow mapping, texture/environment maps or full physically based BRDF pipeline.",
      ],
    },
    gpu: {
      status: "planned",
      browser: "Three.js with WebGL2 as the initial GPU backend; WebGPU is optional and capability-detected.",
      native: "Rust wgpu offscreen rendering, capability-detected across available platform adapters.",
      sharedContract:
        "Both GPU backends will consume the same validated 3D scene contract and evaluated timeline poses.",
    },
    cpuFallback: {
      available: true,
      deterministic: true,
      policy:
        "Use the current CPU renderer whenever a GPU backend is unavailable, disabled, incompatible, headless, out of memory or loses its device/context.",
    },
  },
} as const
