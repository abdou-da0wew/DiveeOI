// packages/learning/src/setup/index.ts
//
// Public entry point for the setup state machine (package.json exports "./setup").
// The export previously pointed at this file without it existing, which broke any
// `import ... from "@diveeoi/learning/setup"`.
export {
  StepStatus,
  StepName,
  StepState,
  SetupState,
  statePath,
  loadState,
  saveState,
  runStep,
  resetForRepair,
  cancelSetup,
  bootCheck,
} from "./state-machine"
export { runtimeCheck, semanticSelfTest, benchmark } from "./steps"
