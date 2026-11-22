const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const YAML = require('yaml'); // From the pinned Release Please toolchain.

const script = path.join(__dirname, 'publish-release-notes.cjs');
const workflow = YAML.parse(fs.readFileSync('.github/workflows/release-please.yml', 'utf8')).jobs;
const action = YAML.parse(fs.readFileSync('.github/actions/standalone-release/action.yml', 'utf8')).runs.steps;
const upload = action.find(step => step.id === 'standalone');
const tag = 'v0.1.2';
const name = 'OWASP-DecodeBox-Standalone-' + tag + '.html';
const title = 'v0.1.2';
const notes = '## [0.1.2](https://github.com/OWASP/DecodeBox/compare/v0.1.1...v0.1.2) (2026-11-22)\n\n### Fixed\n\n- Restore a preference.';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decodebox-release-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const gh = path.join(dir, 'gh');
  fs.copyFileSync(path.join(__dirname, 'fixtures/fake-gh.py'), gh);
  fs.chmodSync(gh, 0o755);
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.writeFileSync(path.join(dir, 'dist/decodebox.html'), '<html>offline</html>');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"version":"0.1.2"}');
  const file = path.join(dir, 'state.json');
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const write = state => fs.writeFileSync(file, JSON.stringify(state));
  write({ calls: [], release: { tag_name: tag, id: 901, name: title, body: notes, draft: false,
    published_at: '2026-11-22T00:00:00Z', assets: [] } });
  const env = { PATH: dir + ':' + process.env.PATH, HOME: dir, FAKE_GH_STATE: file, RUNNER_TEMP: dir,
    GITHUB_OUTPUT: path.join(dir, 'output'), GITHUB_REPOSITORY: 'OWASP/DecodeBox',
    GH_TOKEN: 'offline-fixture', RELEASE_TAG: tag, RELEASE_ID: '901', RELEASE_VERSION: '0.1.2',
    ORIGINAL_TITLE: title, ORIGINAL_NOTES: notes };
  function run(exe, args, success, overrides = {}) {
    const r = spawnSync(exe, args, { cwd: dir, env: { ...env, ...overrides }, encoding: 'utf8' });
    assert.ifError(r.error);
    assert.equal(r.status, success ? 0 : 1, r.stderr || r.stdout);
    return r.stderr;
  }
  const cli = (mode, success = true, overrides = {}) => run(process.execPath, [script, mode], success, overrides);
  const shell = (step, success = true) => run('bash', ['-eu', '-o', 'pipefail', '-c', step.run], success);
  function standalone(success = true) {
    shell(action[0]);
    shell(upload, success);
    if (success) {
      const receipt = fs.readFileSync(env.GITHUB_OUTPUT, 'utf8').trim();
      assert.match(receipt, /^digest=sha256:[a-f0-9]{64}$/);
      env.VERIFIED_DIGEST = receipt.slice('digest='.length);
    } else assert(!fs.existsSync(env.GITHUB_OUTPUT));
  }
  const change = fn => { const state = read(); fn(state); write(state); };
  const fault = value => change(state => { state.fault = value; });
  const patchCount = () => read().calls.filter(([args]) => args[2] === 'PATCH').length;
  return { cli, shell, standalone, read, change, fault, patchCount, env, dir };
}

test('normal release records an idempotent baseline, verifies the build digest, then formats once', t => {
  const f = fixture(t);
  f.cli('baseline');
  assert(f.read().release.body.startsWith(notes + '\n\n<!-- decodebox-release-notes:v1 baseline '));
  const hashes = [notes, title].map(text => createHash('sha256').update(text).digest('hex'));
  assert(f.read().release.body.includes('v1 baseline ' + hashes.join(' ') + ' '));
  assert.equal(f.read().release.name, title);
  f.cli('baseline');
  assert.equal(f.patchCount(), 1);
  f.cli('format', false); // No asset yet.
  f.standalone();
  f.cli('format', false, { VERIFIED_DIGEST: 'sha256:' + '0'.repeat(64) });
  assert.equal(f.patchCount(), 1);
  f.cli('format');
  const release = f.read().release;
  assert.equal(release.name, 'OWASP DecodeBox ' + tag);
  assert.equal(release.body.split('## Standalone Edition').length, 2);
  assert.equal(release.body.split('@alice made their first contribution').length, 2);
  assert.match(release.body, /<!-- decodebox-release-notes:v1 formatted /);
  f.cli('repair');
  assert.deepEqual(f.read().release, release);
  assert.equal(f.patchCount(), 2);
});

