import { Match, Show, Switch } from "solid-js"
import type { ChatUIAdvancedComponent } from "@diveeoi/db/chat-ui"
import { Workflow, Desktop, Database, API } from "./rich-ui-advanced-data"
import { Scene, Wizard, Monitor, Circuit } from "./rich-ui-advanced-visual"
import { RichUIDataGrid, RichUIMap, RichUIMedia } from "./rich-ui-advanced-rich"
import type { ChatUIStateValue } from "@diveeoi/db/chat-ui"
import type { StateSetter } from "./rich-ui-composition"

export function RichUIAdvanced(props: {
  component: ChatUIAdvancedComponent
  state?: Record<string, ChatUIStateValue>
  setState?: StateSetter
}) {
  return (
    <Switch>
      <Match when={props.component.type === "workflow"}>
        <Workflow component={props.component as Extract<ChatUIAdvancedComponent, { type: "workflow" }>} />
      </Match>
      <Match when={props.component.type === "desktop"}>
        <Desktop component={props.component as Extract<ChatUIAdvancedComponent, { type: "desktop" }>} />
      </Match>
      <Match when={props.component.type === "database"}>
        <Database component={props.component as Extract<ChatUIAdvancedComponent, { type: "database" }>} />
      </Match>
      <Match when={props.component.type === "api"}>
        <API component={props.component as Extract<ChatUIAdvancedComponent, { type: "api" }>} />
      </Match>
      <Match when={props.component.type === "scene"}>
        <Scene component={props.component as Extract<ChatUIAdvancedComponent, { type: "scene" }>} />
      </Match>
      <Match when={props.component.type === "wizard"}>
        <Wizard component={props.component as Extract<ChatUIAdvancedComponent, { type: "wizard" }>} />
      </Match>
      <Match when={props.component.type === "monitor"}>
        <Monitor component={props.component as Extract<ChatUIAdvancedComponent, { type: "monitor" }>} />
      </Match>
      <Match when={props.component.type === "circuit"}>
        <Circuit component={props.component as Extract<ChatUIAdvancedComponent, { type: "circuit" }>} />
      </Match>
      <Match when={props.component.type === "map"}>
        <RichUIMap component={props.component as Extract<ChatUIAdvancedComponent, { type: "map" }>} />
      </Match>
      <Match when={props.component.type === "data-grid"}>
        <Show when={props.state && props.setState}>
          <RichUIDataGrid
            component={props.component as Extract<ChatUIAdvancedComponent, { type: "data-grid" }>}
            state={props.state!}
            setState={props.setState!}
          />
        </Show>
      </Match>
      <Match when={props.component.type === "media"}>
        <RichUIMedia component={props.component as Extract<ChatUIAdvancedComponent, { type: "media" }>} />
      </Match>
    </Switch>
  )
}
