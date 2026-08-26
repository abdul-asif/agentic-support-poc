const express = require("express");
const cors = require("cors"); // Import the CORS middleware
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "..", "data");
const LOG_DIR = path.join(__dirname, "..", "logs");
const AGENT_LOG_FILE = path.join(LOG_DIR, "agent.log");
const MAX_MEMORY_TURNS = 10;
const MIN_CONFIDENCE_SCORE = 0.4;
const conversationMemory = new Map();
const mcpClientModule = import("./mcp-client.mjs");
const llmModule = import("./llm-client.mjs");

fs.mkdirSync(LOG_DIR, { recursive: true });

// Enable CORS for all origins
app.use(cors());

// Middleware
app.use(express.json());

// Basic route
app.get("/", (req, res) => {
  res.send("Welcome to the backend!");
});

// Test API endpoint
app.get("/api/test", (req, res) => {
  res.json({ message: "Hello from the backend!" });
});

app.get("/api/tools", async (req, res) => {
  const { connectMcpClient } = await mcpClientModule;
  const tools = await connectMcpClient();
  res.json(
    tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  );
});

app.get("/api/agents", (req, res) => {
  res.json({
    agents: [
      {
        name: "Router Agent",
        responsibility: "Classifies the question and creates the tool plan.",
        sendsTo: "Knowledge Agent",
      },
      {
        name: "Knowledge Agent",
        responsibility:
          "Calls MCP tools and returns retrieved evidence and sources.",
        sendsTo: "Reporting Agent",
      },
      {
        name: "Reporting Agent",
        responsibility:
          "Creates a response draft using only the Knowledge Agent output.",
        sendsTo: "Validation Agent",
      },
      {
        name: "Validation Agent",
        responsibility:
          "Validates sources, confidence, and grounding before approval or refusal.",
        sendsTo: "Final response",
      },
    ],
    flow: [
      "Router Agent",
      "Knowledge Agent",
      "Reporting Agent",
      "Validation Agent",
      "Final response",
    ],
  });
});

const actions = {
  react: {
    label: "React helper",
    answer:
      "For React questions, use the retrieved notes below as your starting point.",
  },
  node: {
    label: "Node.js helper",
    answer:
      "For Node.js questions, use the retrieved notes below as your starting point.",
  },
  general: {
    label: "General support",
    answer:
      "For general questions, use the retrieved support notes below as your starting point.",
  },
};

const ignoredWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "do",
  "does",
  "how",
  "i",
  "in",
  "is",
  "it",
  "my",
  "not",
  "of",
  "or",
  "the",
  "that",
  "this",
  "to",
  "use",
  "what",
  "with",
  "why",
]);

function tokenize(text) {
  return (
    text
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((word) => !ignoredWords.has(word)) || []
  );
}

function loadDocuments(dataDirectory) {
  return fs
    .readdirSync(dataDirectory)
    .filter((fileName) => fileName.endsWith(".txt"))
    .map((fileName) => ({
      fileName,
      title: fileName.replace(/\.txt$/, "").replace(/-/g, " "),
      text: fs.readFileSync(path.join(dataDirectory, fileName), "utf8"),
    }));
}

function splitIntoChunks(document) {
  return document.text
    .split(/\r?\n\s*\r?\n/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index) => ({
      id: `${document.fileName}#${index + 1}`,
      source: document.fileName,
      title: document.title,
      chunkIndex: index + 1,
      text,
    }));
}

function buildKnowledgeBase(dataDirectory) {
  return loadDocuments(dataDirectory).flatMap(splitIntoChunks);
}

const knowledgeBase = buildKnowledgeBase(DATA_DIR);

function readKnowledgeFile(fileName) {
  const safeFileName = path.basename(fileName);
  const document = loadDocuments(DATA_DIR).find(
    (item) => item.fileName === safeFileName,
  );

  if (!document) {
    throw new Error(`Knowledge-base file not found: ${safeFileName}`);
  }

  return document;
}

async function getMcpToolName(key) {
  const { connectMcpClient } = await mcpClientModule;
  const tools = await connectMcpClient();
  return tools.find((tool) => tool.name === key)?.title || key;
}

function chooseTools(question, category) {
  const normalizedQuestion = question.toLowerCase();
  const requestedFile = normalizedQuestion.match(
    /(?:read|open|show|contents? of)\s+([\w-]+\.txt)/,
  )?.[1];

  if (requestedFile) {
    return [{ key: "read_file", input: { fileName: requestedFile } }];
  }

  if (/\b(report|summary|summarize|brief)\b/.test(normalizedQuestion)) {
    return [
      { key: "search_documents", input: { question, category } },
      { key: "generate_report", input: { question, category } },
    ];
  }

  return [{ key: "search_documents", input: { question, category } }];
}

