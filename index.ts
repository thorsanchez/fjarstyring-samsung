import WebSocket, { RawData } from 'ws';
import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import 'dotenv/config';

const TV_IP = process.env.TV_IP;
const APP_NAME = 'fjarstyringsamsung';
const TV_PORT = parseInt(process.env.TV_PORT || '8002', 10);
const SAVED_TOKEN = process.env.TV_TOKEN || null;
let ws: WebSocket | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let authToken: string | null = SAVED_TOKEN;
let connectionAttempts = 0;

//samsung vill fa nafnið i base64
function base64Encode(str: string): string {
  return Buffer.from(str).toString('base64');
}
// tengjast samsung function
function connectToTV() {
  connectionAttempts++;
  console.log(`\n[tilraun ${connectionAttempts}] að tnejga við tv á ip og port ${TV_IP}:${TV_PORT}`);
  const nameBase64 = base64Encode(APP_NAME);

  //samsung vill að við notum secure websocket wss
  const protocol = 'wss://';
  const url = authToken && connectionAttempts > 1
  //reyna fyrst með token svo an token, kannski breyta þessu seinna í bara án token?
    ? `${protocol}${TV_IP}:${TV_PORT}/api/v2/channels/samsung.remote.control?name=${nameBase64}&token=${authToken}`
    : `${protocol}${TV_IP}:${TV_PORT}/api/v2/channels/samsung.remote.control?name=${nameBase64}`;

  console.log(`url: ${url}`);
//open connection
  ws = new WebSocket(url, {
    rejectUnauthorized: false
  });

  ws.on('open', () => {
    console.log('WebSocket tenging komin!');
  });
//fra samsung tv
  ws.on('message', (msg) => {
    const data = msg.toString();
    console.log('frá samsung tv:', data);
//reyna breyta yfir i javascript object
    try {
      const parsed = JSON.parse(data);

      // authorization
      if (parsed.event === 'ms.channel.connect') {
        console.log('\n authorization gekk');
        //.egar authorized, þá vista token
        if (parsed.data?.token) {
          authToken = parsed.data.token;
          console.log('tokens:', authToken);
        }
        //ef authorization virkar ekki
      } else if (parsed.event === 'ms.channel.unauthorized') {
        console.log('\n Authorization gekk ekki');
        console.log('Tekka Developer Mode er enabled Apps í settings');
        //tv er ready
      } else if (parsed.event === 'ms.channel.ready') {
        console.log('✓ TV er ready\n');
      }
      //ef samsung skilaboð er ekki json
    } catch (e) {
    }
  });
//ef td ip er rangt
  ws.on('error', (error) => {
    console.error('WebSocket error:', error.message);
  });
//keyrist þegar connection lokast
  ws.on('close', (code, reason) => {
    console.log(`\n WebSocket connection lokuð. Code: ${code}, Reason: ${reason.toString() || 'None'}`);
    ws = null;

    // 10 sek þangað til reconnect aftur (gef tima til að authorize á tv)
    const delay = 10000;
    console.log(`reconnect eftir ${delay/1000} sek.`);
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(connectToTV, delay);
  });
}

// kalla á function til að tengjast
connectToTV();

// ræsa server og json reading
const app = express();
app.use(bodyParser.json());

//status endpoint
app.get('/status', (_req, res) => {
    const isConnected = ws !== null && ws.readyState === WebSocket.OPEN;
    res.json({
        connected: isConnected,
        wsState: ws ? ws.readyState : null,
        tvIp: TV_IP,
        hasToken: !!authToken
    });
});

// fyrir key skipanir
function sendKey(key: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('TV not connected');
  const message = {
    method: "ms.remote.control",
    params: { Cmd: "Click", DataOfCmd: key, Option: "false", TypeOfRemote: "SendRemoteKey" }
  };
  ws.send(JSON.stringify(message));
  console.log(`KEY sent: ${key}`);
}

//opna app
function launchApp(appId: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('TV not connected');
  const message = {
    method: "ms.channel.emit",
    params: {
      channel: "webappmanager",
      payload: { operation: "execute", id: appId }
    }
  };
  ws.send(JSON.stringify(message));
  console.log(`App launched: ${appId}`);
}

// endpoints
app.post('/tv', (req, res) => {
  try {
    const { action } = req.body;
    if (!action) {
      return res.status(400).json({ error: 'Action is required' });
    }

    // samsung key skipanir
    const keyCommands: Record<string, string> = {
      volup: 'KEY_VOLUP',
      voldown: 'KEY_VOLDOWN',
      home: 'KEY_HOME',
      channelup: 'KEY_CHUP',
      channeldown: 'KEY_CHDOWN',
      power: 'KEY_POWER',
    };

    // App id
    const appCommands: Record<string, string> = {
      netflix: 'org.tizen.netflix-1.0',
      disney: 'org.tizen.disneyplus'
    };

    if (keyCommands[action]) {
      sendKey(keyCommands[action]);
    } else if (appCommands[action]) {
      launchApp(appCommands[action]);
    } else {
      return res.status(400).json({
        error: 'Unknown action',
        validActions: [...Object.keys(keyCommands), ...Object.keys(appCommands)]
      });
    }

    res.json({ success: true, message: 'Command sent', action });
  } catch (error) {
    console.error('Error:', error);
    res.status(503).json({ error: error instanceof Error ? error.message : 'Failed' });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`fjarstyringsamsung Server Started`);
    console.log(`TV: ${TV_IP}:${TV_PORT}`);
    console.log(`Auth Token: ${authToken ? 'will reuse' : 'None'}`);
});
