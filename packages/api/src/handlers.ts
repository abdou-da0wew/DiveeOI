import { SessionV2 } from "@diveeoi/db/session"
import { LocationServiceMap } from "@diveeoi/db/location-layer"
import { PermissionSaved } from "@diveeoi/db/permission/saved"
import { PtyTicket } from "@diveeoi/db/pty/ticket"
import { Layer } from "effect"
import { layer as locationLayer } from "./groups/location"
import { sessionLocationLayer } from "./middleware/session-location"
import { MessageHandler } from "./handlers/message"
import { ModelHandler } from "./handlers/model"
import { ProviderHandler } from "./handlers/provider"
import { SessionHandler } from "./handlers/session"
import { PermissionHandler } from "./handlers/permission"
import { FileSystemHandler } from "./handlers/fs"
import { CommandHandler } from "./handlers/command"
import { SkillHandler } from "./handlers/skill"
import { EventHandler } from "./handlers/event"
import { AgentHandler } from "./handlers/agent"
import { HealthHandler } from "./handlers/health"
import { PtyHandler } from "./handlers/pty"
import { QuestionHandler } from "./handlers/question"
import { ReferenceHandler } from "./handlers/reference"
import * as SessionExecutionLocal from "@diveeoi/db/session/execution/local"
import { LocationHandler } from "./handlers/location"
import { IntegrationHandler } from "./handlers/integration"
import { CredentialHandler } from "./handlers/credential"
import { Credential } from "@diveeoi/db/credential"
import { Prefs } from "@diveeoi/db/prefs"
import { ProjectCopyHandler } from "./handlers/project-copy"
import { PrefsHandler } from "./handlers/prefs"
import { AuthHandler } from "./handlers/auth"
import { UserService } from "@diveeoi/db/auth-user/user"
import { MailService } from "@diveeoi/db/mail/mail"

export const handlers = Layer.mergeAll(
  HealthHandler,
  LocationHandler,
  AgentHandler,
  SessionHandler,
  MessageHandler,
  ModelHandler,
  ProviderHandler,
  IntegrationHandler,
  CredentialHandler,
  PermissionHandler,
  FileSystemHandler,
  CommandHandler,
  SkillHandler,
  EventHandler,
  PtyHandler,
  QuestionHandler,
  ReferenceHandler,
  ProjectCopyHandler,
  PrefsHandler,
  AuthHandler,
).pipe(
  Layer.provide(sessionLocationLayer),
  Layer.provide(locationLayer),
  Layer.provide(SessionV2.defaultLayer),
  Layer.provide(SessionExecutionLocal.defaultLayer),
  Layer.provide(PermissionSaved.defaultLayer),
  Layer.provide(PtyTicket.defaultLayer),
  Layer.provide(LocationServiceMap.layer),
  Layer.provide(Credential.defaultLayer),
  Layer.provide(Prefs.defaultLayer),
  Layer.provide(UserService.layer),
  Layer.provide(MailService.defaultLayer),
)
