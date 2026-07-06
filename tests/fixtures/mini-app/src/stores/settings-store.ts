import { createStore } from "solid-js/store"

interface SettingsState {
  theme: "light" | "dark"
  fontSize: number
  language: string
}

export const [settingsStore, setSettingsStore] = createStore<SettingsState>({
  theme: "light",
  fontSize: 14,
  language: "en",
})
