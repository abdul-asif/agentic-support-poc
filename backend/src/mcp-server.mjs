import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "..", "data");
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

function loadDocuments() {
  return fs
    .readdirSync(DATA_DIR)
    .filter((fileName) => fileName.endsWith(".txt"))
    .map((fileName) => ({
      fileName,
      title: fileName.replace(/\.txt$/, "").replace(/-/g, " "),
      text: fs.readFileSync(path.join(DATA_DIR, fileName), "utf8"),
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

const knowledgeBase = loadDocuments().flatMap(splitIntoChunks);

function searchDocuments(question, category, limit = 3) {
  const queryWords = new Set(tokenize(question));
  const preferredSource = `${category === "react" ? "react-basics" : category === "node" ? "node-api" : "support-basics"}.txt`;

  return knowledgeBase
    .map((chunk) => {
      const chunkWords = new Set(tokenize(chunk.text));
      const matchedWords = [...queryWords].filter((word) =>
        chunkWords.has(word),
      );
      const categoryBoost = chunk.source === preferredSource ? 2 : 0;
      return {
        ...chunk,
        score: matchedWords.length + categoryBoost,
        matchScore: matchedWords.length,
      };
    })
    .filter((chunk) => chunk.matchScore > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.source.localeCompare(right.source),
    )
    .slice(0, limit);
}

function readFile(fileName) {
  const safeFileName = path.basename(fileName);
  const document = loadDocuments().find(
    (item) => item.fileName === safeFileName,
  );
  if (!document)
    throw new Error(`Knowledge-base file not found: ${safeFileName}`);
  return document;
}

const server = new McpServer({ name: "local-support-tools", version: "1.0.0" });

server.registerTool(
  "search_documents",
  {
    title: "Search Documents Tool",
    description: "Find relevant chunks in the local knowledge base.",
    inputSchema: {
      question: z.string().describe("The question to search for."),
      category: z
        .enum(["react", "node", "general"])
        .describe("The agent category."),
    },
  },
  async ({ question, category }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(searchDocuments(question, category)),
      },
    ],
  }),
);

server.registerTool(
  "read_file",
  {
    title: "Read File Tool",
    description: "Read one named text document from the local knowledge base.",
    inputSchema: {
      fileName: z.string().describe("The .txt filename to read."),
    },
  },
  async ({ fileName }) => ({
    content: [{ type: "text", text: JSON.stringify(readFile(fileName)) }],
  }),
);

server.registerTool(
  "generate_report",
  {
    title: "Generate Report Tool",
    description: "Format retrieved context and sources into a support report.",
    inputSchema: {
      question: z.string().describe("The original question."),
      category: z.string().describe("The selected agent category."),
      chunks: z
        .array(z.record(z.string(), z.unknown()))
        .describe("Retrieved knowledge chunks."),
    },
  },
  async ({ question, category, chunks }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          title: `Support report: ${category}`,
          question,
          summary: chunks.length
            ? chunks.map((chunk) => chunk.text).join("\n\n")
            : "No local evidence was found.",
          sourceCount: chunks.length,
        }),
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
