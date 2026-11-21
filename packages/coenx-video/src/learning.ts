import { createComposition } from "./authoring/composition"
import type { LearningCitation, VideoComposition } from "./model/types"

export interface EducationalVideoInput extends Omit<VideoComposition, "version" | "provenance"> {
  learningObjective: string
  citations: LearningCitation[]
}

export function createEducationalVideo(input: EducationalVideoInput) {
  return createComposition({
    ...input,
    provenance: {
      mode: "education",
      learningObjective: input.learningObjective,
      citations: input.citations,
    },
  })
}

export function citationsForVideo(citations: LearningCitation[]) {
  return citations.map((citation) => ({
    bookId: citation.bookId,
    passageId: citation.passageId,
    ...(citation.title ? { title: citation.title } : {}),
    ...(citation.page ? { page: citation.page } : {}),
    ...(citation.quote ? { quote: citation.quote } : {}),
  }))
}

export * as VideoLearning from "./learning"