async function runTools(
  question,
  category,
  memoryContext = "",
  selectedPlan = null,
) {
  const plan = selectedPlan || chooseTools(question, category);
  const toolCalls = [];
  const mcpCalls = [];
  let retrievedChunks = [];
  let report = null;
  let readFile = null;

  for (const plannedTool of plan) {
    const input = { ...plannedTool.input };

    if (plannedTool.key === "search_documents" && memoryContext) {
      input.question = `${memoryContext} ${question}`;
    }

    if (plannedTool.key === "generate_report") {
      input.chunks = retrievedChunks;
    }

    const { callMcpTool } = await mcpClientModule;
    const startedAt = Date.now();
    let output;
    try {
      output = await callMcpTool(plannedTool.key, input);
      mcpCalls.push({
        tool: plannedTool.key,
        status: "success",
        durationMs: Date.now() - startedAt,
        input:
          plannedTool.key === "generate_report"
            ? { question, category, chunkCount: retrievedChunks.length }
            : plannedTool.input,
      });
    } catch (error) {
      mcpCalls.push({
        tool: plannedTool.key,
        status: "error",
        durationMs: Date.now() - startedAt,
        input: plannedTool.input,
        error: error.message,
      });
      throw error;
    }
    if (plannedTool.key === "search_documents") retrievedChunks = output;
    if (plannedTool.key === "generate_report") report = output;
    if (plannedTool.key === "read_file") readFile = output;

    toolCalls.push({
      tool: plannedTool.key,
      name: await getMcpToolName(plannedTool.key),
      input:
        plannedTool.key === "generate_report"
          ? { question, category, chunkCount: retrievedChunks.length }
          : plannedTool.input,
      result:
        plannedTool.key === "search_documents"
          ? `Retrieved ${output.length} chunk(s) through MCP.`
          : plannedTool.key === "read_file"
            ? `Read ${output.fileName}.`
            : `Generated a report from ${output.sourceCount} source(s).`,
    });
  }

  return { plan, toolCalls, mcpCalls, retrievedChunks, report, readFile };
}

function validateSources(retrievedChunks, readFile) {
  const knownChunks = new Map(knowledgeBase.map((chunk) => [chunk.id, chunk]));
  const chunksAreValid = retrievedChunks.every((chunk) => {
    const knownChunk = knownChunks.get(chunk.id);
    return Boolean(
      knownChunk &&
      knownChunk.source === chunk.source &&
      knownChunk.text === chunk.text,
    );
  });
  const knownFile =
    readFile &&
    loadDocuments(DATA_DIR).find(
      (document) => document.fileName === readFile.fileName,
    );
  const fileIsValid =
    !readFile || Boolean(knownFile && knownFile.text === readFile.text);

  return {
    valid: chunksAreValid && fileIsValid,
    reason:
      chunksAreValid && fileIsValid
        ? "Every returned source matches the file and chunk content loaded locally."
        : "A returned source did not match the local knowledge base exactly.",
  };
}

function calculateConfidence(question, retrievedChunks, readFile) {
  if (readFile)
    return {
      score: 1,
      label: "High",
      explanation: "The requested file exists in the local knowledge base.",
    };
  if (!retrievedChunks.length)
    return {
      score: 0,
      label: "None",
      explanation: "No knowledge-base chunk matched the question.",
    };

  const strongestMatch = Math.max(
    ...retrievedChunks.map((chunk) => chunk.matchScore),
  );
  const queryWordCount = new Set(tokenize(question)).size;
  const score = Math.min(0.98, strongestMatch / Math.max(queryWordCount, 1));
  const label = score >= 0.75 ? "High" : score >= 0.4 ? "Medium" : "Low";

  return {
    score,
    label,
    explanation: `${strongestMatch} of ${queryWordCount} meaningful question word(s) matched the strongest source chunk.`,
  };
}

