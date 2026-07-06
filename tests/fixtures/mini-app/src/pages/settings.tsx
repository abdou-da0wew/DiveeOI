import { useParams } from "@solidjs/router"
import { settingsStore, setSettingsStore } from "../stores/settings-store"

export default function SettingsPage() {
  const params = useParams()

  return (
    <div data-component="settings-page">
      <h1>Settings: {params.tab || "general"}</h1>
      <label>
        Theme:
        <select
          value={settingsStore.theme}
          onChange={e => setSettingsStore("theme", e.target.value)}
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
    </div>
  )
}
