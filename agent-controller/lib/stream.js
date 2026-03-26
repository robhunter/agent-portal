const { spawn } = require('child_process');

function sseHeaders(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
}

function sseData(res, data) {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sseEnd(res, data) {
  if (res.writableEnded) return;
  if (data) res.write(`event: done\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
}

function streamProcess(res, command, args, opts = {}) {
  sseHeaders(res);

  const proc = spawn(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });

  let killed = false;

  function onLine(stream, source) {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer
      for (const line of lines) {
        if (line.trim()) sseData(res, { source, line });
      }
    });
    stream.on('end', () => {
      if (buffer.trim()) sseData(res, { source, line: buffer });
    });
  }

  onLine(proc.stdout, 'stdout');
  onLine(proc.stderr, 'stderr');

  proc.on('close', (code) => {
    sseEnd(res, { exitCode: code });
  });

  proc.on('error', (err) => {
    sseData(res, { source: 'error', line: err.message });
    sseEnd(res, { exitCode: -1 });
  });

  // Clean up on client disconnect
  res.on('close', () => {
    if (!killed && !proc.killed) {
      killed = true;
      proc.kill('SIGTERM');
      // Force kill after 2 seconds if SIGTERM didn't work
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
      }, 2000).unref();
    }
  });

  return proc;
}

module.exports = { sseHeaders, sseData, sseEnd, streamProcess };
