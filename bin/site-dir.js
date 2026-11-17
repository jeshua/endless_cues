/**
 * Where the website's files are. The site (endlesscues.com: the landing page and the manual) is not in this
 * repository: it lives in the service repository's `site/` folder, a private repo checked out beside this one
 * (docs/specs/17-service-protocol.md says how the two meet). The few things here that write into it
 * (bin/release.js site, build/mark.js) and read it (the virtual users' brief) find it through this.
 *
 *   --site-dir <dir>      on the command line, first
 *   EC_SITE_DIR=<dir>     in the environment, next
 *   ../endless_cues_service/site, beside this repository, otherwise
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT = path.join(ROOT, '..', 'endless_cues_service', 'site');

/** The site folder named by the flags, the environment or the default (not checked). */
function siteDir(flags = []) {
  const i = flags.indexOf('--site-dir');
  if (i >= 0 && flags[i + 1]) return path.resolve(flags[i + 1]);
  if (process.env.EC_SITE_DIR) return path.resolve(process.env.EC_SITE_DIR);
  return DEFAULT;
}

/** The same, or null when there is no site there (a folder with an index.html). */
function findSite(flags = []) {
  const dir = siteDir(flags);
  return fs.existsSync(path.join(dir, 'index.html')) ? dir : null;
}

module.exports = { siteDir, findSite, DEFAULT };
