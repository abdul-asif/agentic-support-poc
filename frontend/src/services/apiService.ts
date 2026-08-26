import axios from "axios";

const API_BASE_URL = "http://localhost:3000"; // Backend URL

// Function to handle GET requests
export const get = async (endpoint: string, params = {}) => {
  try {
    const response = await axios.get(`${API_BASE_URL}${endpoint}`, { params });
    return response.data;
  } catch (error) {
    console.error("GET request error:", error);
    throw error;
  }
};

// Function to handle POST requests
export const post = async (endpoint: string, data = {}) => {
  try {
    const response = await axios.post(`${API_BASE_URL}${endpoint}`, data);
    return response.data;
  } catch (error) {
    console.error("POST request error:", error);
    throw error;
  }
};

// Function to handle PUT requests
export const put = async (endpoint: string, data = {}) => {
  try {
    const response = await axios.put(`${API_BASE_URL}${endpoint}`, data);
    return response.data;
  } catch (error) {
    console.error("PUT request error:", error);
    throw error;
  }
};

// Function to handle DELETE requests
export const del = async (endpoint: string) => {
  try {
    const response = await axios.delete(`${API_BASE_URL}${endpoint}`);
    return response.data;
  } catch (error) {
    console.error("DELETE request error:", error);
    throw error;
  }
};

// Function to fetch data from the test endpoint
export const fetchTestMessage = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/test`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching test message:", error);
    throw error;
  }
};

export type AgentStep = {
  title: string;
  detail: string;
};

export type AgentSource = {
  id: string;
  fileName: string;
  title: string;
  chunk: number;
  score: number;
};

export type AgentToolCall = {
  tool: string;
  name: string;
  input: Record<string, string | number>;
  result: string;
};

export type Confidence = {
  score: number;
  label: "High" | "Medium" | "Low" | "None";
  explanation: string;
};

export type ValidationResult = {
  sourcesAreValid: boolean;
  sourceReason: string;
  draftGrounded: boolean;
  groundingReason: string;
  meetsConfidenceThreshold: boolean;
  minimumConfidenceScore: number;
};

export type SupportResponse = {
  question: string;
  conversationId: string;
  category: "react" | "node" | "general";
  action: string;
  answer: string;
  tools: AgentToolCall[];
  confidence: Confidence;
  validation: ValidationResult;
  reasoning: string[];
  refusal: string | null;
  memory: {
    used: boolean;
    turnCount: number;
    recentQuestions: string[];
    recentTurns: {
      question: string;
      answer: string;
      category: "react" | "node" | "general";
      timestamp: string;
    }[];
  };
  sources: AgentSource[];
  steps: AgentStep[];
};

export type ObservabilityDashboard = {
  generatedAt: string;
  metrics: {
    totalRequests: number;
    successfulRequests: number;
    refusedRequests: number;
    errorRequests: number;
    refusalRate: number;
    averageConfidence: number;
    mcpCallCount: number;
    mcpErrorCount: number;
    averageMcpDurationMs: number;
    sourceCoverageRate: number;
  };
  toolUsage: Record<string, number>;
  sourceUsage: Record<string, number>;
  recentRequests: Array<{
    timestamp: string;
    requestId: string;
    userQuestion: string;
    selectedTool: string[];
    mcpCalls: Array<{ tool: string; status: string; durationMs: number }>;
    retrievedSources: AgentSource[];
    confidence?: Confidence;
    finalResponse: string | null;
    error: string | null;
  }>;
};

export const fetchObservability = async (): Promise<ObservabilityDashboard> => {
  const response = await fetch(`${API_BASE_URL}/api/observability`);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
};

export const askSupportAgent = async (question: string, conversationId: string): Promise<SupportResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/support`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, conversationId }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `HTTP error! status: ${response.status}`);
  }

  return response.json();
};
