import WebSocket from 'ws';

export interface DebuggerMessage {
  id: number;
  method: string;
  params: {
    url?: string;
    lineNumber: number;
  };
}

export interface DebuggerContext {
  initialAnalysis?: string;
  breakpointHits: Array<{
    position: any;
    response: string;
  }>;
  errorSuggestions: Array<{
    error: string;
    suggestion: string;
  }>;
}
