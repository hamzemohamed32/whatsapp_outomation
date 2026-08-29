import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number.parseInt(process.env.WEBHOOK_TEST_PORT ?? '3099', 10);
const secret = process.env.WEBHOOK_TEST_SECRET;

if (!secret || secret.length < 16) {
  throw new Error('Set WEBHOOK_TEST_SECRET to at least 16 characters');
}

function signatureIsValid(body, supplied) {
  if (!supplied) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (request.method !== 'POST' || request.url !== '/openwa') {
    response.writeHead(404);
    response.end();
    return;
  }

  const chunks = [];
  request.on('data', chunk => chunks.push(chunk));
  request.on('end', () => {
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const signatureValid = signatureIsValid(rawBody, request.headers['x-openwa-signature']);
    let payload;

    try {
      payload = JSON.parse(rawBody);
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ accepted: false, reason: 'invalid_json' }));
      return;
    }

    const summary = {
      event: payload.event,
      sessionId: payload.sessionId,
      deliveryId: payload.deliveryId,
      idempotencyKey: payload.idempotencyKey,
      timestamp: payload.timestamp,
      signatureValid,
      data: payload.data,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

    response.writeHead(signatureValid ? 200 : 401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ accepted: signatureValid }));
  });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Webhook test receiver listening on http://127.0.0.1:${port}/openwa\n`);
});
