import WebSocket from 'ws';
import { openai } from './ai.js';
import { type ChatCompletion } from 'openai/resources';

const model = 'meta-llama/llama-3.3-70b-instruct:free';

async function getDebuggerURL() {
  const res = await fetch('http://127.0.0.1:9229/json/list');
  const data: any = await res.json();

  return data[0].webSocketDebuggerUrl;
}

export async function debuggerClient() {
  const ws = new WebSocket(await getDebuggerURL());
  let mainScriptId: any = null;
  let mainScriptUrl: any = null;
  let fetchTimer: any = null;
  let isAtBreakpoint = false;
  let expectedBreakpoints = 0;
  let breakpointsSet = 0;

  function continueExecution() {
    ws.send(
      JSON.stringify({
        id: 100,
        method: 'Debugger.resume',
      })
    );
  }

  try {
    ws.on('open', () => {
      console.log('Connected to the Node.js inspector.');

      // Enable debugger and runtime with proper sequencing
      ws.send(JSON.stringify({ id: 1, method: 'Debugger.enable' }));
      ws.send(JSON.stringify({ id: 2, method: 'Runtime.enable' }));
      ws.send(
        JSON.stringify({ id: 3, method: 'Runtime.runIfWaitingForDebugger' })
      );

      // Set pause on exceptions
      ws.send(
        JSON.stringify({
          id: 4,
          method: 'Debugger.setPauseOnExceptions',
          params: { state: 'uncaught' },
        })
      );
    });

    ws.on('message', async (rawData) => {
      let msg;
      try {
        msg = JSON.parse(rawData.toString());
        console.log('Received message:', msg);
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
              id: 6,
              method: 'Debugger.getScriptSource',
              params: { scriptId: mainScriptId },
            })
          );
        }
      }

      // When setting breakpoints, use both URL and scriptId
      if (msg.id === 6 && msg.result) {
        console.log('Got script source from:', mainScriptUrl);

        const response = await openai.chat.completions.create({
          model,
          messages: [
            {
              role: 'system',
              content: `You are a Node.js debugging assistant. Suggest breakpoints. After reading the code, you should output what breakpoints to put by using this format\n                <breakpoints>\n                // this is an array containing the line numbers you're going to put breakpoints in, for example:\n                [1,2,5,8]\n                // and it must be in order.\n                // also, output this format ONLY ONCE in your response and it must be final.\n                </breakpoints>\n\n                If the user says "please debug", then you must set the breakpoints to help them debug.\n                `,
            },
            {
              role: 'user',
              content: `Please debug my code: ${msg.result.scriptSource}`,
            },
          ],
        });

        console.log('LLM says:', response.choices[0]?.message.content);

        const content = response.choices[0]?.message?.content || '';
        const arrayMatch = content.match(
          /<breakpoints>\s*(\[[^\]]*\])\s*<\/breakpoints>/s
        );

        if (arrayMatch && arrayMatch[1]) {
          try {
            const lines = JSON.parse(arrayMatch[1]);
            expectedBreakpoints = lines.length;
            breakpointsSet = 0;

            lines.forEach((line: number, index: number) => {
              const zeroBasedLine = line; // Convert to zero-based line number
              ws.send(
                JSON.stringify({
                  id: 10 + index,
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
      if (msg.id >= 10 && msg.result) {
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
        await suggestFix(errorDesc, mainScriptUrl, ws);
      }

      // Handle all pause states
      if (msg.method === 'Debugger.paused') {
        const reason = msg.params.reason;
        console.log('Debugger paused, reason:', reason);

        if (reason === 'other' || reason === 'breakpoint') {
          isAtBreakpoint = true;
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
                id: 50,
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
          await suggestFix(errorDesc, mainScriptUrl, ws);
        }
      }

      // Handle breakpoint hit
      if (msg.method === 'Debugger.paused' && msg.params.reason === 'other') {
        isAtBreakpoint = true;
        console.log('Breakpoint hit:', msg.params.callFrames[0]);

        const response = await openai.chat.completions.create({
          model,
          messages: [
            {
              role: 'system',
              content: `You are a Node.js debugging assistant. You're currently at a breakpoint.
                Analyze the code state and decide whether to:
                1. Continue execution (respond with "<action>continue</action>")
                2. Add more breakpoints (respond with <breakpoints>[lines]</breakpoints>)
                3. Suggest fixes if you spot issues
                Be concise in your response.`,
            },
            {
              role: 'user',
              content: `Current position: ${JSON.stringify(
                msg.params.callFrames[0]
              )}`,
            },
          ],
        });

        const content = response.choices[0]?.message?.content || '';
        console.log('LLM decision:', content);

        if (content.includes('<action>continue</action>')) {
          continueExecution();
          isAtBreakpoint = false;
        }

        // Handle any new breakpoints...
        const arrayMatch = content.match(
          /<breakpoints>\s*(\[[^\]]*\])\s*<\/breakpoints>/s
        );
        if (arrayMatch && arrayMatch[1]) {
          // ... existing breakpoint setting code ...
        }
      }

      // Handle debugger resumed
      if (msg.method === 'Debugger.resumed') {
        isAtBreakpoint = false;
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

interface DebuggerMessage {
  id: number;
  method: string;
  params: {
    url?: string;
    lineNumber: number;
  };
}

async function suggestFix(
  errorDesc: string,
  scriptUrl: string | null,
  ws: WebSocket
): Promise<void> {
  console.log('Asking LLM for fix suggestions...');
  try {
    const response: ChatCompletion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `You are a Node.js debugging assistant. A runtime or exception error has occurred. Provide a concise fix or suggestion. If more breakpoints are needed, output them in <breakpoints>[lineNumbers]</breakpoints>.`,
        },
        {
          role: 'user',
          content: `Error info: ${errorDesc}`,
        },
      ],
    });

    const content = response.choices?.[0]?.message?.content || '';
    console.log('LLM fix suggestion:', content);

    // Check for <breakpoints> block
    const arrayMatch = content.match(
      /<breakpoints>\s*(\[[^\]]*\])\s*<\/breakpoints>/s
    );
    if (arrayMatch && arrayMatch[1] && scriptUrl) {
      const lines: number[] = JSON.parse(arrayMatch[1]);
      lines.forEach((line: number, index: number) => {
        const message: DebuggerMessage = {
          id: 20 + index,
          method: 'Debugger.setBreakpointByUrl',
          params: {
            url: scriptUrl,
            lineNumber: line, // or line - 1 if needed
          },
        };
        ws.send(JSON.stringify(message));
      });
    }
  } catch (err) {
    console.error('Failed to query LLM for fix:', err);
  }
}