test('only the creation response can establish a missing baseline after an interrupted write', t => {
  const f = fixture(t);
  f.fault('reject PATCH');
  f.cli('baseline', false);
  assert.equal(f.read().release.body, notes);
  f.standalone();
  f.fault();
  f.cli('repair', false); // Recovery cannot bless an unmarked body, even with a valid asset.
  f.fault('lose PATCH response');
  f.cli('baseline', false);
  f.fault();
  f.cli('baseline');
  assert.equal(f.patchCount(), 2);
  f.cli('repair');
  assert.equal(f.patchCount(), 3);
  f.fault('concurrent edit');
  f.cli('repair', false); // The no-op check also observes edits during asset verification.
  assert.equal(f.patchCount(), 3);
});

for (const fault of ['upload', 'digest']) {
  test(fault + ' failure preserves the original baseline and emits no verified digest', t => {
    const f = fixture(t);
    f.cli('baseline');
    const initial = f.read().release.body;
    f.fault(fault);
    f.standalone(false);
    f.cli('repair', false);
    assert.equal(f.read().release.body, initial);
    assert.equal(f.patchCount(), 1);
    f.fault();
    f.standalone();
    f.cli('repair');
    assert.equal(f.patchCount(), 2);
  });
}

for (const fault of ['reject PATCH', 'lose PATCH response', 'invalid PATCH reply']) {
  test('recover after ' + fault + ' and repeat without a second applied update', t => {
    const f = fixture(t);
    f.cli('baseline');
    f.standalone();
    f.fault(fault);
    f.cli('format', false);
    f.fault();
    const before = f.patchCount();
    f.cli('repair');
    const saved = f.read().release;
    f.cli('repair');
    assert.equal(f.patchCount(), before + Number(fault === 'reject PATCH'));
    assert.deepEqual(f.read().release, saved);
    assert.equal(saved.body.split("## What's Changed").length, 2);
  });
}

test('unmarked, tampered, partial and manually edited releases fail closed', t => {
  const f = fixture(t);
  f.standalone();
  f.cli('repair', false);
  f.cli('baseline', false, { ORIGINAL_TITLE: 'Different creation title' });
  assert.equal(f.patchCount(), 0);
  f.cli('baseline');
  const baseline = f.read().release;
  const wrongSeal = body => body.replace(/[a-f0-9]{64} -->$/, '0'.repeat(64) + ' -->');
  for (const body of [baseline.body + ' ', baseline.body.replace('preference.', 'preference!'),
    wrongSeal(baseline.body), baseline.body.slice(0, -3), baseline.body + baseline.body, notes]) {
    f.change(s => { s.release.body = body; });
    f.cli('repair', false);
    assert.equal(f.read().release.body, body);
  }
  f.change(s => { s.release = { ...baseline, name: 'Maintainer title' }; });
  f.cli('repair', false);
  f.change(s => { s.release = baseline; });
  f.fault('concurrent edit');
  f.cli('repair', false);
  assert.equal(f.read().release.name, 'Edited during contributor lookup');
  assert.equal(f.patchCount(), 1);
  f.fault('contributors');
  f.change(s => { s.release.name = 'OWASP DecodeBox ' + tag; });
  f.cli('repair');
  const formatted = f.read().release;
  const [, payload] = f.read().calls.at(-1);
  assert.deepEqual(Object.keys(payload), ['body']); // Expected title already present.
  assert(!formatted.body.includes('## New Contributors'));
  f.change(s => { s.release.name = title; });
  f.cli('repair', false);
  f.change(s => { s.release = { ...formatted, body: wrongSeal(formatted.body) }; });
  f.cli('repair', false);
  assert.equal(f.patchCount(), 2);
});

