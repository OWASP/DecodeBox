const { GitHub, Manifest, registerChangelogNotes } = require('release-please');
const { DefaultChangelogNotes } = require('release-please/build/src/changelog-notes/default');
const conventionalPreset = require('conventional-changelog-conventionalcommits');

// GitHub associates both the merge and its source commits with the same PR.
// Prefer the source link for a repeated note. Other PRs, scopes, breaking
// changes and issue references keep their own entries.
function uniqueNotes(commits) {
  const notes = new Map();
  for (const commit of commits) {
    const pr = commit.pullRequest;
    const key = JSON.stringify([pr?.number ?? commit.sha, commit.message, commit.notes, commit.references]);
    const previous = notes.get(key);
    if (!previous || (pr && previous.sha === pr.mergeCommitOid && commit.sha !== previous.sha)) {
      notes.set(key, commit);
    }
  }
  return [...notes.values()];
}

// Use the upstream renderer for scopes, issues, escaping and breaking notes.
// Change its template punctuation, never the contributor's Markdown.
async function buildNotes(commits, options) {
  const { writerOpts } = await conventionalPreset();
  const renderer = new DefaultChangelogNotes({
    mainTemplate: writerOpts.mainTemplate
      .replace('{{> header}}\n\n', '{{> header}}\n')
      .replace('{{/each}}\n\n{{/each}}', '{{/each}}\n{{/each}}')
      .replace(/^\* /gm, '- '),
    commitPartial: writerOpts.commitPartial.replace(/^\*/, '-')
      .replace('[{{shortHash}}]', '[`{{shortHash}}`]'),
  });
  return renderer.buildNotes(uniqueNotes(commits), options);
}

async function updateReleasePR() {
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
  const github = await GitHub.create({ owner, repo, token: process.env.GH_TOKEN });
  registerChangelogNotes('default', () => ({ buildNotes }));
  const manifest = await Manifest.fromManifest(github, github.repository.defaultBranch,
    'release-please-config.json', '.release-please-manifest.json', { skipLabeling: true });
  await manifest.createPullRequests();
}

module.exports = { buildNotes };
if (require.main === module) updateReleasePR().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
