/* Мини-драйвер Chrome через DevTools Protocol — для проверки сайта и скриншотов.
   Запуск:  node tools/cdp.js сценарий.json
   Сценарий: { "width":1440, "height":900, "mobile":false, "steps":[
     {"goto":"http://localhost:3000/?intro=0","wait":2500},   // открыть страницу и подождать (мс)
     {"eval":"window.scrollTo(0, 1200)","wait":1500},          // выполнить JS
     {"eval":"document.title","print":true},                   // выполнить и вывести результат
     {"mouse":[700,400],"wait":800},                           // навести мышь
     {"shot":"hero.jpg"}                                        // скриншот (рядом с файлом сценария)
   ]}
   Ошибки JS на странице выводятся в конце. */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const steps = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const W = steps.width || 1440, H = steps.height || 900;
const port = 9300 + Math.floor(Math.random() * 500);
const prof = path.join(require('os').tmpdir(), 'ctgj-cdp-prof-' + port);
const outDir = path.dirname(path.resolve(process.argv[2]));
const proc = spawn(CH, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, `--window-size=${W},${H}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let targets;
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.onopen = r);
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)); else if (m.method === 'Log.entryAdded' && (m.params.entry.level === 'error' || m.params.entry.level === 'warning')) logs.push('LOG ' + m.params.entry.level + ': ' + m.params.entry.text + (m.params.entry.url ? ' — ' + m.params.entry.url : '')); else if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' ')); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable'); // Log — ошибки браузера, в том числе нарушения CSP
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: !!steps.mobile });
  if (steps.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  for (const s of steps.steps) {
    if (s.goto) { await send('Page.navigate', { url: s.goto }); await sleep(s.wait || 1500); }
    if (s.eval) { const r = await send('Runtime.evaluate', { expression: s.eval, awaitPromise: true, returnByValue: true }); if (s.print) console.log('eval:', JSON.stringify(r.result?.result?.value ?? r.result)); await sleep(s.wait || 300); }
    if (s.shot) { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }); fs.writeFileSync(path.join(outDir, s.shot), Buffer.from(r.result.data, 'base64')); }
    if (s.mouse) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.mouse[0], y: s.mouse[1] }); await sleep(s.wait || 1200); }
    if (s.sleep) await sleep(s.sleep);
  }
  if (logs.length) console.log(logs.join('\n'));
  ws.close(); proc.kill();
  setTimeout(() => { try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} process.exit(0); }, 500);
})().catch((e) => { console.error(e); proc.kill(); process.exit(1); });
