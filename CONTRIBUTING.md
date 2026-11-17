# Contributing

Thank you. Three things to know before sending a change.

## 1. The checks

```bash
npm test          # must pass
npm run smoke     # after any change under app/
```

`CLAUDE.md` lists the rules the code is held to (a show changes only through edit operations; `core/` never requires Electron; the renderer is a view; colour carries meaning). `docs/specs/` says how each part is meant to work; if your change alters that, change the spec in the same pull request.

## 2. The contributor agreement

Endless Cues is licensed under the AGPL-3.0-or-later. So that the project can also offer it under other terms (for example a commercial licence to someone who cannot use AGPL software, which is one of the ways the project pays for itself), contributors keep their copyright and grant the project a broad licence to their contribution.

By submitting a contribution you agree that:

1. It is your own work, or you have the right to submit it, and you are not knowingly including anyone else's code or material without saying so.
2. You grant Jeshua Bratman (the project's owner) a perpetual, worldwide, non-exclusive, royalty-free, irrevocable licence to use, reproduce, modify, distribute and sublicense your contribution, including under licences other than the AGPL.
3. You grant the same patent licence the Apache License 2.0 grants, for any patent of yours that your contribution necessarily infringes.
4. Your contribution is provided as-is, with no warranty.

Say so in your first pull request with the line:

> I have read CONTRIBUTING.md and agree to the contributor agreement.

(This is a plain-language agreement written for a small project. If the project grows, it will be replaced with a reviewed one, and you will be asked again.)

## 3. What is welcome

Bug reports with a show file that reproduces the problem are the most useful thing you can send. For features, look at `docs/specs/09-qlab-parity.md` and `docs/specs/12-roadmap.md` first, and open an issue before building anything large.
