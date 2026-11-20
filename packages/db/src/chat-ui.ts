export * as ChatUI from "./chat-ui"

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

export type NumericExpression =
  | { op: "literal"; value: number }
  | { op: "input"; name: string }
  | { op: "neg" | "abs" | "sqrt"; value: NumericExpression }
  | { op: "add" | "sub" | "mul" | "div" | "pow" | "min" | "max"; left: NumericExpression; right: NumericExpression }

export type ChatUIControl =
  | { type: "slider"; id: string; label: string; min: number; max: number; step: number; value: number; unit?: string }
  | { type: "toggle"; id: string; label: string; value: boolean }
  | { type: "select"; id: string; label: string; value: string; options: Array<{ label: string; value: string }> }

export type ChatUIAdvancedComponent =
  | {
      type: "workflow"
      title: string
      nodes: Array<{ id: string; label: string; kind: "trigger" | "process" | "condition" | "output" }>
    }
  | { type: "desktop"; title: string; apps: Array<{ id: string; name: string; icon: string; content: string }> }
  | { type: "database"; title: string; columns: string[]; rows: Array<Array<string | number>> }
  | {
      type: "api"
      title: string
      methods: Array<"GET" | "POST" | "PUT" | "PATCH" | "DELETE">
      endpoint: string
      sampleStatus: number
      sampleResponse: string
    }
  | { type: "scene"; title: string; shape: "cube" | "sphere" | "pyramid"; rotation: number; description?: string }
  | {
      type: "wizard"
      title: string
      steps: Array<{ title: string; description: string; fieldLabel: string; placeholder?: string }>
    }
  | { type: "monitor"; title: string; metrics: Array<{ label: string; value: number; unit?: string }> }
  | { type: "circuit"; title: string; voltage: number; resistance: number }
  | {
      type: "map"
      title: string
      center: { latitude: number; longitude: number }
      zoom: number
      markers: Array<{ id: string; label: string; latitude: number; longitude: number; description?: string }>
    }
  | {
      type: "data-grid"
      id: string
      title: string
      key: string
      columns: Array<{ id: string; label: string; type: "text" | "number" }>
      rows: Array<Array<string | number>>
      editable: boolean
      maxRows: number
    }
  | {
      type: "media"
      title: string
      items: Array<{ type: "image" | "video" | "audio"; url: string; alt?: string; caption?: string }>
    }

export type ChatUIStateValue = string | number | boolean
export type ChatUILayoutMode = "auto" | "hybrid" | "manual"
export type ChatUILayout = "stack" | "grid"
export type ChatUISurface = "none" | "subtle" | "outlined"
export type ChatUISeparator = "none" | "top" | "bottom" | "between"
export type ChatUIGap = "tight" | "normal" | "relaxed"

export type ChatUIPlatformerComponent = {
  type: "platformer"
  title: string
  description?: string
  theme: "neon" | "sky" | "forest"
  width: number
  height: number
  player: { x: number; y: number; width: number; height: number }
  platforms: Array<{ id: string; x: number; y: number; width: number; height: number }>
  hazards: Array<{ id: string; x: number; y: number; width: number; height: number }>
  collectibles: Array<{ id: string; x: number; y: number }>
  checkpoints: Array<{ id: string; x: number; y: number }>
  goal: { x: number; y: number; width: number; height: number }
  physics: {
    moveSpeed: number
    gravity: number
    jumpVelocity: number
    maxLives: number
    doubleJump: boolean
    dash: boolean
  }
}

export type ChatUIQuizComponent = {
  type: "quiz"
  title: string
  description?: string
  questions: Array<{
    id: string
    prompt: string
    selection: "single" | "multiple"
    options: Array<{ id: string; label: string }>
    correctOptionIds: string[]
    explanation?: string
  }>
}

export type ChatUIDiagramComponent = {
  type: "diagram"
  title: string
  description?: string
  direction: "left-right" | "top-down"
  nodes: Array<{
    id: string
    label: string
    detail?: string
    kind: "start" | "process" | "decision" | "output"
  }>
  edges: Array<{ from: string; to: string; label?: string }>
}

export type ChatUILearningComponent = ChatUIQuizComponent | ChatUIDiagramComponent

export type ChatUIAction =
  | { type: "set"; key: string; value: ChatUIStateValue }
  | { type: "toggle"; key: string }
  | { type: "increment"; key: string; by: number }
  | { type: "submit" }
  | { type: "refresh" }
  | { type: "filter"; key: string; value: ChatUIStateValue }
  | { type: "navigate"; key: string; target: string }

