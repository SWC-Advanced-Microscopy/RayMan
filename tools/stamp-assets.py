#!/usr/bin/env python3
"""Stamp asset links in a deployed copy of RayMan so browsers never run stale code.

Usage:  python3 tools/stamp-assets.py <deployed folder>

In every .html file under the folder, each src="..." / href="..." that points at a local file
(a script, stylesheet or image) gets ?v=<first 10 hex digits of the file's SHA-1>. A changed
file gets a new URL, so no browser (Safari on iPad above all) can keep using an old copy;
unchanged files keep their URL and stay cached. Run it on the copy, never on the repository:
the repository's own files stay unstamped, so RayMan still opens straight from disk.
Running it twice is harmless: existing ?v= stamps are replaced.

embed.js (at the top of the folder) loads RayMan's scripts itself, from a list of names in
quotes ('js/geom.js', ...): those are stamped too, before the pages, so a page's link to
embed.js changes whenever any of them does. workbook.js loads 'embed.js' in the same way, so
it is stamped next, after embed.js.
"""
import hashlib, os, re, sys

# src= and href= only, not data-src= and the like (a word boundary alone lets "-src" match):
# an embed's data-src is written by page authors, who never stamp it.
LINK = re.compile(r'''(?<![\w-])(src|href)="([^"#?:]+)(\?v=[0-9a-f]+)?"''')

def stamp_file(html_path):
    base = os.path.dirname(html_path)
    text = open(html_path, encoding="utf-8").read()
    n = 0
    def fix(m):
        nonlocal n
        attr, url = m.group(1), m.group(2)
        target = os.path.normpath(os.path.join(base, url))
        if url.endswith(".html") or url.endswith("/") or not os.path.isfile(target):
            return m.group(0)                      # pages and folders: not assets
        digest = hashlib.sha1(open(target, "rb").read()).hexdigest()[:10]
        n += 1
        return '%s="%s?v=%s"' % (attr, url, digest)
    out = LINK.sub(fix, text)
    if out != text:
        open(html_path, "w", encoding="utf-8").write(out)
    return n

EMBED_FILE = re.compile(r"""'(js/[\w.-]+\.js)(\?v=[0-9a-f]+)?'""")

WORKBOOK_FILE = re.compile(r"""'(embed\.js)(\?v=[0-9a-f]+)?'""")

def stamp_embed(js_path, pattern=EMBED_FILE):
    """Stamp the quoted names (pattern) in a script that loads others: 'js/....js' in embed.js,
    'embed.js' in workbook.js. Returns how many."""
    base = os.path.dirname(js_path)
    text = open(js_path, encoding="utf-8").read()
    n = 0
    def fix(m):
        nonlocal n
        target = os.path.join(base, m.group(1))
        if not os.path.isfile(target):
            return m.group(0)
        n += 1
        return "'%s?v=%s'" % (m.group(1), hashlib.sha1(open(target, "rb").read()).hexdigest()[:10])
    out = pattern.sub(fix, text)
    if out != text:
        open(js_path, "w", encoding="utf-8").write(out)
    return n

def main():
    if len(sys.argv) != 2 or not os.path.isdir(sys.argv[1]):
        sys.exit(__doc__)
    total = 0
    embed = os.path.join(sys.argv[1], "embed.js")
    if os.path.isfile(embed):
        total += stamp_embed(embed)
    workbook = os.path.join(sys.argv[1], "workbook.js")
    if os.path.isfile(workbook):
        total += stamp_embed(workbook, WORKBOOK_FILE)
    for root, dirs, files in os.walk(sys.argv[1]):
        for f in files:
            if f.endswith(".html"):
                total += stamp_file(os.path.join(root, f))
    print("stamped %d asset links" % total)

if __name__ == "__main__":
    main()
