export default {
  state: { score: 0, answered: false },
  events: [
    {
      id: "wrong-answer",
      scene: "question",
      on: "click",
      target: "#answer-volt",
      actions: [
        { type: "set", key: "answered", value: true },
        { type: "feedback", text: "Not quite. A volt measures potential difference.", tone: "error" },
      ],
    },
    {
      id: "right-answer",
      scene: "question",
      on: "click",
      target: "#answer-ampere",
      actions: [
        { type: "set", key: "score", value: 1 },
        { type: "set", key: "answered", value: true },
        { type: "feedback", text: "Correct. Current is measured in amperes.", tone: "success" },
      ],
    },
  ],
}
