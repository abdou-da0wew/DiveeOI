export * from "./types"
export * from "./core"
export * from "./effect"

import { isEnabled } from "./core"
import { start } from "./writer"

if (isEnabled()) start()
