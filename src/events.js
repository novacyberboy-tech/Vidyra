'use strict';
// Server-Sent Events hub: pushes job updates to every open browser tab.
class EventHub {
  constructor() {
    this.clients = new Set();
    this.heartbeat = setInterval(() => this.write(': keep-alive\n\n'), 20_000);
    this.heartbeat.unref();
  }

  add(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  }

  send(event, data) {
    this.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  write(text) {
    for (const client of this.clients) client.write(text);
  }

  close() {
    clearInterval(this.heartbeat);
    for (const client of this.clients) client.end();
    this.clients.clear();
  }
}

module.exports = { EventHub };
