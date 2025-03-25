// packages/common/src/markdownUtils.ts

export function cleanMarkdownJson(rawResponse: string): string {
  return rawResponse.replace(/```json\s*|\s*```|```/g, "").trim();
}