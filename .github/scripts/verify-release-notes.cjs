const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parseConventionalCommits } = require('release-please/build/src/commit');
const { Changelog } = require('release-please/build/src/updaters/changelog');
const { PullRequestBody } = require('release-please/build/src/util/pull-request-body');
const { buildNotes } = require('./release-notes.cjs');

async function test() {
  // Both messages are from PR #25. The abbreviated source SHA also reproduces the Aspell error.
  const source = '25e50aee69509511979e2c53b622a6bb89bd0d29';
  const merge = 'f86d350b9a56f8e982140c2fc1a51eb606e34b39';
  const title = 'fix: improve sidebar quick-access defaults';
  const pullRequest = { number: 25, mergeCommitOid: merge, body: '' };
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
  console.log('Release Please merge provenance, Markdown, release body and successive changelog updates passed.');
}

test().catch(error => { console.error(error); process.exitCode = 1; });
