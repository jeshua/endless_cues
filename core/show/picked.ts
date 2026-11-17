/**
 * What File ▸ Open was handed, as the show to open.
 *
 * On a Mac a show (a folder ending in .ecshow) is a package: Finder shows it as one file with the show's icon, and
 * the open dialog lets a person choose it as a file. Elsewhere, and for a show folder not named .ecshow (one made
 * with Start from a Folder), it is a folder. So the dialog takes both, and this decides what was meant: the show
 * folder itself, the show.json inside one, or something that is not a show (said in words).
 */
import * as fs from 'fs';
import * as path from 'path';

const NOT_A_SHOW = 'That folder is not a show (it has no show.json). To make a show in a folder of sounds, choose File ▸ Start from a Folder….';

function showFolderFrom(picked: string): { dir: string } | { error: string } {
  let st;
  try { st = fs.statSync(picked); } catch { return { error: `There is nothing at ${picked}.` }; }
  if (st.isDirectory()) return fs.existsSync(path.join(picked, 'show.json')) ? { dir: picked } : { error: NOT_A_SHOW };
  if (path.basename(picked).toLowerCase() === 'show.json') return { dir: path.dirname(picked) };
  return { error: 'That is not a show. A show is a folder ending in .ecshow (or the show.json inside one). To bring in a QLab workspace, choose File ▸ Import a QLab Workspace….' };
}

export { showFolderFrom, NOT_A_SHOW };
