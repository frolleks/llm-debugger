import WebSocket from 'ws';

async function getDebuggerURL() {
  // uses default url, might make it configurable
  const res = await fetch('http://127.0.0.1:9229/json/list');
  const data: any = await res.json();

  console.log(data);

  return data[0].webSocketDebuggerUrl;
}

export async function debuggerClient() {
  const ws = new WebSocket(await getDebuggerURL());

  try {
    ws.on('open', () => {
      console.log('Connected to the Node.js inspector.');

      const enableDebugger = {
        id: 1,
        method: 'Debugger.enable',
      };
      ws.send(JSON.stringify(enableDebugger));
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('Message from inspector:', message);
      } catch (err) {
        console.error('Failed to parse message:', data);
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
