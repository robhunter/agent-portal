const { execFile } = require('child_process');
const { getCallerByUid } = require('./config');

class AuthError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}

function verifyCaller(req, config) {
  return new Promise((resolve, reject) => {
    const signature = req.headers['signature'];
    const signatureInput = req.headers['signature-input'];
    const signatureAgent = req.headers['signature-agent'];

    if (!signature || !signatureInput || !signatureAgent) {
      return reject(new AuthError('Missing signature headers', 401));
    }

    // VestAuth UIDs follow the pattern agent-<alphanumeric>, but we allow
    // dashes, underscores, and mixed case to be forward-compatible.
    const uidMatch = signatureAgent.match(/agent-[a-zA-Z0-9_-]+/);
    if (!uidMatch) {
      return reject(new AuthError('Could not extract agent UID from Signature-Agent header', 401));
    }
    const uid = uidMatch[0];

    const caller = getCallerByUid(config, uid);
    if (!caller) {
      return reject(new AuthError(`Unknown agent UID: ${uid}`, 403));
    }

    // Reconstruct the URL as signed by the caller. This assumes the controller
    // is accessed directly (not behind a reverse proxy that rewrites Host).
    // If deployed behind a proxy, configure the proxy to pass the original Host
    // header, or set a trusted host in config.
    const url = `${req.protocol || 'http'}://${req.headers.host || 'localhost'}${req.url}`;

    // Note: VestAuth primitives verify only signs @authority (host) per RFC 9421.
    // Request body is NOT covered by the signature. This means a MITM could alter
    // POST body content. In our deployment, the controller is accessed via
    // localhost/host.docker.internal, making MITM impractical. If the controller
    // is ever exposed over a network, body signing (content-digest) should be added.
    execFile('vestauth', [
      'primitives', 'verify',
      req.method,
      url,
      '--signature', signature,
      '--signature-input', signatureInput,
      '--signature-agent', signatureAgent,
      '--public-jwk', JSON.stringify(caller.publicJwk),
    ], { encoding: 'utf8', timeout: 5000 }, (err, stdout, stderr) => {
      if (err) {
        const errOutput = stderr || '';
        if (errOutput.includes('EXPIRED') || errOutput.includes('expired')) {
          return reject(new AuthError('Signature expired', 401));
        }
        if (errOutput.includes('INVALID') || errOutput.includes('invalid') || errOutput.includes('SIGNATURE_VERIFICATION_FAILED')) {
          return reject(new AuthError('Signature verification failed', 401));
        }
        return reject(new AuthError(`Signature verification error: ${errOutput.trim() || err.message}`, 401));
      }
      resolve({ callerId: caller.callerId, uid: caller.uid });
    });
  });
}

module.exports = { verifyCaller, AuthError };
