// packages/learning/src/manifest/pinned.ts
//
// The manifest compiled into the app (plan §5.2). It is code, not a file next
// to the package, so it also exists in compiled binaries and Docker images.
//
// Revision, sizes and sha256 for the model files (int8, q4f16, fp16, fp32) and tokenizer.json were read from the Hugging
// Face pages of Xenova/bge-m3 at commit 4de1325 (LFS pointer files). The three
// tiny JSON files are not LFS objects; they are pinned by the commit SHA in the
// download URL only (size 0 / sha256 "" = unknown). Regenerate everything with
// `bun run tl:manifest` when bumping PINNED_REVISION.

import { EMBEDDING_REPO, PINNED_REVISION, type Manifest } from "./types"

export const PINNED_MANIFEST: Manifest = {
  repo: EMBEDDING_REPO,
  revision: PINNED_REVISION,
  endpoint: "https://huggingface.co",
  generatedAt: "2026-10-27T00:00:00.000Z",
  generatorVersion: "pinned-1",
  files: [
    { path: "config.json", size: 0, sha256: "", required: true },
    { path: "special_tokens_map.json", size: 0, sha256: "", required: true },
    { path: "tokenizer_config.json", size: 0, sha256: "", required: true },
    {
      path: "tokenizer.json",
      size: 17082821,
      sha256: "6710678b12670bc442b99edc952c4d996ae309a7020c1fa0096dd245c2faf790",
      required: true,
    },
    {
      path: "onnx/model_q4f16.onnx",
      size: 699932840,
      sha256: "8305fdfa48b5702ecb4a6d84c1a52a4d1cb27d69880ff7f69d1a93d795864f25",
      dtype: "q4f16",
      required: false,
    },
    {
      path: "onnx/model_fp16.onnx",
      size: 1133992936,
      sha256: "4f1a646a3d4f39985589e9991a717044ede8278617fe55e3d246838bc05055e9",
      dtype: "fp16",
      required: false,
    },
    {
      path: "onnx/model.onnx",
      size: 607298,
      sha256: "5d89a0010dd39aa2cfa8b22bb49f06904c5bbf5877135f877da419480f40cde3",
      dtype: "fp32",
      required: false,
    },
    {
      path: "onnx/model.onnx_data",
      size: 2266820608,
      sha256: "1eebfb28493f67bba03ce0ef64bfdc7fc5a3bd9d7493f818bb1d78cd798416b4",
      dtype: "fp32",
      required: false,
    },
    {
      path: "onnx/model_int8.onnx",
      size: 568456694,
      sha256: "a206e10e995aa2a833924bcd725ba5dd6c3425cd34bac3cf2b5677cd2a1c51d6",
      dtype: "int8",
      required: false,
    },
  ],
}
