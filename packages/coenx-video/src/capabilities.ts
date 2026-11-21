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
      notes: ["Gradient transforms, conic gradients and repeat/reflect spread modes are not implemented."],
    },
    {
      id: "radial-gradients",
      support: {
        "static-svg": "supported",
        "native-cairo": "supported",
        "interactive-canvas": "supported",
        "interactive-svg": "supported",
      },
      notes: ["Gradient transforms, conic gradients and repeat/reflect spread modes are not implemented."],
    },
    {
      id: "masks",
      support: {
        "static-svg": "unsupported",
        "native-cairo": "unsupported",
        "interactive-canvas": "unsupported",
        "interactive-svg": "unsupported",
      },
      notes: ["Alpha and luminance masks have not been implemented."],
    },
    {
      id: "filter-effects",
      support: {
        "static-svg": "unsupported",
        "native-cairo": "unsupported",
        "interactive-canvas": "unsupported",
        "interactive-svg": "unsupported",
      },
      notes: ["A bounded shared filter graph for blur, shadow and color adjustment is planned but not implemented."],
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
        supportedNodes: ["rect", "ellipse", "line", "text", "image", "button", "input", "select"],
        unsupportedAuthoringFeatures: [
          "path-commands",
          "reusable-paths",
          "clip-paths",
          "gradient-paint-literals",
          "mesh3d",
        ],
      },
      {
        id: "json-typescript",
        supportedNodes: ["rect", "ellipse", "line", "path", "text", "image", "button", "input", "select", "mesh3d"],
        unsupportedAuthoringFeatures: ["masks", "filter-effects", "gpu-3d"],
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
