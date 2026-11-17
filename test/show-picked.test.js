/**
 * File ▸ Open takes a show however it was chosen: the .ecshow package (a Mac shows a show as one file), the folder
 * (elsewhere, or a show made with Start from a Folder), or the show.json inside it. And the app declares a show as a
 * package of its own on a Mac, so Finder shows it as one file with its icon and opens it with the app.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { showFolderFrom, NOT_A_SHOW } = require('../core/show/picked');

test('what Open was handed: a show folder or package, the show.json in one, or not a show (said in words)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-picked-'));
  try {
    const pkg = path.join(root, 'Hamlet.ecshow'); fs.mkdirSync(path.join(pkg, 'media'), { recursive: true }); fs.writeFileSync(path.join(pkg, 'show.json'), '{}');
    const plain = path.join(root, 'Sounds for Act 2'); fs.mkdirSync(plain); fs.writeFileSync(path.join(plain, 'show.json'), '{}');
    const empty = path.join(root, 'Nothing'); fs.mkdirSync(empty);
    fs.writeFileSync(path.join(root, 'rain.wav'), '');
    assert.deepEqual(showFolderFrom(pkg), { dir: pkg });
    assert.deepEqual(showFolderFrom(plain), { dir: plain }, 'a show folder not named .ecshow');
    assert.deepEqual(showFolderFrom(path.join(pkg, 'show.json')), { dir: pkg });
    assert.deepEqual(showFolderFrom(empty), { error: NOT_A_SHOW });
    assert.match(showFolderFrom(path.join(pkg, 'media')).error, /no show\.json/);
    assert.match(showFolderFrom(path.join(root, 'rain.wav')).error, /^That is not a show/);
    assert.match(showFolderFrom(path.join(root, 'gone.ecshow')).error, /^There is nothing at/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a show is a package document the app owns: an exported type that is a com.apple.package, with the icon, and the document type says so', () => {
  const build = require('../package.json').build;
  const doc = build.fileAssociations.find((f) => [].concat(f.ext).includes('ecshow'));
  assert.equal(doc.isPackage, true, 'LSTypeIsPackage on the document type');
  assert.equal(doc.role, 'Editor');
  assert.equal(doc.icon, 'document.icns');
  const uti = build.mac.extendInfo.UTExportedTypeDeclarations.find((t) => t.UTTypeIdentifier === 'com.endlesscues.show');
  assert.ok(uti.UTTypeConformsTo.includes('com.apple.package'));
  assert.deepEqual(uti.UTTypeTagSpecification['public.filename-extension'], ['ecshow']);
  assert.equal(uti.UTTypeIconFile, doc.icon, 'the same icon, which the document type copies into the app');
  assert.ok(fs.existsSync(path.join(__dirname, '..', build.directories.buildResources, doc.icon)));
  // a QLab workspace is QLab's own type: not declared here, opened only as an alternate
  const qlab = build.fileAssociations.find((f) => [].concat(f.ext).includes('qlab5'));
  assert.equal(qlab.rank, 'Alternate');
  assert.ok(!qlab.isPackage);
});
