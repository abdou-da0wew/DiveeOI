// packages/learning/src/setup/state-machine-schema.ts
//
// Re-export the schemas from the state machine under an explicit name so
// the API route group can import them without colliding with the
// type exports. The state-machine.ts file defines both the runtime values
// and the Schemas; this file is just a named-alias shim.

export { SetupState as SetupStateSchema, StepState, StepName, StepStatus } from "./state-machine"
