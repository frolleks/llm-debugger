import { createAI } from './ai.js';
import { DebuggerContext } from '../types/debugger.js';

const model = 'meta-llama/llama-3.3-70b-instruct:free';

export async function handleInitialAnalysis(
  sourceCode: string,
  debugContext: DebuggerContext,
  modelName?: string
) {
  const openai = await createAI(modelName);
  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `You are a Node.js debugging assistant. Analyze the code and suggest breakpoints.
          Output your response in this format:
          <analysis>Your analysis of the code and potential issues</analysis>
          <breakpoints>[line numbers]</breakpoints>
          Be specific about what you're looking for at each breakpoint.`,
      },
      {
        role: 'user',
        content: `Please debug my code: ${sourceCode}`,
      },
    ],
  });

  return response.choices[0]?.message?.content || '';
}

export async function handleBreakpointHit(
  callFrame: any,
  debugContext: DebuggerContext,
  modelName?: string
) {
  const openai = await createAI(modelName);
  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `You are a Node.js debugging assistant at a breakpoint.
          Initial analysis: ${debugContext.initialAnalysis}
          
          Previous breakpoint observations: ${debugContext.breakpointHits
            .map(
              (hit) =>
                `\nAt line ${hit.position.location.lineNumber}: ${hit.response}`
            )
            .join('\n')}
          
          Error history: ${debugContext.errorSuggestions
            .map(
              (err) => `\nError: ${err.error}\nSuggestion: ${err.suggestion}`
            )
            .join('\n')}
          
          Analyze current state and decide:
          1. Continue execution USE FORMAT: <action>continue</action> | VALID ACTIONS: continue
          2. Add breakpoints USE FORMAT e.g.: <breakpoints>[1,2]</breakpoints>
          3. Suggest fixes if needed`,
      },
      {
        role: 'user',
        content: `Current position: ${JSON.stringify(callFrame)}`,
      },
    ],
  });

  return response.choices[0]?.message?.content || '';
}

export async function handleError(
  errorDesc: string,
  debugContext: DebuggerContext,
  modelName?: string
) {
  const openai = await createAI(modelName);
  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `You are a Node.js debugging assistant handling an error.
          Initial analysis: ${debugContext.initialAnalysis}
          
          Previous breakpoint observations: ${debugContext.breakpointHits
            .map(
              (hit) =>
                `\nAt line ${hit.position.location.lineNumber}: ${hit.response}`
            )
            .join('\n')}
          
          Previous errors: ${debugContext.errorSuggestions
            .map(
              (err) => `\nError: ${err.error}\nSuggestion: ${err.suggestion}`
            )
            .join('\n')}
          
          Provide a fix.`,
      },
      {
        role: 'user',
        content: `New error: ${errorDesc}`,
      },
    ],
  });

  return response.choices[0]?.message?.content || '';
}
