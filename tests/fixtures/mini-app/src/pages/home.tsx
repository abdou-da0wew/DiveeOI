import { createSignal } from "solid-js"

export default function HomePage() {
  const [count, setCount] = createSignal(0)
  return (
    <div data-component="home-page">
      <h1>Home</h1>
      <button onClick={() => setCount(c => c + 1)}>Count: {count()}</button>
    </div>
  )
}