export type ChatUIComponent =
  | ChatUIAdvancedComponent
  | {
      type: "group"
      id: string
      title?: string
      layout?: "stack" | "row" | "grid"
      surface?: ChatUISurface
      separator?: ChatUISeparator
      gap?: ChatUIGap
      components: ChatUIComponent[]
    }
  | {
      type: "tabs"
      id: string
      title?: string
      tabs: Array<{ id: string; label: string; components: ChatUIComponent[] }>
      key?: string
      surface?: ChatUISurface
    }
  | { type: "conditional"; id: string; key: string; equals: ChatUIStateValue; components: ChatUIComponent[] }
  | {
      type: "field"
      id: string
      key: string
      label: string
      control: "text" | "number" | "toggle" | "select"
      placeholder?: string
      options?: Array<{ label: string; value: string }>
      required?: boolean
      minLength?: number
      maxLength?: number
      min?: number
      max?: number
      pattern?: string
      helpText?: string
    }
  | { type: "button"; id: string; label: string; variant?: "primary" | "secondary"; actions: ChatUIAction[] }
  | {
      type: "file-upload"
      id: string
      key: string
      label: string
      accept: string[]
      multiple: boolean
      maxSizeMB: number
      required: boolean
      helpText?: string
    }
  | { type: "state-value"; key: string; label: string; unit?: string }
  | { type: "computed"; id: string; label: string; expression: NumericExpression; unit?: string; precision: number }
  | { type: "divider"; label?: string; style: "solid" | "dashed" }
  | { type: "heading"; text: string; level: 2 | 3 }
  | { type: "text"; content: string }
  | { type: "metric"; label: string; value: string | number; unit?: string; tone?: "default" | "positive" | "warning" }
  | { type: "callout"; title: string; content: string; tone: "info" | "success" | "warning" }
  | { type: "progress"; label: string; value: number; max: number; unit?: string }
  | {
      type: "chart"
      title: string
      kind: "bar" | "line"
      points: Array<{ label: string; value: number } | { label: string; key: string }>
    }
  | ChatUILearningComponent
  | ChatUIPlatformerComponent
  | { type: "table"; title?: string; columns: string[]; rows: Array<Array<string | number>> }
  | {
      type: "simulation"
      title: string
      description?: string
      controls: ChatUIControl[]
      outputs: Array<{ label: string; expression: NumericExpression; unit?: string; precision?: number }>
    }

export type ChatUISpec = {
  id: string
  version: 1
  title: string
  description?: string
  layoutMode: ChatUILayoutMode
  layout?: ChatUILayout
  /** Persist non-sensitive state in the current browser profile, scoped to this session and UI. */
  persistState?: boolean
  state?: Array<{ key: string; value: ChatUIStateValue }>
  components: ChatUIComponent[]
}

export type ExamQuestion = {
  id: string
  type: "single" | "multiple" | "boolean" | "short"
  prompt: string
  options?: Array<{ id: string; label: string }>
  points: number
  difficulty?: 1 | 2 | 3 | 4 | 5
  state?: Array<{ key: string; value: ChatUIStateValue }>
  components?: ChatUIComponent[]
}

export type ExamAdaptiveSettings = {
  enabled: boolean
  questionsPerAttempt: number
  startDifficulty: 1 | 2 | 3 | 4 | 5
  masteryThreshold: number
}

export type ExamSpec = {
  id: string
  version: 1
  title: string
  instructions: string
  durationMinutes?: number
  randomizeQuestions?: boolean
  attemptsAllowed?: number
  adaptive?: ExamAdaptiveSettings
  questions: ExamQuestion[]
  totalPoints: number
}

export type ExamAnswerKeyEntry = {
  questionId: string
  correctOptionIDs?: string[]
  acceptedAnswers?: string[]
  explanation?: string
  manualReview?: boolean
  criteria?: Array<{
    id: string
    description: string
    points: number
    keywords: string[]
    match: "all" | "any"
  }>
}

export type ExamGradingConfig = {
  partialCredit: boolean
  negativeMarking: number
}

export type ExamQuestionGrade = {
  questionId: string
  earned: number
  maximum: number
  status: "correct" | "partial" | "incorrect" | "needs-review" | "unanswered"
  feedback: string
  explanation?: string
  criteria?: Array<{ id: string; description: string; earned: number; maximum: number; matched: boolean }>
  correctOptionIDs?: string[]
}

export type ExamAnalytics = {
  attemptCount: number
  averagePercentage: number
  bestPercentage: number
  latestPercentage: number
}

export type ExamGrade = {
  examId: string
  attemptNumber: number
  score: number
  maximum: number
  percentage: number
  needsReview: boolean
  needsReviewCount: number
  questionResults: ExamQuestionGrade[]
  attemptsAllowed?: number
  attemptsRemaining: number
  adaptiveDifficulty?: number
  nextAttempt?: ExamSpec
}
