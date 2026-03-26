const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const { verifyCaller, AuthError } = require('../lib/auth');

function generateKeypair() {
  const out = execFileSync('vestauth', ['primitives', 'keypair', '--pp'], { encoding: 'utf8' });
  return JSON.parse(out);
}

function signRequest(method, url, uid, privateJwk) {
  const out = execFileSync('vestauth', [
    'primitives', 'headers',
    method, url,
    '--uid', uid,
    '--private-jwk', JSON.stringify(privateJwk),
  ], { encoding: 'utf8' });
  const raw = JSON.parse(out);
  // Node.js HTTP normalizes headers to lowercase
  const headers = {};
  for (const [k, v] of Object.entries(raw)) {
    headers[k.toLowerCase()] = v;
  }
  return headers;
}

function makeConfig(uid, publicJwk) {
  return {
    callers: {
      [uid]: {
        callerId: 'agentbox',
        uid,
        publicJwk,
      },
    },
  };
}

function makeReq(method, url, headers) {
  const parsed = new URL(url);
  return {
    method,
    url: parsed.pathname + parsed.search,
    headers: {
      host: parsed.host,
      ...headers,
    },
    protocol: parsed.protocol.replace(':', ''),
  };
}

describe('auth', () => {
  const keypair = generateKeypair();
  const uid = 'agent-testauth001';
  const url = 'http://localhost:9090/agents';
  const config = makeConfig(uid, keypair.public_jwk);

  it('verifies a valid signature and returns caller identity', () => {
    const headers = signRequest('GET', url, uid, keypair.private_jwk);
    const req = makeReq('GET', url, headers);
    const result = verifyCaller(req, config);
    assert.equal(result.callerId, 'agentbox');
    assert.equal(result.uid, uid);
  });

  it('rejects request with missing Signature header', () => {
    const headers = signRequest('GET', url, uid, keypair.private_jwk);
    delete headers['signature'];
    const req = makeReq('GET', url, headers);
    try {
      verifyCaller(req, config);
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof AuthError);
      assert.equal(err.statusCode, 401);
      assert.match(err.message, /Missing signature/);
    }
  });

  it('rejects request with missing Signature-Input header', () => {
    const headers = signRequest('GET', url, uid, keypair.private_jwk);
    delete headers['signature-input'];
    const req = makeReq('GET', url, headers);
    try {
      verifyCaller(req, config);
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof AuthError);
      assert.equal(err.statusCode, 401);
    }
  });

  it('rejects request with missing Signature-Agent header', () => {
    const headers = signRequest('GET', url, uid, keypair.private_jwk);
    delete headers['signature-agent'];
    const req = makeReq('GET', url, headers);
    try {
      verifyCaller(req, config);
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof AuthError);
      assert.equal(err.statusCode, 401);
    }
  });

  it('rejects signature from UID not in config', () => {
    const unknownUid = 'agent-unknownagent99';
    const headers = signRequest('GET', url, unknownUid, keypair.private_jwk);
    const req = makeReq('GET', url, headers);
    try {
      verifyCaller(req, config);
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof AuthError);
      assert.equal(err.statusCode, 403);
      assert.match(err.message, /Unknown agent UID/);
    }
  });

  it('rejects signature from a different keypair', () => {
    const otherKeypair = generateKeypair();
    const headers = signRequest('GET', url, uid, otherKeypair.private_jwk);
    const req = makeReq('GET', url, headers);
    try {
      verifyCaller(req, config);
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof AuthError);
      assert.equal(err.statusCode, 401);
    }
  });

  it('works with POST requests', () => {
    const postUrl = 'http://localhost:9090/agents/test-agent/restart';
    const headers = signRequest('POST', postUrl, uid, keypair.private_jwk);
    const req = makeReq('POST', postUrl, headers);
    const result = verifyCaller(req, config);
    assert.equal(result.callerId, 'agentbox');
  });

  it('works with URL query parameters', () => {
    const queryUrl = 'http://localhost:9090/agents/test-agent/logs?service=agent&tail=100';
    const headers = signRequest('GET', queryUrl, uid, keypair.private_jwk);
    const req = makeReq('GET', queryUrl, headers);
    const result = verifyCaller(req, config);
    assert.equal(result.callerId, 'agentbox');
  });

  it('supports multiple callers in config', () => {
    const keypair2 = generateKeypair();
    const uid2 = 'agent-secondcaller42';
    const multiConfig = {
      callers: {
        [uid]: { callerId: 'agentbox', uid, publicJwk: keypair.public_jwk },
        [uid2]: { callerId: 'agent-pm', uid: uid2, publicJwk: keypair2.public_jwk },
      },
    };

    const headers1 = signRequest('GET', url, uid, keypair.private_jwk);
    const req1 = makeReq('GET', url, headers1);
    assert.equal(verifyCaller(req1, multiConfig).callerId, 'agentbox');

    const headers2 = signRequest('GET', url, uid2, keypair2.private_jwk);
    const req2 = makeReq('GET', url, headers2);
    assert.equal(verifyCaller(req2, multiConfig).callerId, 'agent-pm');
  });
});
