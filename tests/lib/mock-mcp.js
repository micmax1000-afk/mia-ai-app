// Server MCP finto (Streamable HTTP) per i test
const http = require('http');
const png1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const log = [];
const tools = [
  { name: 'add', description: 'Somma due numeri', inputSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', additionalProperties: false, properties: { a: { type: 'number' }, b: { type: ['number', 'null'], default: 0, description: 'secondo' } }, required: ['a'] }, annotations: { readOnlyHint: true } },
  { name: 'create_note', description: 'Crea una nota', inputSchema: { type: 'object', properties: { text: { anyOf: [{ type: 'string' }, { type: 'null' }] }, meta: { type: 'object' }, tag: { $ref: '#/$defs/Tag' } }, $defs: { Tag: { type: 'string', enum: ['x', 'y'] } } } },
  { name: 'ping', description: 'Senza argomenti', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'pic', description: 'Immagine', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'fail', description: 'Fallisce', inputSchema: { type: 'object', properties: {} } },
];
function reply(res, sse, id, result, error, extraHeaders) {
  const msg = JSON.stringify(Object.assign({ jsonrpc: '2.0', id }, error ? { error } : { result }));
  const h = Object.assign({ 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Mcp-Session-Id' }, extraHeaders || {});
  if (sse) { res.writeHead(200, Object.assign(h, { 'content-type': 'text/event-stream' })); res.end('event: message\ndata: ' + msg + '\n\n'); }
  else { res.writeHead(200, Object.assign(h, { 'content-type': 'application/json' })); res.end(msg); }
}
const srv = http.createServer((req, res) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'access-control-expose-headers': 'Mcp-Session-Id' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    const m = JSON.parse(body || '{}');
    log.push({ method: m.method, auth: req.headers.authorization, sid: req.headers['mcp-session-id'], proto: req.headers['mcp-protocol-version'] });
    if (req.headers.authorization !== 'Bearer segreto') { res.writeHead(401, { ...cors, 'content-type': 'application/json' }); return res.end('{"error":"no"}'); }
    if (m.method === 'initialize') return reply(res, false, m.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'MockMCP', version: '1' } }, null, { 'Mcp-Session-Id': 'sess-123' });
    if (m.method === 'notifications/initialized') { res.writeHead(202, cors); return res.end(); }
    if (req.headers['mcp-session-id'] !== 'sess-123') { res.writeHead(404, { ...cors, 'content-type': 'application/json' }); return res.end('{"error":"sessione"}'); }
    if (m.method === 'tools/list') return reply(res, true, m.id, { tools });
    if (m.method === 'tools/call') {
      const { name, arguments: a } = m.params;
      if (name === 'add') return reply(res, true, m.id, { content: [{ type: 'text', text: 'Risultato: ' + (a.a + (a.b || 0)) }] });
      if (name === 'create_note') return reply(res, false, m.id, { content: [{ type: 'text', text: 'Nota creata: ' + JSON.stringify(a) }] });
      if (name === 'ping') return reply(res, false, m.id, { content: [], structuredContent: { pong: true } });
      if (name === 'pic') return reply(res, false, m.id, { content: [{ type: 'image', data: png1, mimeType: 'image/png' }, { type: 'text', text: 'ecco' }] });
      if (name === 'fail') return reply(res, false, m.id, { isError: true, content: [{ type: 'text', text: 'Qualcosa è andato storto' }] });
    }
    reply(res, false, m.id, null, { code: -32601, message: 'Metodo non trovato' });
  });
});
srv.listen(8092, () => {});
module.exports = { srv, log };
