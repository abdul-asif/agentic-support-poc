import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { askSupportAgent, fetchObservability } from "./services/apiService";
import type {
  ObservabilityDashboard,
  SupportResponse,
} from "./services/apiService";
import "./App.css";

function App() {
  return window.location.pathname === "/observability" ? (
    <ObservabilityPage />
  ) : (
    <AgentPage />
  );
}

function AgentPage() {
  const [conversationId] = useState(() => crypto.randomUUID());
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<SupportResponse | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState("");

  const askAgent = async (event: FormEvent) => {
    event.preventDefault();
    if (!question.trim()) return;
    setIsThinking(true);
    setError("");
    try {
      setResult(await askSupportAgent(question.trim(), conversationId));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not reach the agent.",
      );
    } finally {
      setIsThinking(false);
    }
  };

  const examples = [
    "How do I use useState in React?",
    "Why is my Node.js API not responding?",
    "Read react-basics.txt",
    "Summarize the Node.js API guidance as a report",
  ];

  return (
    <main className="app-shell">
      <header className="masthead">
        <a className="dashboard-link" href="/observability">
          Open observability dashboard ↗
        </a>
        <div className="eyebrow">
          <span className="status-dot" /> LOCAL MOCK LLM + GUARDRAILS
        </div>
        <h1>
          Build your first
          <br />
          <em>support agent.</em>
        </h1>
        <p className="intro">
          A grounded multi-agent system that uses a local mock LLM for routing
          and writing, while MCP tools, sources, and validation stay in control.
        </p>
      </header>

      <section className="workspace">
        <div className="ask-panel">
          <div className="section-label">01 / ASK THE AGENT</div>
          <form onSubmit={askAgent}>
            <label htmlFor="question">What do you need help with?</label>
            <textarea
              id="question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Try: How do I manage state in a React component?"
              rows={5}
            />
            <button type="submit" disabled={isThinking || !question.trim()}>
              {isThinking ? "Working..." : "Run support agent"}
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <div className="examples">
            <span>Try an example</span>
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setQuestion(example)}
              >
                {example}
              </button>
            ))}
          </div>
        </div>

        <div className="result-panel">
          <div className="section-label">02 / OBSERVE THE FLOW</div>
          {!result && !error && (
            <div className="empty-state">
              <span className="empty-number">?</span>
              <p>Your agent's decisions will appear here.</p>
            </div>
          )}
          {error && <div className="error-state">{error}</div>}
          {result && (
            <>
              <div className="trace">
                {result.steps.map((step, index) => (
                  <div className="trace-step" key={step.title}>
                    <div className="step-marker">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div>
                      <strong>{step.title}</strong>
                      <p>{step.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="confidence">
                <div className="confidence-heading">
                  <span>CONFIDENCE</span>
                  <strong>
                    {result.confidence.label} /{" "}
                    {Math.round(result.confidence.score * 100)}%
                  </strong>
                </div>
                <div className="confidence-track">
                  <div style={{ width: `${result.confidence.score * 100}%` }} />
                </div>
                <p>{result.confidence.explanation}</p>
              </div>
              <div className="reasoning">
                <div className="sources-heading">WHY THE AGENT DECIDED</div>
                {result.reasoning.map((decision) => (
                  <p key={decision}>→ {decision}</p>
                ))}
              </div>
              <div className="validation">
                <div className="sources-heading">VALIDATION GATES</div>
                <p>
                  {result.validation.sourcesAreValid ? "✓" : "×"} Source
                  integrity: {result.validation.sourceReason}
                </p>
                <p>
                  {result.validation.draftGrounded ? "✓" : "×"} Draft grounding:{" "}
                  {result.validation.groundingReason}
                </p>
                <p>
                  {result.validation.meetsConfidenceThreshold ? "✓" : "×"}{" "}
                  Confidence threshold: minimum{" "}
                  {Math.round(result.validation.minimumConfidenceScore * 100)}%
                </p>
              </div>
              <div className="tool-calls">
                <div className="sources-heading">TOOLS SELECTED BY AGENT</div>
                {result.tools.map((tool) => (
                  <div
                    className="tool-call"
                    key={`${tool.tool}-${tool.result}`}
                  >
                    <span>▸</span>
                    <strong>{tool.name}</strong>
                    <small>{tool.result}</small>
                  </div>
                ))}
              </div>
              <div
                className={`answer${result.refusal ? " answer-refusal" : ""}`}
              >
                <div className="answer-heading">
                  <span>AGENT RESPONSE</span>
                  <b>{result.category}</b>
                </div>
                <p>{result.answer}</p>
              </div>
              <div className="sources">
                <div className="sources-heading">
                  SOURCES / LOCAL KNOWLEDGE BASE
                </div>
                {result.sources.length ? (
                  result.sources.map((source) => (
                    <div className="source" key={source.id}>
                      <span>[{source.chunk || "F"}]</span>
                      <strong>{source.fileName}</strong>
                      <small>
                        {source.chunk
                          ? `chunk ${source.chunk} · ${source.score} matching words`
                          : "full file read"}
                      </small>
                    </div>
                  ))
                ) : (
                  <p className="no-sources">
                    No matching source was found. The agent did not invent a
                    citation.
                  </p>
                )}
              </div>
            </>
          )}
          {result && (
            <div className="memory-note">
              <div>
                SHORT-TERM MEMORY:{" "}
                {result.memory.used
                  ? `${result.memory.turnCount} previous turn(s) available`
                  : "first turn"}
              </div>
              {result.memory.used && (
                <div className="memory-history">
                  {result.memory.recentTurns.map((turn) => (
                    <div
                      className="memory-turn"
                      key={`${turn.timestamp}-${turn.question}`}
                    >
                      <strong>Q: {turn.question}</strong>
                      <span>A: {turn.answer}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="lesson">
        <div>
          <div className="section-label">03 / THE IDEA</div>
          <h2>Four agents, one answer.</h2>
          <p>
            Each specialist owns one responsibility and passes a structured
            result to the next. This makes decisions easier to test, observe,
            and replace.
          </p>
        </div>
        <div>
          <h3>1. Route and retrieve</h3>
          <p>
            The Router Agent classifies the question. The Knowledge Agent calls
            MCP tools and returns evidence, sources, and tool results.
          </p>
        </div>
        <div>
          <h3>2. Draft and verify</h3>
          <p>
            The Reporting Agent drafts from that evidence. The Validation Agent
            checks sources and confidence, then approves the answer or refuses
            it.
          </p>
        </div>
      </section>
      <footer>
        <span>SUPPORT AGENT / 005</span>
        <span>Multi-agent + MCP + RAG</span>
      </footer>
    </main>
  );
}

function ObservabilityPage() {
  const [dashboard, setDashboard] = useState<ObservabilityDashboard | null>(
    null,
  );
  const [error, setError] = useState("");

  const loadDashboard = async () => {
    try {
      setDashboard(await fetchObservability());
      setError("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load dashboard.",
      );
    }
  };

  useEffect(() => {
    fetchObservability()
      .then((data) => setDashboard(data))
      .catch((requestError) =>
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Could not load dashboard.",
        ),
      );
  }, []);

  if (error)
    return (
      <main className="app-shell dashboard-page">
        <a className="back-link" href="/">
          ← Back to agent
        </a>
        <div className="error-state">{error}</div>
      </main>
    );
  if (!dashboard)
    return (
      <main className="app-shell dashboard-page">
        <a className="back-link" href="/">
          ← Back to agent
        </a>
        <div className="empty-state">
          <span className="empty-number">...</span>
          <p>Loading observability data.</p>
        </div>
      </main>
    );

  const { metrics } = dashboard;
  const cards = [
    ["Requests", metrics.totalRequests],
    ["Refusal rate", `${Math.round(metrics.refusalRate * 100)}%`],
    ["Avg confidence", `${Math.round(metrics.averageConfidence * 100)}%`],
    ["MCP calls", metrics.mcpCallCount],
    ["MCP errors", metrics.mcpErrorCount],
    ["Source coverage", `${Math.round(metrics.sourceCoverageRate * 100)}%`],
  ];

  return (
    <main className="app-shell dashboard-page">
      <header className="dashboard-header">
        <a className="back-link" href="/">
          ← Back to agent
        </a>
        <div className="eyebrow">
          <span className="status-dot" /> OBSERVABILITY / LIVE LOG VIEW
        </div>
        <h1>
          Agent <em>control room.</em>
        </h1>
        <p className="intro">
          Operational signals from your RAG, MCP, guardrail, and memory
          pipeline.
        </p>
        <button
          className="refresh-button"
          type="button"
          onClick={() => void loadDashboard()}
        >
          Refresh data ↻
        </button>
      </header>
      <section className="metric-grid">
        {cards.map(([label, value]) => (
          <div className="metric-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>
      <section className="dashboard-columns">
        <div className="dashboard-section">
          <div className="section-label">TOOL USAGE</div>
          {Object.entries(dashboard.toolUsage).map(([name, count]) => (
            <div className="bar-row" key={name}>
              <span>{name}</span>
              <strong>{count}</strong>
              <div>
                <i
                  style={{
                    width: `${Math.min(100, (count / Math.max(...Object.values(dashboard.toolUsage), 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="dashboard-section">
          <div className="section-label">SOURCE USAGE</div>
          {Object.entries(dashboard.sourceUsage).map(([name, count]) => (
            <div className="bar-row" key={name}>
              <span>{name}</span>
              <strong>{count}</strong>
              <div>
                <i
                  style={{
                    width: `${Math.min(100, (count / Math.max(...Object.values(dashboard.sourceUsage), 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="dashboard-section request-table">
        <div className="section-label">RECENT REQUESTS</div>
        {dashboard.recentRequests.map((request) => (
          <article className="request-row" key={request.requestId}>
            <div>
              <strong>{request.userQuestion || "Empty question"}</strong>
              <small>
                {new Date(request.timestamp).toLocaleString()} ·{" "}
                {request.requestId}
              </small>
            </div>
            <span>
              {request.confidence?.label || (request.error ? "ERROR" : "NONE")}
            </span>
            <span>{request.selectedTool.join(" + ") || "No tool"}</span>
            <p>{request.finalResponse || request.error || "No response"}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

export default App;