function validateDraftGrounding(answer, retrievedChunks, readFile) {
  if (
    !answer ||
    answer.trim() === "I don't know based on the available knowledge base."
  ) {
    return {
      grounded: false,
      reason: "The draft contains no evidence-backed answer.",
    };
  }

  const evidence =
    retrievedChunks.map((chunk) => chunk.text).join(" ") ||
    readFile?.text ||
    "";
  const answerWords = new Set(tokenize(answer));
  const evidenceWords = new Set(tokenize(evidence));
  const matchedWords = [...answerWords].filter((word) =>
    evidenceWords.has(word),
  );
  const coverage = matchedWords.length / Math.max(answerWords.size, 1);

  return {
    grounded: coverage >= 0.25,
    coverage,
    reason:
      coverage >= 0.25
        ? `${matchedWords.length} of ${answerWords.size} meaningful answer word(s) appear in the retrieved evidence.`
        : "The draft has too little word overlap with the retrieved evidence.",
  };
}

function chooseAction(question) {
  const normalizedQuestion = question.toLowerCase();

  if (
    /\b(react|jsx|tsx|component|hook|usestate|useeffect)\b/.test(
      normalizedQuestion,
    )
  ) {
    return "react";
  }

  if (
    /\b(node|node\.js|express|npm|backend|api|server)\b/.test(
      normalizedQuestion,
    )
  ) {
    return "node";
  }

  return "general";
}

const routerAgent = {
  name: "Router Agent",
  async route(question, memoryContext) {
    const { routeWithLlm } = await llmModule;
    const toolNames = ["search_documents", "read_file", "generate_report"];
    const decision = await routeWithLlm(question, memoryContext, toolNames);
    const category = decision.category;
    const requestedFile =
      decision.requestedFile ||
      question
        .toLowerCase()
        .match(/(?:read|open|show|contents? of)\s+([\w-]+\.txt)/)?.[1];
    const selectedKeys = new Set(decision.toolPlan);
    const plan =
      selectedKeys.has("read_file") && requestedFile
        ? [{ key: "read_file", input: { fileName: requestedFile } }]
        : selectedKeys.has("generate_report")
          ? [
              { key: "search_documents", input: { question, category } },
              { key: "generate_report", input: { question, category } },
            ]
          : [{ key: "search_documents", input: { question, category } }];

    return {
      category,
      action: actions[category],
      plan,
      reasoning: `Classified the request as ${category}. ${decision.rationale}`,
    };
  },
};

const knowledgeAgent = {
  name: "Knowledge Agent",
  async gather(question, category, memoryContext, plan) {
    const result = await runTools(question, category, memoryContext, plan);
    return {
      ...result,
      plan,
      reasoning: result.toolCalls
        .map(
          (call) =>
            `${call.name} returned ${result.retrievedChunks.length ? "evidence" : "no matching evidence"} for the Reporting Agent.`,
        )
        .join(" "),
    };
  },
};

const reportingAgent = {
  name: "Reporting Agent",
  async draft(action, knowledge, question, memoryContext, sources, category) {
    const { retrievedChunks, readFile, report } = knowledge;
    const context = retrievedChunks.length
      ? retrievedChunks.map((chunk) => chunk.text).join("\n\n")
      : readFile
        ? readFile.text
        : "No matching knowledge-base content was found.";

    const { draftWithLlm } = await llmModule;
    const draft = await draftWithLlm({
      question,
      category,
      memoryContext,
      context,
      sources,
      report,
    });
    return {
      answer: draft.answer,
      reasoning: draft.rationale,
    };
  },
};

const validationAgent = {
  name: "Validation Agent",
  review(question, knowledge, draft, memoryContext) {
    const { retrievedChunks, readFile } = knowledge;
    const sourceValidation = validateSources(retrievedChunks, readFile);
    const sourcesAreValid = sourceValidation.valid;
    const confidenceQuestion = `${memoryContext} ${question}`;
    const confidence = sourcesAreValid
      ? calculateConfidence(confidenceQuestion, retrievedChunks, readFile)
      : { score: 0, label: "None", explanation: "Source validation failed." };
    const hasRetrievedEvidence =
      sourcesAreValid && (retrievedChunks.length > 0 || Boolean(readFile));
    const draftGrounding = validateDraftGrounding(
      draft.answer,
      retrievedChunks,
      readFile,
    );
    const meetsConfidenceThreshold =
      confidence.score >= MIN_CONFIDENCE_SCORE || Boolean(readFile);
    const hasEvidence =
      hasRetrievedEvidence &&
      draftGrounding.grounded &&
      meetsConfidenceThreshold;

    return {
      sourcesAreValid,
      sourceValidation,
      draftGrounding,
      meetsConfidenceThreshold,
      confidence,
      hasEvidence,
      answer: hasEvidence
        ? draft.answer
        : "I don't know based on the available knowledge base.",
      reasoning: hasEvidence
        ? `Approved because sources are valid, draft grounding passed, and confidence meets the ${MIN_CONFIDENCE_SCORE * 100}% threshold.`
        : `Refused because ${!sourcesAreValid ? sourceValidation.reason : !hasRetrievedEvidence ? "no evidence was retrieved" : !draftGrounding.grounded ? draftGrounding.reason : `confidence is below the ${MIN_CONFIDENCE_SCORE * 100}% threshold`}.`,
    };
  },
};

