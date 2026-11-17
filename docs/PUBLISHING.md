# Making the repository public

A checklist for the day `jeshua/endless_cues` goes from private to public. Everything else (the licence, NOTICE,
SECURITY.md, the issue forms, the firmware templates, the internal notes under `docs/internal/`) is already done.

1. **Confirm with Monica Lerch that the show's artwork may be public.** This is the one blocking item. NOTICE says
   the textures, the buck-mask figure and the icons drawn from it, and the QIRX-G drawing are © Endless Forms
   Puppetry, all rights reserved, included with permission for this app and its website. That permission has to be
   hers too, and so does her name in NOTICE, `CONTRIBUTING.md` and `docs/brand.md`. If any of the art must not be
   public, removing it from the tree is not enough: it stays in the history (`git filter-repo` on a fresh clone, or a
   squashed snapshot, is then the way).
2. **Run a secret scanner over the whole history**, from a fresh clone: `gitleaks detect --log-opts=--all` and
   `trufflehog git file://. --only-verified=false`. Both found nothing on 2026-11-17. Anything found is fixed
   before step 4.
3. **Check the tree for what should not be there:** `git ls-files | grep -iE 'secrets\.h$|\.env$|\.p8$|\.pem$'`
   prints nothing (the firmware templates are `secrets.example.h`); `reference/` is not tracked.
4. **Set the repository public** (GitHub ▸ Settings ▸ General ▸ Danger Zone ▸ Change visibility).
5. **Turn on secret scanning and push protection** (Settings ▸ Code security), and protect `main` (require CI to
   pass; no force pushes).
6. **Put the GitHub link back on the website.** In the service repository (`endless_cues_service`), the links were
   taken off while the code is private. `site/site.js` `REPO_URL` already holds `https://github.com/jeshua/endless_cues`
   (check it is still the URL). Add `<a data-link="repo" href="…">GitHub</a>` back to the header nav and the footer
   of `site/index.html` and `site/docs/index.html`, then deploy the site.
7. **Post the first release** on GitHub (the steps are in [`RELEASING.md`](RELEASING.md)), with the changelog's
   entry as its notes.
