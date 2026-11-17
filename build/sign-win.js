/**
 * The Windows signer: electron-builder calls it for each file it signs (`win.signtoolOptions.sign`, set by
 * `node bin/release.js win` only when signing was asked for). It signs on any computer with jsign
 * (https://ebourg.github.io/jsign/, `brew install jsign`), so the Windows installers are still built on a Mac.
 *
 *   EC_WIN_SIGNING="<endpoint> <account> <profile>"   Azure Artifact Signing (docs/RELEASING.md, "Windows");
 *                                                     EC_WIN_SIGN_TOKEN is the access token release.js got from az
 *   EC_WIN_SIGN_P12=<file.p12>                        a certificate of your own, for trying the signing path
 *                                                     (EC_WIN_SIGN_P12_PASS its password); Windows trusts none
 *
 * Secrets go to jsign by the name of the variable that holds them (`env:…`), never on its command line.
 */
const { spawnSync } = require('child_process');

const TIMESTAMPS = 'http://timestamp.acs.microsoft.com';

/** jsign's arguments for one file, or null when nothing says how to sign. */
function jsignArgs(file, env = process.env) {
  const what = ['--name', 'Endless Cues', '--url', 'https://endlesscues.com', '--alg', 'SHA-256'];
  if (env.EC_WIN_SIGN_P12) return ['--keystore', env.EC_WIN_SIGN_P12, '--storepass', 'env:EC_WIN_SIGN_P12_PASS', ...what, file];
  if (!env.EC_WIN_SIGNING) return null;
  const [endpoint, account, profile] = env.EC_WIN_SIGNING.trim().split(/\s+/);
  if (!profile) throw new Error(`EC_WIN_SIGNING is "<endpoint> <account> <profile>" (e.g. "eus.codesigning.azure.net my-account my-profile"), not "${env.EC_WIN_SIGNING}"`);
  return ['--storetype', 'TRUSTEDSIGNING', '--keystore', endpoint, '--storepass', 'env:EC_WIN_SIGN_TOKEN', '--alias', `${account}/${profile}`,
    '--tsaurl', TIMESTAMPS, '--tsmode', 'RFC3161', ...what, file];
}

/**
 * How many bytes of Authenticode signature a Windows program carries (the PE header's certificate table), 0 when it
 * has none. What release.js checks every installer with, since nothing on a Mac can ask Windows.
 */
function signatureBytes(buf) {
  if (buf.length < 64 || buf.toString('latin1', 0, 2) !== 'MZ') return 0;
  const pe = buf.readUInt32LE(0x3c);
  if (pe + 24 > buf.length || buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') return 0;
  const opt = pe + 24, magic = buf.readUInt16LE(opt);
  const dirs = opt + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : NaN);
  if (!(dirs + 5 * 8 <= buf.length)) return 0;
  const at = buf.readUInt32LE(dirs + 4 * 8), size = buf.readUInt32LE(dirs + 4 * 8 + 4);
  return at && size && at + size <= buf.length ? size : 0;
}

async function sign(configuration) {
  const args = jsignArgs(configuration.path);
  if (!args) throw new Error('Asked to sign with nothing to sign with: set EC_WIN_SIGNING (or EC_WIN_SIGN_P12 to try)');
  const r = spawnSync(process.env.EC_JSIGN || 'jsign', args, { encoding: 'utf8' });
  if (r.error) throw new Error(`jsign could not be run (${r.error.code}): brew install jsign`);
  if (r.status !== 0) throw new Error(`jsign could not sign ${configuration.path}: ${(r.stderr || r.stdout).trim()}`);
}

module.exports = sign;
module.exports.default = sign;
Object.assign(module.exports, { jsignArgs, signatureBytes });
