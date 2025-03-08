import WebSocket from 'ws';
import { openai } from './ai.js';

async function getDebuggerURL() {
  // uses default url, might make it configurable
  const res = await fetch('http://127.0.0.1:9229/json/list');
  const data: any = await res.json();

  console.log(data);

  return data[0].webSocketDebuggerUrl;
}

export async function debuggerClient() {
  const ws = new WebSocket(await getDebuggerURL());
  let cachedScriptUrl: any = null;
  let mainScriptId: any = null;
  let mainScriptUrl: any = null;
  let fetchTimer: any = null;

  try {
    ws.on('open', () => {
      console.log('Connected to the Node.js inspector.');

      const enableDebugger = {
        id: 1,
        method: 'Debugger.enable',
      };
      ws.send(JSON.stringify(enableDebugger));
    });

    ws.on('message', async (rawData) => {
      let msg;
      try {
        msg = JSON.parse(rawData.toString());
      } catch {
        console.error('Parsing error:', rawData.toString());
        return;
      }

      // Each scriptParsed event might be system or user code
      if (msg.method === 'Debugger.scriptParsed') {
        // Filter out empty or internal URLs if needed
        if (msg.params.url && !msg.params.url.includes('node:internal')) {
          mainScriptId = msg.params.scriptId;
          mainScriptUrl = msg.params.url;

          // Reset the timer so the last script is always the one used
          if (fetchTimer) clearTimeout(fetchTimer);
          // Fetch source after a brief pause, to capture the final script
          fetchTimer = setTimeout(() => {
            if (!mainScriptId) return;
            ws.send(
              JSON.stringify({
                id: 2,
                method: 'Debugger.getScriptSource',
                params: { scriptId: mainScriptId },
              })
            );
          }, 500);
        }
      }

      // Handle the script source once fetched
      if (msg.id === 2 && msg.result) {
        console.log('Got script source from:', mainScriptUrl);

        // Send it to your LLM
        const response = await openai.chat.completions.create({
          model: 'meta-llama/llama-3.3-70b-instruct:free',
          messages: [
            {
              role: 'system',
              content:
                'You are a Node.js debugging assistant. Suggest breakpoints.',
            },
            {
              role: 'user',
              content: msg.result.scriptSource,
            },
          ],
        });

        console.log('LLM says:', response.choices[0]?.message.content);

        // Example: parse line from LLM reply and set breakpoint
        const lineMatch =
          response.choices[0]?.message?.content?.match(/line\s+(\d+)/i);
        if (lineMatch && lineMatch[1]) {
          const zeroBasedLine = parseInt(lineMatch[1], 10) - 1;
          ws.send(
            JSON.stringify({
              id: 3,
              method: 'Debugger.setBreakpointByUrl',
              params: {
                url: mainScriptUrl,
                lineNumber: zeroBasedLine,
              },
            })
          );
        }
      }

      // Show breakpoint creation result
      if (msg.id === 3 && msg.result) {
        console.log('Breakpoint set:', msg.result);
      }

      // Paused means we hit a breakpoint
      if (msg.method === 'Debugger.paused') {
        console.log('Debugger paused:', JSON.stringify(msg.params, null, 2));
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
