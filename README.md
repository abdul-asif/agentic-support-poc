# Agentic Support POC

The support agent uses a local RAG pipeline. Documents under `backend/data` are split into paragraph chunks, searched with keyword matching, and passed through the MCP, reporting, and validation agents with source citations.

## Run the agent

```powershell
cd backend
node src/index.js
```

## Retrieval concepts

- **Chunking:** each paragraph becomes a stable record such as `react-basics.txt#2`, so retrieval can cite a small, useful piece of a document.
- **Keyword matching:** meaningful words from the question are compared with words in each chunk, and matching chunks are ranked by overlap.
- **Source tracking:** every result keeps its file name, title, chunk number, text, and score so citations and validation remain intact.
