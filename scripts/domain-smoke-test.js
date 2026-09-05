process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'domain-smoke-test-only-secret';

const app = require('../app');
const pool = require('../config/db');

async function request(base, pathname, options = {}) {
  return fetch(`${base}${pathname}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
    ...options
  });
}

async function run() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    console.log('Checking health route...');
    const health = await request(base, '/api/health');
    if (health.status !== 200) throw new Error(`health returned ${health.status}`);
    if (!String(health.headers.get('x-robots-tag')).includes('noindex')) {
      throw new Error('health route is missing noindex protection');
    }
    const body = await health.json();
    if (body.status !== 'ok') throw new Error('health payload is invalid');

    console.log('Checking landing page...');
    const landing = await request(base, '/');
    if (landing.status !== 200) throw new Error(`landing returned ${landing.status}`);
    if (!String(landing.headers.get('content-security-policy')).includes("default-src 'self'")) {
      throw new Error('landing page is missing the content security policy');
    }
    if (!(await landing.text()).includes('Voxel Veda')) throw new Error('landing branding missing');

    const login = await request(base, '/login');
    if (!String(login.headers.get('x-robots-tag')).includes('noindex')) {
      throw new Error('login route is missing noindex protection');
    }
    if (!String(login.headers.get('cache-control')).includes('no-store')) {
      throw new Error('login route is missing private no-store caching');
    }

    console.log('Checking legacy redirect...');
    const legacy = await request(base, '/login.html?message=test');
    if (legacy.status !== 302 || legacy.headers.get('location') !== '/login?message=test') {
      throw new Error('legacy login redirect is invalid');
    }

    console.log('Checking protected admin route...');
    const admin = await request(base, '/admin');
    if (admin.status !== 302 || !String(admin.headers.get('location')).startsWith('/login?returnTo=')) {
      throw new Error('anonymous admin route is not protected');
    }

    console.log('Checking HTML 404...');
    const missing = await request(base, '/not-a-real-page', { headers: { Accept: 'text/html' } });
    if (missing.status !== 404) throw new Error(`HTML 404 returned ${missing.status}`);

    console.log('Checking private files and API errors...');
    const upload = await request(base, '/uploads/private-test.pdf');
    if (upload.status !== 404) throw new Error(`retired raw upload route returned ${upload.status}`);
    const missingApi = await request(base, '/api/not-a-real-route');
    if (missingApi.status !== 404 || !String(missingApi.headers.get('content-type')).includes('application/json')) {
      throw new Error('unknown API route did not return JSON 404');
    }
    console.log('Domain smoke tests passed.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end().catch(() => {});
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
