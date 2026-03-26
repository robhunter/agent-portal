const { execFileSync } = require('child_process');
const { getCallerByUid } = require('./config');

class AuthError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}

function verifyCaller(req, config) {
  const signature = req.headers['signature'];
  const signatureInput = req.headers['signature-input'];
  const signatureAgent = req.headers['signature-agent'];

  if (!signature || !signatureInput || !signatureAgent) {
    throw new AuthError('Missing signature headers', 401);
  }

  const uidMatch = signatureAgent.match(/agent-[a-z0-9]+/);
  if (!uidMatch) {
    throw new AuthError('Could not extract agent UID from Signature-Agent header', 401);
  }
  const uid = uidMatch[0];

  const caller = getCallerByUid(config, uid);
  if (!caller) {
    throw new AuthError(`Unknown agent UID: ${uid}`, 403);
  }

  const url = `${req.protocol || 'http'}://${req.headers.host || 'localhost'}${req.url}`;

  let result;
  try {
    result = execFileSync('vestauth', [
      'primitives', 'verify',
      req.method,
      url,
      '--signature', signature,
      '--signature-input', signatureInput,
      '--signature-agent', signatureAgent,
      '--public-jwk', JSON.stringify(caller.publicJwk),
    ], { encoding: 'utf8', timeout: 5000 });
  } catch (err) {
    const stderr = err.stderr || '';
    if (stderr.includes('EXPIRED') || stderr.includes('expired')) {
      throw new AuthError('Signature expired', 401);
    }
    if (stderr.includes('INVALID') || stderr.includes('invalid') || stderr.includes('SIGNATURE_VERIFICATION_FAILED')) {
      throw new AuthError('Signature verification failed', 401);
    }
    throw new AuthError(`Signature verification error: ${stderr.trim() || err.message}`, 401);
  }

  return { callerId: caller.callerId, uid: caller.uid };
}

module.exports = { verifyCaller, AuthError };
