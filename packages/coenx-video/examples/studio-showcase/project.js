export default {
  state: { score: 0 },
  events: [
    {
      id: "quiz-correct",
      scene: "outro",
      on: "click",
      target: "#btn-correct",
      actions: [
        { type: "feedback", text: "Correct - native Cairo paints every pixel", tone: "success" },
        { type: "increment", key: "score", amount: 1 },
        { type: "emit", event: "quiz:answer", payload: "correct" },
      ],
    },
    {
      id: "quiz-wrong",
      scene: "outro",
      on: "click",
      target: "#btn-wrong",
      actions: [
        { type: "feedback", text: "Not quite - ImageMagick is the compatibility path", tone: "error" },
        { type: "emit", event: "quiz:answer", payload: "wrong" },
      ],
    },
    {
      id: "replay-title",
      scene: "outro",
      on: "click",
      target: "#btn-replay",
      actions: [{ type: "goto", sceneId: "title" }],
    },
    {
      id: "replay-stats",
      scene: "outro",
      on: "click",
      target: "#btn-stats",
      actions: [{ type: "goto", sceneId: "stats" }],
    },
  ],
}