test('repair validates the release identity and the uploaded bytes before touching metadata', t => {
  const f = fixture(t);
  for (const value of ['v0.1.0', 'v0.1.1', 'v01.1.2', '0.1.2', 'v1.2.3-rc.1', '../main', '']) {
    f.cli('repair', false, { RELEASE_TAG: value });
  }
  assert.equal(f.read().calls.length, 0);
  f.cli('baseline');
  f.standalone();
  const release = f.read().release;
  for (const bad of [{ draft: true }, { published_at: null }, { tag_name: 'v0.3.5' }, { id: 0 },
    { assets: [] }, { assets: [{ ...release.assets[0], state: 'open' }] },
    { assets: [{ ...release.assets[0], name: 'wrong.html' }] }, { assets: [{ ...release.assets[0], digest: null }] }]) {
    f.change(s => { s.release = { ...release, ...bad }; });
    f.cli('repair', false);
  }
  f.change(s => { s.release = release; });
  fs.appendFileSync(path.join(f.dir, name), 'modified');
  f.cli('repair', false);
  f.fault('invalid JSON');
  f.cli('repair', false);
  assert.equal(f.patchCount(), 1);
});

test('workflow routes are exclusive and formatting requires the baseline and verified upload', t => {
  const f = fixture(t);
  const normal = workflow['release-please'], manual = workflow.maintenance;
  assert.equal(normal.if, "github.ref == 'refs/heads/main' && inputs.release_tag == '' && inputs.repair_release_notes_tag == ''");
  assert.equal(manual.if, "github.ref == 'refs/heads/main' && (inputs.release_tag != '' || inputs.repair_release_notes_tag != '')");
  assert.deepEqual(manual.permissions, { contents: 'write' });
  const [conflict, checkout, rebuild, repair] = manual.steps;
  assert.equal(manual.steps.length, 4);
  assert.equal(conflict.if, "inputs.release_tag != '' && inputs.repair_release_notes_tag != ''");
  f.shell(conflict, false);
  assert(checkout.uses.startsWith('actions/checkout@'));
  assert.equal(rebuild.if, "inputs.release_tag != '' && inputs.repair_release_notes_tag == ''");
  assert.equal(rebuild.uses, './.github/actions/standalone-release');
  assert.equal(repair.if, "inputs.repair_release_notes_tag != '' && inputs.release_tag == ''");
  assert.equal(repair.run, 'node .github/scripts/publish-release-notes.cjs repair');
  const tail = normal.steps.slice(normal.steps.findIndex(step => step.id === 'release'));
  assert.deepEqual(tail.map(s => s.id || s.run), ['release', 'baseline', 'standalone',
    'node .github/scripts/publish-release-notes.cjs format', 'node .github/scripts/release-notes.cjs']);
  assert.equal(tail[1].if, "steps.release.outputs.release_created == 'true'");
  assert.equal(tail[2].if, "success() && steps.baseline.outcome == 'success'");
  assert.equal(tail[3].if, "success() && steps.release.outputs.release_created == 'true' && steps.baseline.outcome == 'success' && steps.standalone.outcome == 'success'");
  assert.equal(upload.if, "success() && steps.build.outcome == 'success'");
  assert.equal(tail[3].env.VERIFIED_DIGEST, '$' + '{{ steps.standalone.outputs.digest }}');
  f.standalone();
  assert.equal(f.patchCount(), 0);
  assert.equal(f.read().release.body, notes);
  assert.equal(f.read().release.name, title);
});
