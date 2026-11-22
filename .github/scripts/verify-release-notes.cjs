const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parseConventionalCommits } = require('release-please/build/src/commit');
const { Changelog } = require('release-please/build/src/updaters/changelog');
const { PullRequestBody } = require('release-please/build/src/util/pull-request-body');
const { buildNotes } = require('./release-notes.cjs');
const { publishReleaseNotes } = require('./publish-release-notes.cjs');

// Exercise the actual publication entry point. Only GitHub's HTTP boundary is mocked.
async function testPublication(options) {
  const repository = 'OWASP/DecodeBox';
  const url = 'https://github.com/' + repository;
  function change(message, number, digit) {
    const sha = digit.repeat(40);
    return { sha, message, pullRequest: { number, mergeCommitOid: sha, baseBranchName: 'main', body: '' } };
  }
  const optionsFor = version => ({
    ...options, version, previousTag: 'v0.1.1', currentTag: 'v' + version,
  });
  const fix = change('fix(ui): restore the folder preference', 31, 'a');
  const fixes = await buildNotes(parseConventionalCommits([fix]), optionsFor('0.1.2'));
  const changes = await buildNotes(parseConventionalCommits([
    fix, change('fix: preserve existing settings', 31, 'b'),
    change('feat(data): accept another format\n\nBREAKING CHANGE: update the input format', 32, 'c'),
    change('perf: reduce processing time (#33)', 33, 'd'),
    change('security: validate imported recipes', 34, 'e'),
    change('deps: update the parser', 35, 'f'),
    change('docs: update an internal checklist', 36, '1'),
    { sha: '2'.repeat(40), message: 'fix: handle empty files', pullRequest: { number: 39, baseBranchName: 'main', body: '' } },
  ]), optionsFor('0.2.0'));
  const expected = "## What's Changed";
  const first = (login, number) => `* @${login} made their first contribution in ${url}/pull/${number}`;
  const nativeChanges = `## What's Changed\n* An unrelated label-based title by @regular in ${url}/pull/31\n* Another by @regular in ${url}/pull/33`;
  const native = [nativeChanges, '## New Contributors', first('new-user', 32), first('NEW-USER', 32),
    first('incorrect', 31), first('new-user', 37).replace(repository, 'another/project'),
    first('unavailable', 38), first('another-user', 34), '**Full Changelog**: ...'].join('\n');
  async function exercise(original, generated, settings = {}) {
    const { releaseData } = PullRequestBody.parse('Proposed release.\n\n---\n\n' + original + '\n\n---\n\nRelease footer.');
    const tag = 'v' + releaseData[0].version.toString();
    const digest = 'sha256:' + 'a'.repeat(64);
    const input = { repository, tag, version: tag.slice(1), id: '901', title: tag,
      original: releaseData[0].notes, digest, ...settings };
    const release = { id: 901, tag_name: tag, name: tag, draft: false, published_at: '2026-11-20T01:00:00Z',
      body: settings.liveBody ?? original, assets: [{ id: 22, name: 'OWASP-DecodeBox-Standalone-' + tag + '.html',
        state: 'uploaded', size: 128, digest }] };
    const calls = [], warnings = [];
    let saved;
    const api = async (method, path, payload) => {
      calls.push([method, path]);
      if (method === 'POST' && path === 'releases/generate-notes') {
        assert.deepEqual(payload, { previous_tag_name: 'v0.1.1', tag_name: tag });
        if (generated instanceof Error) throw generated;
        return { body: generated };
      }
      if (method === 'GET' && path.startsWith('pulls/')) {
        const number = Number(path.slice(6));
        if (number === 38) throw new Error('unavailable');
        const login = { 31: 'regular', 32: 'new-user', 34: 'another-user' }[number];
        assert(login, 'unexpected PR lookup');
        return { number, merged_at: '2026-11-20', base: { ref: 'main', repo: { full_name: repository } }, user: { login } };
      }
      assert.equal(path, 'releases/901');
      if (method === 'GET') return { ...release };
      assert.equal(method, 'PATCH');
      saved = payload;
      return { ...Object.assign(release, payload) };
    };
    await publishReleaseNotes({ ...input, mode: 'baseline' }, api);
    const body = await publishReleaseNotes({ ...input, mode: 'format' }, api, warning => warnings.push(warning));
    assert.deepEqual(saved, { name: 'OWASP DecodeBox ' + tag, body });
    return { body, calls, warnings };
  }
  const full = await exercise(changes, native);
  const [main, credits] = full.body.split('## New Contributors');
  for (const section of ['Added', 'Changed', 'Fixed', 'Security', 'Maintenance']) assert(main.includes('### ' + section));
  assert(main.includes('BREAKING CHANGES') && main.includes('update the input format') && main.includes('**data:**'));
  assert(main.includes('v0.1.1...v0.2.0') && main.includes('handle empty files') && !main.includes('/pull/39'));
  assert(!main.includes('internal checklist') && !main.includes('unrelated label-based title'));
  assert.equal(main.split(url + '/pull/31)').length - 1, 1, 'one PR link for two distinct fixes');
  assert.equal((main.match(/\[#33\]/g) || []).length, 1, 'squash title already references its PR');
  assert(main.includes('[#33](' + url + '/pull/33)'));
  assert(credits.includes('@new-user made their first contribution in [#32](' + url + '/pull/32)'));
  assert(credits.includes('@another-user') && !credits.includes('@regular') && !credits.includes('@incorrect'));
  assert.equal((credits.match(/made their first contribution/g) || []).length, 2);
  assert.equal(full.calls.filter(([, path]) => path === 'pulls/32').length, 1);
  assert(full.warnings.length > 0 && !full.calls.some(([, path]) => path === 'pulls/37'));
  for (const text of [expected, '## New Contributors', '## Standalone Edition']) assert.equal(full.body.split(text).length, 2);
  assert(full.body.includes('OWASP-DecodeBox-Standalone-v0.2.0.html') && full.body.includes('open it in your browser'));
  assert(full.body.includes('offline') && full.body.includes('locally') && full.body.includes('no installation or server'));
  for (const metadata of [nativeChanges, '## New Contributors\n' + first('incorrect', 31), new Error('rate limited'), null]) {
    const result = await exercise(fixes, metadata);
    assert(result.body.includes('### Fixed') && !result.body.includes('### Added') && !result.body.includes('## New Contributors'));
    assert(result.body.includes('OWASP-DecodeBox-Standalone-v0.1.2.html'));
    if (typeof metadata !== 'string') assert(result.warnings.length);
  }
  for (const tag of ['v0.1.0', 'v0.1.1']) await assert.rejects(exercise(fixes, native, { tag }), /protected/);
  await assert.rejects(exercise(fixes, nativeChanges, { liveBody: 'A maintainer edited these notes.' }), /creation response/);
  return full.body;
}

async function test() {
  // Both messages are from PR #25. The abbreviated source SHA also reproduces the Aspell error.
  const source = '25e50aee69509511979e2c53b622a6bb89bd0d29';
  const merge = 'f86d350b9a56f8e982140c2fc1a51eb606e34b39';
  const title = 'fix: improve sidebar quick-access defaults';
  const pullRequest = { number: 25, mergeCommitOid: merge, baseBranchName: 'main', body: '' };
  const raw = [
    { sha: merge, message: 'Merge pull request #25 from OWASP/fix/sidebar-quick-access-defaults\n\n' + title, pullRequest },
    { sha: source, message: title, pullRequest },
  ];
  const commits = parseConventionalCommits(raw);
  assert.equal(commits.length, 2, 'the merge body and original commit are both parsed');
  const options = {
    owner: 'OWASP', repository: 'DecodeBox', version: '0.1.1', previousTag: 'v0.1.0', currentTag: 'v0.1.1',
    changelogSections: JSON.parse(fs.readFileSync('release-please-config.json'))['changelog-sections'],
  };
  const first = await buildNotes(commits, options);
  assert.equal(first.split('improve sidebar quick-access defaults').length - 1, 1);
  assert(first.includes('[`25e50ae`](https://github.com/OWASP/DecodeBox/commit/' + source + ')'));
  assert(!first.includes(merge));
  assert.equal(first.split('/pull/25)').length - 1, 1);
  const separatePR = { ...raw[1], sha: 'a'.repeat(40), pullRequest: { number: 27, body: '', mergeCommitOid: 'a'.repeat(40) } };
  const scoped = await buildNotes(parseConventionalCommits([...raw, separatePR]), options);
  assert.equal(scoped.split('improve sidebar quick-access defaults').length - 1, 2, 'distinct PRs retain their notes');
  const breaking = { ...raw[0], message: title + '\n\nBREAKING CHANGE: read the new format' };
  const distinct = await buildNotes(parseConventionalCommits([breaking, raw[1]]), options);
  assert(distinct.includes('read the new format') && distinct.includes(merge) && distinct.includes(source));
  const uniqueMerge = { ...raw[0], message: 'fix: resolve a separate integration issue' };
  assert((await buildNotes(parseConventionalCommits([uniqueMerge, raw[1]]), options)).includes(merge));

  const second = await buildNotes(parseConventionalCommits([
    { sha: 'b'.repeat(40), message: 'feat(ui): add another format\n\nBREAKING CHANGE: use the new format' },
    { sha: 'c'.repeat(40), message: 'fix: retain links\n\nCloses #25' },
  ]), { ...options, version: '0.2.0', previousTag: 'v0.1.1', currentTag: 'v0.2.0' });
  assert(second.includes('BREAKING') && second.includes('### Added') && second.includes('### Fixed'));
  assert(second.includes('/issues/25'));
  const historical = '# Changelog\n\n## [0.1.0] - 2026-11-20\n\n### Fixed\n\n- A manual entry.\n';
  let changelog = historical;
  for (const notes of [first, second]) {
    const body = PullRequestBody.parse('Proposed release.\n\n---\n\n' + notes + '\n\n---\n\nRelease footer.');
    assert.equal(body.releaseData[0].notes, notes);
    changelog = new Changelog({ changelogEntry: notes }).updateContent(changelog);
  }
  assert(changelog.endsWith(historical.slice(historical.indexOf('##'))));
  assert(!changelog.includes('\n\n\n') && !/^\* /m.test(changelog));
  if (process.argv[2]) fs.writeFileSync(process.argv[2], changelog);
  const release = await testPublication(options);
  if (process.argv[3]) fs.writeFileSync(process.argv[3], release + '\n');
  console.log('Release Please merge provenance, Markdown, release body and successive changelog updates passed.');
}

test().catch(error => { console.error(error); process.exitCode = 1; });
