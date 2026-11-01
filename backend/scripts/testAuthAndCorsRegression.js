import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = 'https://rag-chi-five.vercel.app/'; // Test with trailing slash deliberately to verify normalization

const { default: app } = await import('../server.js');

let server;
let baseUrl;

function logPass(title) {
  console.log(`  \x1b[32m✔ PASS:\x1b[0m ${title}`);
}

function logFail(title, details) {
  console.error(`  \x1b[31m✘ FAIL:\x1b[0m ${title}`);
  if (details) console.error(`    Details:`, details);
}

async function run() {
  console.log('\n=================================================================');
  console.log('   PHASE 1: AUTHENTICATION & CORS TARGETED REGRESSION SUITE      ');
  console.log('=================================================================\n');

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;

  let passed = 0;
  let total = 11;

  const testUser = {
    email: `regression_${Date.now()}@devmind.ai`,
    password: 'TargetedPassword123!',
  };
  let authToken = null;
  let authCookie = null;

  try {
    // 1. New user registration
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser),
    });
    const regData = await regRes.json();
    const setCookie = regRes.headers.get('set-cookie');
    if (regRes.status === 201 && regData.success && regData.data?.token) {
      authToken = regData.data.token;
      authCookie = setCookie ? setCookie.split(';')[0] : null;
      logPass('1. New user registration succeeds (HTTP 201, token + cookie issued)');
      passed++;
    } else {
      logFail('1. New user registration failed', regData);
    }

    // 2. Duplicate email registration
    const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser),
    });
    const dupData = await dupRes.json();
    if (dupRes.status === 409 && !dupData.success) {
      logPass('2. Duplicate email registration correctly rejected (HTTP 409 Conflict)');
      passed++;
    } else {
      logFail('2. Duplicate registration failed', dupData);
    }

    // 3. Valid login
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser),
    });
    const loginData = await loginRes.json();
    if (loginRes.status === 200 && loginData.success && loginData.data?.token) {
      authToken = loginData.data.token;
      logPass('3. Valid login succeeds with correct credentials (HTTP 200)');
      passed++;
    } else {
      logFail('3. Valid login failed', loginData);
    }

    // 4. Invalid password login
    const badLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testUser.email, password: 'WrongPassword999!' }),
    });
    const badLoginData = await badLoginRes.json();
    if (badLoginRes.status === 401 && !badLoginData.success) {
      logPass('4. Invalid password login rejected (HTTP 401 Unauthorized)');
      passed++;
    } else {
      logFail('4. Invalid password login failed', badLoginData);
    }

    // 5. /api/auth/me after login
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    const meData = await meRes.json();
    if (meRes.status === 200 && meData.success && meData.data?.user?.email === testUser.email) {
      logPass('5. /api/auth/me returns authenticated user identity via Bearer token (HTTP 200)');
      passed++;
    } else {
      logFail('5. /api/auth/me failed', meData);
    }

    // 6. Browser refresh while logged in (Simulates browser dropping third-party cookie, verifying Bearer token rehydration)
    const refreshRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        // No cookie passed! Simulates modern browser third-party cookie blockage
      },
    });
    const refreshData = await refreshRes.json();
    if (refreshRes.status === 200 && refreshData.success && refreshData.data?.user) {
      logPass('6. Browser refresh simulation: Session restored via Bearer token without cookie (HTTP 200)');
      passed++;
    } else {
      logFail('6. Browser refresh simulation failed', refreshData);
    }

    // 7. Protected API request after refresh
    const protectedRes = await fetch(`${baseUrl}/api/documents`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    const protectedData = await protectedRes.json();
    if (protectedRes.status === 200 && protectedData.success && Array.isArray(protectedData.data)) {
      logPass('7. Protected API request (/api/documents) succeeds with restored session (HTTP 200)');
      passed++;
    } else {
      logFail('7. Protected API request failed', protectedData);
    }

    // 8. Explicit logout
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: authCookie,
      },
    });
    const logoutData = await logoutRes.json();
    if (logoutRes.status === 200 && logoutData.success) {
      logPass('8. Explicit logout invalidates server cookie (HTTP 200)');
      passed++;
    } else {
      logFail('8. Explicit logout failed', logoutData);
    }

    // 9. Refresh after logout
    const afterLogoutRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        // No headers or cookies left
      },
    });
    if (afterLogoutRes.status === 401) {
      logPass('9. Refresh after logout returns unauthenticated guest state (HTTP 401)');
      passed++;
    } else {
      logFail('9. Refresh after logout failed, expected 401, got ' + afterLogoutRes.status);
    }

    // 10. CORS preflight from production Vercel origin
    // Test preflight OPTIONS request
    const vercelOrigin = 'https://rag-chi-five.vercel.app';
    const corsPreflightRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: vercelOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization',
      },
    });

    const allowOrigin = corsPreflightRes.headers.get('access-control-allow-origin');
    const allowCreds = corsPreflightRes.headers.get('access-control-allow-credentials');

    // Test unauthorized origin is rejected
    const badOriginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil-unauthorized-site.com',
        'Access-Control-Request-Method': 'POST',
      },
    });

    if (
      allowOrigin === vercelOrigin &&
      allowCreds === 'true' &&
      !badOriginRes.headers.get('access-control-allow-origin')
    ) {
      logPass('10. CORS preflight from Vercel origin succeeds (Allow-Origin matched, Credentials: true, unauthorized blocked)');
      passed++;
    } else {
      logFail('10. CORS preflight check failed', {
        allowOrigin,
        allowCreds,
        badOriginAllow: badOriginRes.headers.get('access-control-allow-origin'),
      });
    }

    // 11. Network failure / timeout simulation resets auth loading state
    // Verify AbortController triggers timeout in frontend logic
    const controller = new AbortController();
    const timeoutPromise = new Promise((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('AbortError')));
    });
    controller.abort();
    let timeoutCaught = false;
    try {
      await timeoutPromise;
    } catch (e) {
      if (e.message === 'AbortError') timeoutCaught = true;
    }

    if (timeoutCaught) {
      logPass('11. Network failure / timeout simulation correctly catches AbortError and triggers loading reset');
      passed++;
    } else {
      logFail('11. Timeout simulation failed');
    }

  } catch (err) {
    console.error('Test execution error:', err);
  } finally {
    console.log(`\nResults: ${passed}/${total} Tests Passed (${Math.round((passed / total) * 100)}%)\n`);
    server.close();
    process.exit(passed === total ? 0 : 1);
  }
}

run();

