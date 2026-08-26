function classifyQuestion(question) {
  const normalizedQuestion = question.toLowerCase();
  const category = /\b(react|jsx|tsx|component|hook|usestate|useeffect)\b/.test(
    normalizedQuestion,
  )
    ? "react"
    : /\b(node|node\.js|express|npm|backend|api|server)\b/.test(
          normalizedQuestion,
        )
      ? "node"
      : "general";
  const requestedFile =
    normalizedQuestion.match(
      /(?:read|open|show|contents? of)\s+([\w-]+\.txt)/,
    )?.[1] || null;
  const toolPlan = requestedFile
    ? ["read_file"]
    : /\b(report|summary|summarize|brief)\b/.test(normalizedQuestion)
      ? ["search_documents", "generate_report"]
      : ["search_documents"];

  return { category, toolPlan, requestedFile };
}

export async function routeWithLlm(question, memoryContext, toolNames) {
  const decision = classifyQuestion(`${memoryContext} ${question}`);
  const supportedTools = decision.toolPlan.filter((tool) =>
    toolNames.includes(tool),
  );
  return {
    ...decision,
    toolPlan: supportedTools.length ? supportedTools : ["search_documents"],
    rationale: `Local mock LLM matched deterministic intent rules and selected ${supportedTools.join(" -> ") || "search_documents"}.`,
  };
}

export async function draftWithLlm({
  question,
  category,
  memoryContext,
  context,
  sources,
  report,
}) {
  const hasContext =
    context && !context.startsWith("No matching knowledge-base content");
  const sourceNames =
    sources.map((source) => source.fileName).join(", ") || "none";
  const answer = hasContext
    ? `${category} support based on ${sourceNames}:\n\n${context}${report ? `\n\nReport ready: ${report.title}` : ""}`
    : "I don't know based on the available knowledge base.";

  return {
    answer,
    rationale: hasContext
      ? `Local mock LLM formatted the supplied context and cited ${sources.length} source(s).`
      : "Local mock LLM received no usable context, so it returned the refusal phrase.",
  };
}
