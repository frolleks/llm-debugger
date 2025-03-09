import WebSocket from 'ws';
import { WS_MESSAGE_IDS } from '../constants/wsMessages.js';
import { DebuggerContext } from '../types/debugger.js';
import {
  handleInitialAnalysis,
  handleBreakpointHit,
  handleError,
} from './llmHandler.js';

async function getDebuggerURL() {
  const res = await fetch('http://127.0.0.1:9229/json/list');
  const data: any = await res.json();
  return data[0].webSocketDebuggerUrl;
}

const debugContext: DebuggerContext = {
  breakpointHits: [],
  errorSuggestions: [],
};

export async function debuggerClient(modelName: string) {
  const ws = new WebSocket(await getDebuggerURL());
  let mainScriptId: any = null;
  let mainScriptUrl: any = null;
  let expectedBreakpoints = 0;
  let breakpointsSet = 0;
  let accumulatedResponse = '';

  function continueExecution() {
    ws.send(
      JSON.stringify({
        id: WS_MESSAGE_IDS.RESUME_EXECUTION,
        method: 'Debugger.resume',
      })
    );
  }

  try {
    ws.on('open', () => {
      console.log('Connected to the Node.js inspector.');

      // Enable debugger and runtime with proper sequencing
      ws.send(
        JSON.stringify({
          id: WS_MESSAGE_IDS.DEBUGGER_ENABLE,
          method: 'Debugger.enable',
        })
      );
      ws.send(
        JSON.stringify({
          id: WS_MESSAGE_IDS.RUNTIME_ENABLE,
          method: 'Runtime.enable',
        })
      );
      ws.send(
        JSON.stringify({
          id: WS_MESSAGE_IDS.RUNTIME_RUN,
          method: 'Runtime.runIfWaitingForDebugger',
        })
      );

      // Set pause on exceptions
      ws.send(
        JSON.stringify({
          id: WS_MESSAGE_IDS.SET_PAUSE_ON_EXCEPTIONS,
          method: 'Debugger.setPauseOnExceptions',
          params: { state: 'uncaught' },
        })
      );
    });

    ws.on('message', async (rawData) => {
      let msg;
      try {
        msg = JSON.parse(rawData.toString());
      } catch {
        console.error('Parsing error:', rawData.toString());
        return;
      }

      // Handle the initial pause from --inspect-brk
      if (msg.method === 'Debugger.paused' && !mainScriptId) {
        console.log('Initial pause from --inspect-brk');
        // Don't resume yet, wait for script parsing and breakpoint setting
        return;
      }

      // Handle execution context creation
      if (msg.method === 'Runtime.executionContextCreated') {
        console.log('Execution context created:', msg.params.context);
      }

      // On scriptParsed, find matching script and set breakpoints
      if (msg.method === 'Debugger.scriptParsed') {
        const url = msg.params.url;
        console.log('Script parsed:', {
          url: msg.params.url,
          scriptId: msg.params.scriptId,
        });

        // Look for actual file-based scripts (not eval or internal)
        if (
          url &&
          !url.includes('node_modules') &&
          !url.includes('internal/') &&
          !url.includes('node:') &&
          url.includes('file://')
        ) {
          mainScriptId = msg.params.scriptId;
          mainScriptUrl = url;
          console.log('Found main script:', {
            url,
            scriptId: mainScriptId,
          });

          // Get source and set breakpoints before continuing
          ws.send(
            JSON.stringify({
              id: WS_MESSAGE_IDS.GET_SCRIPT_SOURCE,
              method: 'Debugger.getScriptSource',
              params: { scriptId: mainScriptId },
            })
          );
        }
      }

      // When setting breakpoints, first LLM interaction
      if (msg.id === WS_MESSAGE_IDS.GET_SCRIPT_SOURCE && msg.result) {
        console.log('Got script source from:', mainScriptUrl);

        const response = await handleInitialAnalysis(
          msg.result.scriptSource,
          debugContext,
          modelName,
          (chunk) => {
            process.stdout.write(chunk);
            accumulatedResponse += chunk;
          }
        );

        const content = response;
        debugContext.initialAnalysis = content;
        console.log('\nLLM initial analysis complete');

        // Process accumulated response for breakpoints
        const arrayMatch = accumulatedResponse.match(
          /<breakpoints>\s*(\[[^\]]*\])\s*<\/breakpoints>/s
        );

        // Reset accumulated response
        accumulatedResponse = '';

        if (arrayMatch && arrayMatch[1]) {
          try {
            const lines = JSON.parse(arrayMatch[1]);
            expectedBreakpoints = lines.length;
            breakpointsSet = 0;

            lines.forEach((line: number, index: number) => {
              const zeroBasedLine = line; // Convert to zero-based line number
              ws.send(
                JSON.stringify({
                  id: WS_MESSAGE_IDS.BREAKPOINT_START_ID + index,
                  method: 'Debugger.setBreakpoint',
                  params: {
                    location: {
                      scriptId: mainScriptId,
                      lineNumber: zeroBasedLine,
                    },
                  },
                })
              );
            });
          } catch (error) {
            console.error(
              'Error parsing breakpoints from LLM response:',
              error
            );
          }
        }
      }

      // Show result for each breakpoint and track completion
      if (msg.id >= WS_MESSAGE_IDS.BREAKPOINT_START_ID && msg.result) {
        breakpointsSet++;
        console.log(`Breakpoint request #${msg.id} set. Result:`, msg.result);

        // Continue only after all breakpoints are set
        if (breakpointsSet === expectedBreakpoints) {
          console.log('All breakpoints set, continuing execution');
          continueExecution();
        }
      }

      // Handle runtime exceptions
      if (msg.method === 'Runtime.exceptionThrown') {
        const errorDesc =
          msg.params?.exceptionDetails?.exception?.description ||
          'Unknown error';
        console.log('Error occurred:', errorDesc);
        const res = await handleError(
          errorDesc,
          debugContext,
          modelName,
          (chunk) => {
            process.stdout.write(chunk);
            accumulatedResponse += chunk;
          }
        );
        console.log('LLM suggestion: ', res);

        accumulatedResponse = '';
      }

      // Handle all pause states
      if (msg.method === 'Debugger.paused') {
        const reason = msg.params.reason;
        console.log('Debugger paused, reason:', reason);

        if (reason === 'other' || reason === 'breakpoint') {
          const frame = msg.params.callFrames[0];
          console.log('Paused at:', {
            location: frame.location,
            functionName: frame.functionName,
            scope: frame.scopeChain,
          });

          // Get local variables
          const scopeChain = frame.scopeChain;
          const localScope = scopeChain.find(
            (scope: any) => scope.type === 'local'
          );

          if (localScope) {
            ws.send(
              JSON.stringify({
                id: WS_MESSAGE_IDS.GET_PROPERTIES,
                method: 'Runtime.getProperties',
                params: {
                  objectId: localScope.object.objectId,
                  ownProperties: false,
                  accessorPropertiesOnly: false,
                  generatePreview: true,
                },
              })
            );
          }
        } else if (reason === 'exception') {
          const errorDesc = msg.params?.data.description;
          console.log('Error occurred:', errorDesc);
          const res = await handleError(errorDesc, debugContext, modelName);
          console.log('LLM suggestion: ', res);
        }
      }

      // Handle breakpoint hit - second LLM interaction
      if (msg.method === 'Debugger.paused' && msg.params.reason === 'other') {
        const response = await handleBreakpointHit(
          msg.params.callFrames[0],
          debugContext,
          modelName,
          (chunk) => {
            process.stdout.write(chunk);
            accumulatedResponse += chunk;
          }
        );

        const content = response;
        debugContext.breakpointHits.push({
          position: msg.params.callFrames[0],
          response: content,
        });

        console.log('\nLLM decision complete');

        if (accumulatedResponse.includes('<action>continue</action>')) {
          continueExecution();
        }

        // Handle any new breakpoints...
        const arrayMatch = accumulatedResponse.match(
          /<breakpoints>\s*(\[[^\]]*\])\s*<\/breakpoints>/s
        );

        // Reset accumulated response
        accumulatedResponse = '';

        // ... existing breakpoint setting code ...
      }

      // Handle debugger resumed
      if (msg.method === 'Debugger.resumed') {
        console.log('Execution resumed');
      }
    });

    ws.on('close', () => {
      console.log('Disconnected from the inspector.');
    });

    ws.on('error', (err) => {
      console.error(err);
    });
  } catch (err) {
    console.error(err);
  }
}
