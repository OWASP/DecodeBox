const { execFileSync } = require('node:child_process');

// GitHub supplies first-time status in generated Markdown, not in a structured field.
// Accept its contributor records only, then confirm the PR author and merge via the pulls API.
async function newContributors(repository, previousTag, tag, api, warn) {
  let lines;
  try {
    const { body } = await api('POST', 'releases/generate-notes', {
      tag_name: tag, previous_tag_name: previousTag,
    });
    lines = body.split(/\r?\n/);
  } catch {
    warn('GitHub contributor metadata is unavailable. Omitting credits.');
    return [];
  }
  const heading = lines.indexOf('## New Contributors');
  if (heading < 0) return [];
  if (heading !== lines.lastIndexOf('## New Contributors')) {
    warn('Ambiguous GitHub contributor section. Omitting credits.');
    return [];
  }

  const credits = [];
  const seen = new Set();
  for (const line of lines.slice(heading + 1)) {
    if (/^#{1,6} |^\*\*Full Changelog/.test(line)) break;
    if (!line.trim()) continue;
    const match = /^[-*] @([\w-]+(?:\[bot\])?) made their first contribution in (?:https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/|#)([1-9]\d*)\.?$/.exec(line);
    if (!match || (match[2] && match[2] !== repository)) {
      warn('Unrecognized GitHub contributor record. Skipping it.');
      continue;
    }
    const [, login, , number] = match;
    if (seen.has(login.toLowerCase())) continue;
    let pr;
    try {
      pr = await api('GET', `pulls/${number}`);
    } catch {
      warn(`Contributor metadata for PR #${number} is unavailable. Skipping it.`);
      continue;
    }
    if (!pr?.merged_at || pr.base?.ref !== 'main' || pr.base.repo?.full_name !== repository ||
        pr.user?.login?.toLowerCase() !== login.toLowerCase() || String(pr.number) !== number) {
      warn(`Could not confirm the contributor on PR #${number}. Skipping it.`);
      continue;
    }
    seen.add(login.toLowerCase());
    credits.push(`- @${pr.user.login} made their first contribution in [#${number}](https://github.com/${repository}/pull/${number}).`);
  }
  return credits;
}

async function publishReleaseNotes({ created, recoveryTag, tag, id, original, repository }, api, warn = console.warn) {
  if (created !== 'true' || recoveryTag || ['v0.1.0', 'v0.1.1'].includes(tag)) return;
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || !/^[1-9]\d*$/.test(id)) throw new Error('Invalid new release identity.');

  const notes = original.replace(/\r\n/g, '\n').trim();
  const [header, ...lines] = notes.split('\n');
  const changes = lines.join('\n').trim();
  const match = /^## \[(?<version>[\d.]+)\]\((?<comparison>\S+\/compare\/(?<previousTag>v\d+\.\d+\.\d+)\.\.\.v[\d.]+)\) \((?<date>\d{4}-\d{2}-\d{2})\)$/.exec(header);
  if (!match || 'v' + match.groups.version !== tag || !changes ||
      match.groups.comparison !== `https://github.com/${repository}/compare/${match.groups.previousTag}...${tag}` ||
      /^## (?:What's Changed|New Contributors|Standalone Edition)$/m.test(changes)) {
    throw new Error('Unrecognized Release Please notes. Leaving the published body intact.');
  }
  const { comparison, previousTag, date } = match.groups;
  const credits = await newContributors(repository, previousTag, tag, api, warn);
  const title = `OWASP DecodeBox ${tag}`;
  const body = [
    `# ${title}`,
    `Changes since [${previousTag}](${comparison}) · ${date}`,
    "## What's Changed",
    changes,
    ...(credits.length ? ['## New Contributors', credits.join('\n')] : []),
    '## Standalone Edition',
    `Download \`OWASP-DecodeBox-Standalone-${tag}.html\` from the release assets and open it in your browser.`,
    'Core encoding, decoding, and analysis work offline. Processing runs locally in your browser, ' +
      'with no installation or server required.',
    'Large inputs can pause the tab. Download a new copy for updates and security fixes.',
  ].join('\n\n');

  // Bind the write to the ID returned by createRelease. Protect edits made
  // between publication and the end of the standalone build.
  const endpoint = `releases/${id}`;
  const current = await api('GET', endpoint);
  if (current.tag_name !== tag || current.draft || current.body?.replace(/\r\n/g, '\n').trim() !== notes) {
    throw new Error('The published release differs from the creation response. Leaving it intact.');
  }
  const updated = await api('PATCH', endpoint, { name: title, body });
  if (updated.tag_name !== tag || updated.name !== title || updated.body !== body) {
    throw new Error('GitHub did not confirm the requested release title and body.');
  }
  return body;
}

module.exports = { publishReleaseNotes };
if (require.main === module) {
  const { RELEASE_CREATED: created, RECOVERY_TAG: recoveryTag, RELEASE_TAG: tag, RELEASE_ID: id,
    ORIGINAL_NOTES: original, GITHUB_REPOSITORY: repository } = process.env;
  const api = (method, path, payload) => JSON.parse(execFileSync('gh', [
    'api', '--method', method, `repos/${repository}/${path}`, ...(payload ? ['--input', '-'] : []),
  ], { input: JSON.stringify(payload), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }));
  publishReleaseNotes({ created, recoveryTag, tag, id, original, repository }, api)
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