function getConversationHistory(conversationId) {
  return conversationMemory.get(conversationId) || [];
}

function rememberTurn(conversationId, question, response) {
  const history = getConversationHistory(conversationId);
  history.push({
    question,
    answer: response.answer,
    category: response.category,
    timestamp: new Date().toISOString(),
  });
  conversationMemory.set(conversationId, history.slice(-MAX_MEMORY_TURNS));
}

function logAgentRequest({
  requestId,
  question,
  action,
  toolRun,
  sources,
  answer,
  reasoning,
  confidence,
  validation,
  error,
}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    requestId,
    userQuestion: question,
    selectedTool: toolRun?.toolCalls?.map((call) => call.name) || [],
    mcpCalls: toolRun?.mcpCalls || [],
    reasoning:
      reasoning ||
      (toolRun
        ? toolRun.toolCalls.map(
            (call) => `Selected ${call.name} through the MCP client.`,
          )
        : [error || "The request could not be completed."]),
    retrievedSources: sources || [],
    finalResponse: answer || null,
    confidence: confidence || { score: 0, label: "None" },
    validation: validation || null,
    action: action || null,
    error: error || null,
  };

  fs.appendFileSync(AGENT_LOG_FILE, `${JSON.stringify(logEntry)}\n`, "utf8");
  console.log(
    `[agent:${requestId}] tools=${logEntry.selectedTool.join(", ") || "none"} sources=${logEntry.retrievedSources.length}`,
  );
}

