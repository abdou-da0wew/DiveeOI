import { describe, expect, test } from "bun:test";
import { StreamingChunker } from "../src/chunker";

describe("StreamingChunker", () => {
  test("emits the first sentence as soon as it clears minChars", () => {
    const c = new StreamingChunker();
    const out = c.push("Great question! Photosynthesis is how plants turn sunlight into food.");
    expect(out.length).toBe(2);
    expect(out[0]).toBe("Great question!");
    expect(out[1]).toBe("Photosynthesis is how plants turn sunlight into food.");
  });

  test("holds a short lead-in until the next boundary", () => {
    const c = new StreamingChunker();
    let out = c.push("Hi!");
    expect(out.length).toBe(0);
    out = c.push(" I am your teacher.");
    // "Hi! I am your teacher." = 22 chars >= minChars 14 -> single chunk
    expect(out.length).toBe(1);
    expect(out[0]).toBe("Hi! I am your teacher.");
  });

  test("does not split inside abbreviations", () => {
    const c = new StreamingChunker();
    const out = c.push("Compare Dr. Smith and e.g. birds. Done here.");
    expect(out.length).toBe(1);
    expect(out[0]).toBe("Compare Dr. Smith and e.g. birds.");
    // "Done here." (10 chars) stays pending below minChars until flush
    expect(c.flush()).toEqual(["Done here."]);
  });

  test("does not split decimal numbers", () => {
    const c = new StreamingChunker();
    const out = c.push("Pi is 3.14 exactly. Next sentence.");
    expect(out[0]).toBe("Pi is 3.14 exactly.");
    expect(out[1]).toBe("Next sentence.");
  });

  test("Arabic boundaries: short lead-in is held, full sentence dispatches", () => {
    const c = new StreamingChunker();
    const text = "سؤال ممتاز! البناء الضوئي هو كيفية تحويل النبات لأشعة الشمس إلى غذاء.";
    let out = c.push(text.slice(0, 30));
    expect(out.length).toBe(0); // "سؤال ممتاز!" is 11 chars — held
    out = c.push(text.slice(30));
    expect(out.length).toBe(1);
    expect(out[0]).toBe(text);
    expect(c.flush().length).toBe(0);
  });

  test("soft split on Arabic comma when a chunk grows beyond softMax", () => {
    const c = new StreamingChunker();
    const part1 = "و".repeat(120) + "، ";
    const part2 = "و".repeat(120);
    const out = c.push(part1 + part2);
    expect(out.length).toBe(1); // first half dispatches at the comma
    expect(out[0].endsWith("،")).toBe(true);
    // remainder has no boundary yet -> stays pending until flush
    const rest = c.flush();
    expect(rest.length).toBe(1);
    expect(rest[0].length).toBe(120);
  });

  test("force-splits at maxChars when no boundary ever arrives", () => {
    const c = new StreamingChunker();
    const long = "x".repeat(500);
    const out = c.push(long);
    // 500 chars -> two 220-char chunks emitted, 60 chars stay pending
    expect(out.length).toBe(2);
    for (const chunk of out) expect(chunk.length).toBeLessThanOrEqual(221);
    const rest = c.flush();
    expect(rest.length).toBe(1);
    expect(rest[0].length).toBe(60);
  });

  test("token-by-token streaming yields the same chunks as one-shot", () => {
    const text = "First sentence here. Second sentence follows. Third one ends it.";
    const oneShot = new StreamingChunker().push(text);
    const streamed = new StreamingChunker();
    const acc: string[] = [];
    for (const tok of text.split(/(\s+)/)) acc.push(...streamed.push(tok));
    acc.push(...streamed.flush());
    expect(acc).toEqual(oneShot);
  });

  test("flush returns the tail", () => {
    const c = new StreamingChunker();
    c.push("no boundary at all");
    const out = c.flush();
    expect(out).toEqual(["no boundary at all"]);
  });
});
