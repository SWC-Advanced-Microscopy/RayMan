# RayMan: notes for Claude

RayMan is a static, no-build, vanilla-JS canvas app for tracing rays by hand in optics lectures.
The code is written by Claude, directed by the course lecturer. See `README.md` and `Claude/goal.md`.

## Keep these up to date with every change

- **The guide** (`guide/index.html`) shows the key features with screenshots: helper rays,
  light from infinity, irises and fill-in rays. When a feature it describes
  changes, or a key feature is added, update the text **and** the pictures in the same piece of
  work. Keep it **generic and short** (the lecturer's wish): what a feature does and how to use
  it, in a sentence or two; let the pictures explain. No long walkthroughs of one system. The
  short help in `index.html` (the `?` panel) lists tools and keys and links to the guide.
- **Features under development** (the scan mirror, the dichroic, the Objects panel) are hidden unless Settings →
  "Show features under development" is on (class `dev` in the markup, `DEV_TOOLS` in app.js).
  Keep them out of the guide until the lecturer says they are wanted.
- **The screenshots** are generated, not hand-made. The scenes are in
  `Claude/guide-shots/scenes.js`, the list of pictures in `Claude/guide-shots/shots.py`. Run
  `python3 Claude/guide-shots/shots.py` (all) or `... shots.py confocal relay` (some, by file
  name) to rebuild `guide/img/`. Look at the pictures afterwards: labels can collide.
- **`README.md`** (the GitHub front page): keep it short, and do not pollute it. It is about right
  as it is. Add a new feature only if it matters to someone reading the page, in a sentence or
  two; no extra sections, long lists or detail that nobody will read (the guide holds that).
- **`Claude/LOG.md`**: a dated record of what was done, the choices made and why.
- **Tests**: `node --test tests/`. Add tests for new behaviour.
- **Offline**: `sw.js` keeps the files in its `CORE` list for offline use. A new file loaded by
  `index.html` must be added there (`tests/sw.test.js` fails otherwise).

## Working style

- The lecturer curates features: propose, then build what is chosen, test it (unit tests and
  by mouse in headless Chrome, see `Claude/guide-shots/cdp.py`), fix what turns up.
- Do not add shortcuts that speed up drawing rays: the slow, by-hand workflow is the point.
- Testing: open `index.html` from the repository, or serve the repo root locally. Every push to
  main deploys RayMan to GitHub Pages (`.github/workflows/pages.yml`), which stamps the asset
  links (`tools/stamp-assets.py`) so browsers, Safari on iPad above all, keep no old scripts.
  Never stamp the repository's own files.
- Commit at sensible points; commit messages end with the attribution lines given in the session.

## GitHub issues

- **Fixing one:** read it (`gh issue view N`, and look at the images), reproduce it with a failing
  test first, fix the cause, check by mouse in headless Chrome as well as `node --test tests/`,
  update `Claude/LOG.md`, then commit (mention `#N`) and push. Finally
  comment on the issue with `gh issue comment N`: a short, plain account of the cause and the fix,
  and the commit it is in (its hash, which GitHub links). If you have verified for sure that it
  is fixed (the failing test now passes and the reported behaviour is gone by mouse), close the
  issue (`gh issue close N`). If you have any doubt, leave it open and say in the comment what is
  uncertain, `@`-mentioning the lecturer (`raacampbell`).
- **Not able to fix it** (the cause or the right fix is uncertain, it cannot be reproduced, or
  information is missing): do not guess in code. Comment on the issue instead, `@`-mentioning the
  person who opened it (`gh issue view N --json author`), and ask for exactly what is missing.
  Be succinct. Attach what helps: a screenshot of what you see, or a `.json` scene file (Save in
  RayMan) to load; say what you tried.
- **Feature requests** (when the lecturer asks you to handle one): read it (`gh issue view N`,
  images too). Come back to the lecturer with any questions and caveats, and suggest related
  features if they would make it better (if none, just consider the feature as proposed). Build
  only once agreed. If we agreed to add things beyond the request, or it can only be partly
  done, first post an interim comment on the issue saying what was decided (extras, or what will
  and will not be done). Then build it, test it (unit tests and by mouse in headless Chrome),
  update the guide/README/LOG as above, commit (mention `#N`) and push.
  Finally comment on the issue saying it is done (or what was done, if partial) with the commit
  hash, and close the issue.

- **Checkboxes:** an issue's bullet points with `- [ ]` are a checklist. Before closing it, or
  when you finish part of it, tick the boxes for what is done (`- [x]`): take the body with
  `gh issue view N --json body -q .body`, change only those boxes, and write it back with
  `gh issue edit N --body-file -`. Leave unfinished or uncertain points unticked, and say so in the
  closing comment.
