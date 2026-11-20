import { describe, expect, test } from "bun:test"
import { parseChatUISpec } from "../src/chat-ui-parse"
import { parseExamDraft } from "../src/exam-parse"

describe("Chat UI protocol", () => {
  test("accepts bounded charts, tables and a live simulation", () => {
    const result = parseChatUISpec(
      {
        title: "Ohm's law",
        layout: "grid",
        components: [
          { type: "heading", text: "Explore current", level: 2 },
          {
            type: "chart",
            title: "Voltage",
            kind: "line",
            points: [
              { label: "1 V", value: 0.1 },
              { label: "2 V", value: 0.2 },
            ],
          },
          {
            type: "simulation",
            title: "Ohm's law simulator",
            controls: [
              { type: "slider", id: "voltage", label: "Voltage", min: 0, max: 24, step: 0.5, value: 12, unit: "V" },
            ],
            outputs: [
              {
                label: "Current",
                unit: "A",
                precision: 2,
                expression: {
                  op: "div",
                  left: { op: "input", name: "voltage" },
                  right: { op: "literal", value: 60 },
                },
              },
            ],
          },
          {
            type: "table",
            title: "Reference",
            columns: ["V", "I"],
            rows: [[12, 0.2]],
          },
        ],
      },
      "ui-1",
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.id).toBe("ui-1")
    expect(result.value.components).toHaveLength(4)
    expect(result.value.components[2]?.type).toBe("simulation")
  })

  test("accepts all eight advanced interactive component types", () => {
    const result = parseChatUISpec(
      {
        title: "Interactive systems showcase",
        components: [
          {
            type: "workflow",
            title: "Pipeline",
            nodes: [
              { id: "start", label: "Start", kind: "trigger" },
              { id: "finish", label: "Finish", kind: "output" },
            ],
          },
          {
            type: "desktop",
            title: "Desktop",
            apps: [
              { id: "home", name: "Home", icon: "house", content: "Welcome" },
              { id: "files", name: "Files", icon: "folder", content: "Documents" },
            ],
          },
          {
            type: "database",
            title: "Records",
            columns: ["id", "name"],
            rows: [
              [1, "Ada"],
              [2, "Grace"],
            ],
          },
          {
            type: "api",
            title: "API client",
            methods: ["GET", "POST"],
            endpoint: "/api/models",
            sampleStatus: 200,
            sampleResponse: '{"ok":true}',
          },
          { type: "scene", title: "Viewport", shape: "cube", rotation: 45 },
          {
            type: "wizard",
            title: "Setup",
            steps: [
              { title: "Name", description: "Choose a name", fieldLabel: "Project" },
              { title: "Review", description: "Review settings", fieldLabel: "Confirm" },
            ],
          },
          { type: "monitor", title: "Metrics", metrics: [{ label: "CPU", value: 24, unit: "%" }] },
          { type: "circuit", title: "Ohm's law", voltage: 9, resistance: 100 },
        ],
      },
      "advanced-ui",
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.components.map((component) => component.type)).toEqual([
      "workflow",
      "desktop",
      "database",
      "api",
      "scene",
      "wizard",
      "monitor",
      "circuit",
    ])
  })

  test("rejects malformed advanced component data and duplicate IDs", () => {
    const duplicate = parseChatUISpec(
      {
        title: "Invalid workflow",
        components: [
          {
            type: "workflow",
            title: "Pipeline",
            nodes: [
              { id: "same", label: "Start", kind: "trigger" },
              { id: "same", label: "End", kind: "output" },
            ],
          },
        ],
      },
      "invalid-workflow",
    )
    expect(duplicate).toEqual({ ok: false, error: "Workflow node IDs must be unique" })

    const invalidDatabase = parseChatUISpec(
      {
        title: "Invalid database",
        components: [{ type: "database", title: "Records", columns: ["id", "name"], rows: [[1]] }],
      },
      "invalid-database",
    )
    expect(invalidDatabase).toEqual({ ok: false, error: "Database rows must match the column count" })
  })

  test("composes nested layouts with shared state and deterministic actions", () => {
    const result = parseChatUISpec(
      {
        title: "Config builder",
        state: [
          { key: "projectName", value: "DiveeOI" },
          { key: "enabled", value: true },
          { key: "workers", value: 2 },
          { key: "environment", value: "dev" },
        ],
        components: [
          {
            type: "tabs",
            id: "workspaceTabs",
            title: "Workspace",
            tabs: [
              {
                id: "general",
                label: "General",
                components: [
                  {
                    type: "group",
                    id: "identity",
                    layout: "stack",
                    title: "Identity",
                    components: [
                      { type: "field", id: "projectField", key: "projectName", label: "Project name", control: "text" },
                      { type: "field", id: "enabledField", key: "enabled", label: "Enabled", control: "toggle" },
                      { type: "state-value", key: "projectName", label: "Current project" },
                      {
                        type: "conditional",
                        id: "enabledDetails",
                        key: "enabled",
                        equals: true,
                        components: [{ type: "text", content: "Feature is enabled." }],
                      },
                    ],
                  },
                ],
              },
              {
                id: "runtime",
                label: "Runtime",
                components: [
                  {
                    type: "field",
                    id: "envField",
                    key: "environment",
                    label: "Environment",
                    control: "select",
                    options: [
                      { label: "Development", value: "dev" },
                      { label: "Production", value: "prod" },
                    ],
                  },
                  { type: "state-value", key: "workers", label: "Worker count" },
                  {
                    type: "computed",
                    id: "workerCapacity",
                    label: "Worker capacity",
                    unit: " jobs/s",
                    precision: 1,
                    expression: {
                      op: "mul",
                      left: { op: "input", name: "workers" },
                      right: { op: "literal", value: 120 },
                    },
                  },
                  {
                    type: "button",
                    id: "addWorker",
                    label: "Add worker",
                    actions: [{ type: "increment", key: "workers", by: 1 }],
                  },
                  {
                    type: "button",
                    id: "toggleFeature",
                    label: "Toggle feature",
                    variant: "secondary",
                    actions: [{ type: "toggle", key: "enabled" }],
                  },
                ],
              },
            ],
          },
        ],
      },
      "composed-ui",
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.state).toHaveLength(4)
    expect(result.value.components[0]?.type).toBe("tabs")
  })

  test("rejects undeclared state, invalid action types, and duplicate component IDs", () => {
    const missingState = parseChatUISpec(
      {
        title: "Broken",
        components: [{ type: "field", id: "name", key: "missing", label: "Name", control: "text" }],
      },
      "missing-state",
    )
    expect(missingState).toEqual({ ok: false, error: "Component references undeclared state key: missing" })

    const duplicate = parseChatUISpec(
      {
        title: "Duplicate IDs",
        state: [{ key: "count", value: 0 }],
        components: [
          { type: "button", id: "same", label: "One", actions: [{ type: "increment", key: "count", by: 1 }] },
          { type: "button", id: "same", label: "Two", actions: [{ type: "increment", key: "count", by: 1 }] },
        ],
      },
      "duplicate-ids",
    )
    expect(duplicate).toEqual({ ok: false, error: "Component IDs must be unique: same" })

    const typeMismatch = parseChatUISpec(
      {
        title: "Bad action",
        state: [{ key: "enabled", value: true }],
        components: [
          { type: "button", id: "badSet", label: "Set", actions: [{ type: "set", key: "enabled", value: "yes" }] },
        ],
      },
      "action-type",
    )
    expect(typeMismatch).toEqual({ ok: false, error: "Set action must preserve the state type: enabled" })

    const computedMissingState = parseChatUISpec(
      {
        title: "Bad computed value",
        state: [{ key: "workers", value: 2 }],
        components: [
          {
            type: "computed",
            id: "capacity",
            label: "Capacity",
            expression: { op: "input", name: "unknown" },
          },
        ],
      },
      "computed-missing-state",
    )
    expect(computedMissingState).toEqual({
      ok: false,
      error: "Computed value references undeclared state key: unknown",
    })
  })

  test("rejects unknown components and out-of-range controls", () => {
    const unknown = parseChatUISpec({ title: "Bad", components: [{ type: "script", code: "alert(1)" }] }, "ui-2")
    expect(unknown).toEqual({ ok: false, error: "Unsupported UI component type: script" })

    const invalid = parseChatUISpec(
      {
        title: "Bad slider",
        components: [
          {
            type: "simulation",
            title: "Invalid",
            controls: [{ type: "slider", id: "speed", label: "Speed", min: 10, max: 20, step: 1, value: 30 }],
            outputs: [{ label: "Result", expression: { op: "literal", value: 1 } }],
          },
        ],
      },
      "ui-3",
    )
    expect(invalid.ok).toBe(false)
  })

  test("rejects over-deep expression trees and unknown inputs", () => {
    const deep = { op: "literal", value: 1 } as Record<string, unknown>
    let expression: Record<string, unknown> = deep
    for (let i = 0; i < 10; i++) expression = { op: "abs", value: expression }

    const result = parseChatUISpec(
      {
        title: "Bad simulation",
        components: [
          {
            type: "simulation",
            title: "Unsafe depth",
            controls: [{ type: "toggle", id: "enabled", label: "Enabled", value: true }],
            outputs: [{ label: "Result", expression }],
          },
        ],
      },
      "ui-4",
    )
    expect(result.ok).toBe(false)

    const unknownInput = parseChatUISpec(
      {
        title: "Missing control",
        components: [
          {
            type: "simulation",
            title: "Invalid reference",
            controls: [{ type: "toggle", id: "enabled", label: "Enabled", value: true }],
            outputs: [{ label: "Result", expression: { op: "input", name: "missing" } }],
          },
        ],
      },
      "ui-5",
    )
    expect(unknownInput).toEqual({
      ok: false,
      error: "Simulation output references unknown control: missing",
    })
  })
})