function readAgentLogs() {
  if (!fs.existsSync(AGENT_LOG_FILE)) return [];
  return fs
    .readFileSync(AGENT_LOG_FILE, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

app.get("/api/observability", (req, res) => {
  const logs = readAgentLogs();
  const completedRequests = logs.filter(
    (entry) => entry.finalResponse !== null || entry.error,
  );
  const successfulRequests = logs.filter(
    (entry) => entry.finalResponse !== null && !entry.error,
  );
  const refusedRequests = successfulRequests.filter(
    (entry) =>
      entry.finalResponse ===
      "I don't know based on the available knowledge base.",
  );
  const toolUsage = {};
  const sourceUsage = {};
  let mcpCallCount = 0;
  let mcpErrorCount = 0;
  let totalMcpDurationMs = 0;

  logs.forEach((entry) => {
    (entry.selectedTool || []).forEach((tool) => {
      toolUsage[tool] = (toolUsage[tool] || 0) + 1;
    });
    (entry.retrievedSources || []).forEach((source) => {
      sourceUsage[source.fileName] = (sourceUsage[source.fileName] || 0) + 1;
    });
    (entry.mcpCalls || []).forEach((call) => {
      mcpCallCount += 1;
      totalMcpDurationMs += call.durationMs || 0;
      if (call.status === "error") mcpErrorCount += 1;
    });
  });

  res.json({
    generatedAt: new Date().toISOString(),
    metrics: {
      totalRequests: completedRequests.length,
      successfulRequests: successfulRequests.length,
      refusedRequests: refusedRequests.length,
      errorRequests: logs.filter((entry) => Boolean(entry.error)).length,
      refusalRate: successfulRequests.length
        ? refusedRequests.length / successfulRequests.length
        : 0,
      averageConfidence: successfulRequests.length
        ? successfulRequests.reduce(
            (sum, entry) => sum + (entry.confidence?.score || 0),
            0,
          ) / successfulRequests.length
        : 0,
      mcpCallCount,
      mcpErrorCount,
      averageMcpDurationMs: mcpCallCount
        ? totalMcpDurationMs / mcpCallCount
        : 0,
      sourceCoverageRate: successfulRequests.length
        ? successfulRequests.filter(
            (entry) => (entry.retrievedSources || []).length > 0,
          ).length / successfulRequests.length
        : 0,
    },
    toolUsage,
    sourceUsage,
    recentRequests: logs.slice(-20).reverse(),
  });
});

app.post("/api/support", async (req, res) => {
  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const question =
    typeof req.body?.question === "string" ? req.body.question.trim() : "";
  const conversationId =
    typeof req.body?.conversationId === "string" &&
    req.body.conversationId.trim()
      ? req.body.conversationId.trim()
      : "default";
  const conversationHistory = getConversationHistory(conversationId);

  if (!question) {
    logAgentRequest({ requestId, question, error: "Please enter a question." });
    return res.status(400).json({ error: "Please enter a question." });
  }

  const memoryContext = conversationHistory
    .map(
      (turn) =>
        `Previous user question: ${turn.question}\nPrevious agent answer: ${turn.answer}`,
    )
    .join("\n\n");
  let route;
  let actionKey;
  let action;
  let toolRun;
  try {
    route = await routerAgent.route(question, memoryContext);
    actionKey = route.category;
    action = route.action;
    toolRun = await knowledgeAgent.gather(
      question,
      actionKey,
      memoryContext,
      route.plan,
    );
  } catch (error) {
    logAgentRequest({
      requestId,
      question,
      action: action?.label,
      error: error.message,
    });
    return res.status(400).json({ error: error.message });
  }

  const { retrievedChunks, readFile } = toolRun;
  const readFileResult = toolRun.toolCalls.find(
    (call) => call.tool === "read_file",
  );
  const sources = retrievedChunks
    .map((chunk) => ({
      id: chunk.id,
      fileName: chunk.source,
      title: chunk.title,
      chunk: chunk.chunkIndex,
      score: chunk.matchScore,
    }))
    .concat(
      readFile
        ? [
            {
              id: `${readFile.fileName}#full-file`,
              fileName: readFile.fileName,
              title: readFile.title,
              chunk: 0,
              score: 0,
            },
          ]
        : [],
    );
  let draft;
  let validation;
  try {
    draft = await reportingAgent.draft(
      action,
      toolRun,
      question,
      memoryContext,
      sources,
      actionKey,
    );
    validation = validationAgent.review(
      question,
      toolRun,
      draft,
      memoryContext,
    );
  } catch (error) {
    logAgentRequest({
      requestId,
      question,
      action: action.label,
      toolRun,
      sources,
      error: error.message,
    });
    return res.status(502).json({ error: error.message });
  }

  const { sourcesAreValid, confidence, hasEvidence } = validation;
  const answer = validation.answer;
  const reasoning = [
    `${routerAgent.name}: ${route.reasoning}`,
    `${knowledgeAgent.name}: ${toolRun.reasoning}`,
    `${reportingAgent.name}: ${draft.reasoning}`,
    `${validationAgent.name}: ${validation.reasoning}`,
    `Confidence: ${confidence.label} (${Math.round(confidence.score * 100)}%) because ${confidence.explanation}`,
  ];
  const response = {
    question,
    conversationId,
    memory: {
      used: conversationHistory.length > 0,
      turnCount: conversationHistory.length,
      recentQuestions: conversationHistory.map((turn) => turn.question),
      recentTurns: conversationHistory.map((turn) => ({
        question: turn.question,
        answer: turn.answer,
        category: turn.category,
        timestamp: turn.timestamp,
      })),
    },
    category: actionKey,
    action: action.label,
    answer,
    confidence,
    validation: {
      sourcesAreValid,
      sourceReason: validation.sourceValidation.reason,
      draftGrounded: validation.draftGrounding.grounded,
      groundingReason: validation.draftGrounding.reason,
      meetsConfidenceThreshold: validation.meetsConfidenceThreshold,
      minimumConfidenceScore: MIN_CONFIDENCE_SCORE,
    },
    reasoning,
    refusal: hasEvidence
      ? null
      : "I don't know based on the available knowledge base.",
    tools: toolRun.toolCalls,
    sources,
    steps: [
      {
        title: "Receive question",
        detail: `The agent received: “${question}”`,
      },
      { title: "Router Agent", detail: route.reasoning },
      { title: "Knowledge Agent", detail: toolRun.reasoning },
      { title: "Reporting Agent", detail: draft.reasoning },
      { title: "Validation Agent", detail: validation.reasoning },
      {
        title: "Return response",
        detail: hasEvidence
          ? `Evidence passed; returned a ${confidence.label.toLowerCase()}-confidence cited answer.`
          : "Evidence was missing; returned I don't know.",
      },
    ],
  };

  logAgentRequest({
    requestId,
    question,
    action: action.label,
    toolRun,
    sources,
    answer,
    reasoning,
    confidence,
    validation: response.validation,
  });
  rememberTurn(conversationId, question, response);
  return res.json(response);
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
