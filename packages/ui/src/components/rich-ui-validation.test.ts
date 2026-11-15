import { describe, expect, test } from "bun:test"
import type { ChatUIComponent } from "@diveeoi/db/chat-ui"
import { validateRichUISubmission } from "./rich-ui-validation"

const components: ChatUIComponent[] = [
  {
    type: "field",
    id: "name",
    key: "name",
    label: "Name",
    control: "text",
    required: true,
    minLength: 2,
    pattern: "^[A-Za-z]+$",
  },
  { type: "field", id: "age", key: "age", label: "Age", control: "number", required: true, min: 1, max: 120 },
  {
    type: "file-upload",
    id: "attachment",
    key: "files",
    label: "Attachment",
    accept: ["text/plain"],
    multiple: false,
    maxSizeMB: 1,
    required: true,
  },
]

describe("Rich UI submission validation", () => {
  test("requires fields and bounded attachments before dispatch", () => {
    expect(validateRichUISubmission(components, { name: "", age: 0, files: "[]" }, {})).toBe("Name is required")
    expect(validateRichUISubmission(components, { name: "Ada", age: 20, files: "[]" }, {})).toBe(
      "Attachment is required",
    )
    const file = new File(["hello"], "notes.txt", { type: "text/plain" })
    expect(
      validateRichUISubmission(components, { name: "Ada", age: 20, files: "[]" }, { files: [file] }),
    ).toBeUndefined()
  })

  test("rejects invalid formats, out-of-range values, and oversized or mismatched files", () => {
    expect(
      validateRichUISubmission(
        components,
        { name: "A1", age: 20, files: "[]" },
        { files: [new File(["x"], "a.txt", { type: "text/plain" })] },
      ),
    ).toContain("invalid format")
    expect(
      validateRichUISubmission(
        components,
        { name: "Ada", age: 121, files: "[]" },
        { files: [new File(["x"], "a.txt", { type: "text/plain" })] },
      ),
    ).toContain("maximum")
    expect(
      validateRichUISubmission(
        components,
        { name: "Ada", age: 20, files: "[]" },
        { files: [new File(["x"], "a.pdf", { type: "application/pdf" })] },
      ),
    ).toContain("not allowed")
  })
})