describe("Exam protocol", () => {
  test("accepts objective, written and interactive questions", () => {
    const result = parseExamDraft(
      {
        title: "Integrated Science review",
        instructions: "Answer every question.",
        durationMinutes: 25,
        questions: [
          {
            id: "q1",
            type: "single",
            prompt: "Which material conducts electricity?",
            options: [
              { id: "copper", label: "Copper" },
              { id: "rubber", label: "Rubber" },
            ],
            points: 2,
          },
          {
            id: "q2",
            type: "multiple",
            prompt: "Select the states of matter.",
            options: [
              { id: "solid", label: "Solid" },
              { id: "liquid", label: "Liquid" },
              { id: "plasma", label: "Plasma" },
            ],
          },
          { id: "q3", type: "boolean", prompt: "Energy can be transferred.", points: 1.5 },
          {
            id: "q4",
            type: "short",
            prompt: "Explain why resistance changes current.",
            state: [{ key: "resistancePreset", value: 5 }],
            components: [
              { type: "state-value", key: "resistancePreset", label: "Starting resistance", unit: " Ω" },
              {
                type: "simulation",
                title: "Experiment",
                controls: [
                  { type: "slider", id: "resistance", label: "Resistance", min: 1, max: 10, step: 1, value: 5 },
                ],
                outputs: [
                  {
                    label: "Current",
                    expression: {
                      op: "div",
                      left: { op: "literal", value: 12 },
                      right: { op: "input", name: "resistance" },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      "exam-1",
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.questions).toHaveLength(4)
    expect(result.value.totalPoints).toBe(5.5)
    expect(result.value.questions[3]?.components?.[0]?.type).toBe("state-value")
    expect(result.value.questions[3]?.state).toEqual([{ key: "resistancePreset", value: 5 }])
  })

  test("rejects duplicate question IDs and incomplete choices", () => {
    const duplicate = parseExamDraft(
      {
        title: "Duplicate",
        questions: [
          { id: "q1", type: "short", prompt: "First" },
          { id: "q1", type: "short", prompt: "Second" },
        ],
      },
      "exam-2",
    )
    expect(duplicate).toEqual({ ok: false, error: "Question IDs must be unique" })

    const options = parseExamDraft(
      { title: "Missing options", questions: [{ id: "q1", type: "single", prompt: "Pick one" }] },
      "exam-3",
    )
    expect(options.ok).toBe(false)
  })
  test("supports opt-in session persistence and safe form submission", () => {
    const result = parseChatUISpec(
      {
        title: "Deployment settings",
        persistState: true,
        state: [
          { key: "region", value: "eu-west" },
          { key: "replicas", value: 2 },
        ],
        components: [
          { type: "field", id: "regionField", key: "region", label: "Region", control: "text" },
          { type: "field", id: "replicasField", key: "replicas", label: "Replicas", control: "number" },
          { type: "button", id: "submit", label: "Review deployment", actions: [{ type: "submit" }] },
        ],
      },
      "deployment-ui",
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.persistState).toBe(true)
    expect(result.value.components[2]).toMatchObject({
      type: "button",
      actions: [{ type: "submit" }],
    })
  })

  test("rejects malformed submit actions and non-boolean persistence flags", () => {
    const action = parseChatUISpec(
      {
        title: "Invalid submit",
        components: [
          { type: "button", id: "submit", label: "Submit", actions: [{ type: "submit", url: "https://example.com" }] },
        ],
      },
      "invalid-submit",
    )
    expect(action).toEqual({ ok: false, error: "Submit actions do not accept extra properties" })

    const persistence = parseChatUISpec(
      { title: "Invalid persistence", persistState: "yes", components: [{ type: "text", content: "Hello" }] },
      "invalid-persistence",
    )
    expect(persistence).toEqual({ ok: false, error: "persistState must be a boolean" })
  })
  test("supports validated file uploads, field constraints, and shared-tab navigation", () => {
    const result = parseChatUISpec(
      {
        title: "Profile editor",
        state: [
          { key: "name", value: "Ada" },
          { key: "attachmentList", value: "[]" },
          { key: "panel", value: "general" },
          { key: "environment", value: "dev" },
        ],
        components: [
          {
            type: "tabs",
            id: "settingsTabs",
            key: "panel",
            tabs: [
              { id: "general", label: "General", components: [{ type: "text", content: "Profile" }] },
              { id: "advanced", label: "Advanced", components: [{ type: "text", content: "Advanced settings" }] },
            ],
          },
          {
            type: "field",
            id: "nameField",
            key: "name",
            label: "Name",
            control: "text",
            required: true,
            minLength: 2,
            maxLength: 32,
            pattern: "^[A-Za-z ]+$",
            helpText: "Use your display name.",
          },
          {
            type: "file-upload",
            id: "profileFile",
            key: "attachmentList",
            label: "Profile attachment",
            accept: ["image/png", "application/pdf"],
            multiple: true,
            maxSizeMB: 6,
            required: false,
          },
          {
            type: "button",
            id: "goAdvanced",
            label: "Open advanced settings",
            actions: [
              { type: "filter", key: "environment", value: "prod" },
              { type: "navigate", key: "panel", target: "advanced" },
              { type: "refresh" },
            ],
          },
        ],
      },
      "validated-profile",
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.components.map((component) => component.type)).toEqual([
      "tabs",
      "field",
      "file-upload",
      "button",
    ])
    expect(result.value.components[1]).toMatchObject({ required: true, minLength: 2, maxLength: 32 })
    expect(result.value.components[2]).toMatchObject({ type: "file-upload", maxSizeMB: 6 })
  })

  test("supports maps, editable grids, and safe remote media", () => {
    const result = parseChatUISpec(
      {
        title: "Field inspection",
        state: [
          {
            key: "records",
            value: JSON.stringify([
              ["A", 12],
              ["B", 18],
            ]),
          },
        ],
        components: [
          {
            type: "map",
            title: "Inspection sites",
            center: { latitude: 29.85, longitude: 31.25 },
            zoom: 12,
            markers: [{ id: "siteA", label: "Site A", latitude: 29.86, longitude: 31.26 }],
          },
          {
            type: "data-grid",
            id: "inspectionGrid",
            title: "Measurements",
            key: "records",
            editable: true,
            maxRows: 20,
            columns: [
              { id: "site", label: "Site", type: "text" },
              { id: "reading", label: "Reading", type: "number" },
            ],
            rows: [
              ["A", 12],
              ["B", 18],
            ],
          },
          {
            type: "media",
            title: "Reference media",
            items: [{ type: "image", url: "https://cdn.example.test/site-a.png", alt: "Site A" }],
          },
        ],
      },
      "field-inspection",
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.components.map((component) => component.type)).toEqual(["map", "data-grid", "media"])
  })

  test("rejects unsafe media URLs, invalid upload MIME types, and invalid grid state", () => {
    const unsafeMedia = parseChatUISpec(
      {
        title: "Unsafe media",
        components: [{ type: "media", title: "Preview", items: [{ type: "image", url: "javascript:alert(1)" }] }],
      },
      "unsafe-media",
    )
    expect(unsafeMedia.ok).toBe(false)

    const privateMedia = parseChatUISpec(
      {
        title: "Private media",
        components: [
          { type: "media", title: "Preview", items: [{ type: "image", url: "https://127.0.0.1/private.png" }] },
        ],
      },
      "private-media",
    )
    expect(privateMedia.ok).toBe(false)

    const unsafeUpload = parseChatUISpec(
      {
        title: "Unsafe upload",
        state: [{ key: "files", value: "[]" }],
        components: [{ type: "file-upload", id: "upload", key: "files", label: "File", accept: ["text/html"] }],
      },
      "unsafe-upload",
    )
    expect(unsafeUpload).toEqual({ ok: false, error: "file-upload.accept contains an unsupported type" })

    const badGrid = parseChatUISpec(
      {
        title: "Invalid grid",
        state: [{ key: "rows", value: JSON.stringify([["text", "not-a-number"]]) }],
        components: [
          {
            type: "data-grid",
            id: "grid",
            title: "Records",
            key: "rows",
            columns: [
              { id: "name", label: "Name", type: "text" },
              { id: "value", label: "Value", type: "number" },
            ],
            rows: [["A", 1]],
            editable: true,
          },
        ],
      },
      "invalid-grid",
    )
    expect(badGrid).toEqual({ ok: false, error: "Data grid grid number cells are invalid" })
  })

  test("randomizes exam question order once and preserves every question", () => {
    const source = ["q1", "q2", "q3", "q4"]
    const result = parseExamDraft(
      {
        title: "Randomized practice",
        randomizeQuestions: true,
        questions: source.map((id) => ({ id, type: "short", prompt: `Question ${id}` })),
      },
      "randomized-exam",
      () => 0,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.questions.map((question) => question.id)).toEqual(["q2", "q3", "q4", "q1"])
    expect([...result.value.questions.map((question) => question.id)].sort()).toEqual(source)
  })

  test("does not shuffle a normalized randomized exam during restore or grading parse", () => {
    const first = parseExamDraft(
      {
        title: "One-time randomization",
        randomizeQuestions: true,
        questions: ["q1", "q2", "q3", "q4"].map((id) => ({ id, type: "short", prompt: `Question ${id}` })),
      },
      "stable-random-order",
      () => 0,
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const originalOrder = first.value.questions.map((question) => question.id)
    const restored = parseExamDraft(first.value, first.value.id, () => 0.999999, { randomize: false })
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.value.questions.map((question) => question.id)).toEqual(originalOrder)
  })

  test("rejects non-boolean exam randomization settings", () => {
    const result = parseExamDraft(
      {
        title: "Invalid randomized exam",
        randomizeQuestions: "yes",
        questions: [{ id: "q1", type: "short", prompt: "Answer" }],
      },
      "invalid-randomized-exam",
    )
    expect(result).toEqual({ ok: false, error: "randomizeQuestions must be a boolean" })
  })
})

describe("Rich UI layout and learning components", () => {
  test("defaults to auto layout and supports hybrid and explicit manual layout", () => {
    const automatic = parseChatUISpec({ title: "Auto", components: [{ type: "text", content: "Responsive" }] }, "auto-ui")
    expect(automatic.ok).toBe(true)
    if (automatic.ok) {
      expect(automatic.value.layoutMode).toBe("auto")
      expect(automatic.value.layout).toBeUndefined()
    }

    const hybrid = parseChatUISpec({
      title: "Hybrid",
      layoutMode: "hybrid",
      layout: "grid",
      components: [{ type: "heading", text: "Overview", level: 2 }],
    }, "hybrid-ui")
    expect(hybrid.ok).toBe(true)
    if (hybrid.ok) {
      expect(hybrid.value.layoutMode).toBe("hybrid")
      expect(hybrid.value.layout).toBe("grid")
    }

    const manualWithoutLayout = parseChatUISpec({
      title: "Manual",
      layoutMode: "manual",
      components: [{ type: "text", content: "Explicit layout required" }],
    }, "manual-ui")
    expect(manualWithoutLayout).toEqual({ ok: false, error: "Manual layout mode requires an explicit root layout" })

    const automaticGroup = parseChatUISpec({
      title: "Automatic group",
      layoutMode: "auto",
      components: [{
        type: "group",
        id: "responsive-group",
        components: [{ type: "text", content: "Renderer decides" }],
      }],
    }, "automatic-group")
    expect(automaticGroup.ok).toBe(true)
    if (automaticGroup.ok) {
      const group = automaticGroup.value.components[0]
      expect(group?.type === "group" ? group.layout : "not-a-group").toBeUndefined()
    }

    const manualGroupWithoutLayout = parseChatUISpec({
      title: "Manual group",
      layoutMode: "manual",
      layout: "grid",
      components: [{
        type: "group",
        id: "missing-group-layout",
        components: [{ type: "text", content: "Must choose" }],
      }],
    }, "manual-group")
    expect(manualGroupWithoutLayout).toEqual({
      ok: false,
      error: "Manual layout mode requires an explicit layout for group: missing-group-layout",
    })
  })

  test("parses interactive quiz, clickable diagram, and declared state-bound chart data", () => {
    const result = parseChatUISpec({
      title: "Water cycle lab",
      layoutMode: "auto",
      state: [{ key: "evaporation", value: 30 }, { key: "condensation", value: 20 }],
      components: [
        {
          type: "chart",
          title: "Water movement",
          kind: "line",
          points: [
            { label: "Evaporation", key: "evaporation" },
            { label: "Condensation", key: "condensation" },
          ],
        },
        {
          type: "quiz",
          title: "Check your understanding",
          questions: [{
            id: "cycle-q1",
            prompt: "What forms clouds?",
            options: [{ id: "heat", label: "Heating" }, { id: "cool", label: "Cooling water vapor" }],
            correctOptionIds: ["cool"],
            explanation: "Cooling causes water vapor to condense into tiny droplets.",
          }],
        },
        {
          type: "diagram",
          title: "Water cycle",
          direction: "left-right",
          nodes: [
            { id: "evap", label: "Evaporation", detail: "Liquid water becomes vapor", kind: "process" },
            { id: "cloud", label: "Condensation", kind: "process" },
            { id: "rain", label: "Precipitation", kind: "output" },
          ],
          edges: [{ from: "evap", to: "cloud" }, { from: "cloud", to: "rain", label: "droplets grow" }],
        },
        { type: "divider", label: "Practice", style: "dashed" },
        {
          type: "group",
          id: "details",
          layout: "grid",
          surface: "subtle",
          separator: "between",
          gap: "relaxed",
          components: [{ type: "metric", label: "Evaporation", value: 30 }],
        },
      ],
    }, "water-lab")

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.components.map((component) => component.type)).toEqual([
      "chart", "quiz", "diagram", "divider", "group",
    ])
  })

  test("rejects invalid quiz answer references, diagram connections, and non-numeric chart bindings", () => {
    const invalidQuiz = parseChatUISpec({
      title: "Invalid quiz",
      components: [{
        type: "quiz",
        title: "Question",
        questions: [{
          id: "q1",
          prompt: "Pick one",
          options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
          correctOptionIds: ["missing"],
        }],
      }],
    }, "bad-quiz")
    expect(invalidQuiz).toEqual({ ok: false, error: "Quiz answer references unknown option: missing" })

    const invalidDiagram = parseChatUISpec({
      title: "Invalid diagram",
      components: [{
        type: "diagram",
        title: "Flow",
        nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
        edges: [{ from: "a", to: "missing" }],
      }],
    }, "bad-diagram")
    expect(invalidDiagram).toEqual({ ok: false, error: "Diagram connections must link two different declared nodes" })

    const invalidChartBinding = parseChatUISpec({
      title: "Invalid live chart",
      state: [{ key: "label", value: "not numeric" }],
      components: [{
        type: "chart",
        title: "Bound data",
        kind: "bar",
        points: [{ label: "A", key: "label" }, { label: "B", value: 4 }],
      }],
    }, "bad-live-chart")
    expect(invalidChartBinding).toEqual({ ok: false, error: "Chart data binding must reference numeric state: label" })
  })
})

describe("Rich UI platformer component", () => {
  const level = {
    type: "platformer",
    title: "Neon Runner",
    description: "Collect the crystals and reach the flag.",
    theme: "neon",
    width: 800,
    height: 450,
    player: { x: 20, y: 328, width: 24, height: 32 },
    platforms: [
      { id: "ground", x: 0, y: 360, width: 800, height: 90 },
      { id: "ledge", x: 300, y: 260, width: 120, height: 24 },
    ],
    hazards: [{ id: "spikes", x: 440, y: 340, width: 36, height: 20 }],
    collectibles: [{ id: "crystal-1", x: 120, y: 344 }],
    checkpoints: [{ id: "checkpoint-1", x: 520, y: 360 }],
    goal: { x: 740, y: 300, width: 24, height: 60 },
    physics: { moveSpeed: 5.2, gravity: 0.82, jumpVelocity: 14.5, maxLives: 3, doubleJump: true, dash: true },
  }

  test("accepts a bounded platformer with physics and level entities", () => {
    const result = parseChatUISpec({ title: "Game", components: [level] }, "game-ui")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const game = result.value.components[0]
    expect(game?.type).toBe("platformer")
    if (game?.type === "platformer") {
      expect(game.physics.doubleJump).toBe(true)
      expect(game.platforms).toHaveLength(2)
      expect(game.collectibles).toHaveLength(1)
    }
  })

  test("rejects geometry outside the world and non-integer life counts", () => {
    const outOfBounds = parseChatUISpec({
      title: "Bad level",
      components: [{ ...level, platforms: [{ id: "bad", x: 790, y: 360, width: 40, height: 20 }] }],
    }, "bad-level")
    expect(outOfBounds).toEqual({ ok: false, error: "platformer.platforms[0] must fit inside the world bounds" })

    const invalidLives = parseChatUISpec({
      title: "Bad physics",
      components: [{ ...level, physics: { ...level.physics, maxLives: 2.5 } }],
    }, "bad-physics")
    expect(invalidLives).toEqual({ ok: false, error: "platformer.physics.maxLives must be an integer" })
  })
})

describe("Exam supplemental Rich UI safety", () => {
  test("rejects self-grading quiz components that would expose answer IDs in a graded exam", () => {
    const result = parseExamDraft({
      title: "Secure exam",
      questions: [{
        id: "q1",
        type: "single",
        prompt: "Select one answer.",
        options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
        components: [{
          type: "group",
          id: "nested-material",
          layout: "stack",
          components: [{
            type: "quiz",
            title: "Leaking answer key",
            questions: [{
              id: "quiz-q1",
              prompt: "Which option is correct?",
              options: [{ id: "secret-a", label: "A" }, { id: "secret-b", label: "B" }],
              correctOptionIds: ["secret-a"],
            }],
          }],
        }],
      }],
      answerKey: [{ questionId: "q1", correctOptionIDs: ["a"] }],
    }, "secure-exam")

    expect(result).toEqual({
      ok: false,
      error: "Question q1 cannot include a self-grading quiz in exam material; use the exam question and private answerKey instead",
    })
  })
})
