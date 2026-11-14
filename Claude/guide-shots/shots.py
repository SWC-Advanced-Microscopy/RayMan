"""Take the screenshots for guide/index.html. Run from anywhere:  python3 Claude/guide-shots/shots.py
Needs Google Chrome and the Python `websocket-client` package. Each picture is a scene from
scenes.js, built in the real app, fitted, and saved to guide/img/ at 2x."""
import os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from cdp import Page, ROOT

OUT = os.path.join(ROOT, "guide", "img")
SCENES = open(os.path.join(os.path.dirname(__file__), "scenes.js")).read()
HIDE_UI = "#tools,#rail,#hint,#toast,#props,#brand,#coords{display:none!important}"
W, H = 860, 380

# name in scenes.js, file name, extra: ui (keep toolbars), after (JS to run after building), crop
SHOTS = [
    ("helper2", "helper-2"), ("helper4", "helper-4"),
    ("bundle", "bundle"),
    ("iris", "iris-open"), ("irisClosed", "iris-closed"),
    ("objects", "explorer", {"ui": True, "w": 1100, "h": 520, "after": "document.querySelector('[data-act=objects]').click()"}),
]

def take(p, name, fname, extra):
    h, w = extra.get("h", H), extra.get("w", W)
    p.cmd("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=2, mobile=False)
    p.open()
    p.js(SCENES)
    p.js("GUIDE.%s()" % name)
    p.key("f")
    if not extra.get("ui"):
        p.js("(()=>{const s=document.createElement('style');s.textContent=%r;document.head.appendChild(s);})()" % HIDE_UI)
    if extra.get("after"):
        p.js(extra["after"])
        p.move(w / 2, 20)
        if "st.sel" in extra["after"]:          # show the panel for the selection
            p.click(p.js("RM.app.view.X(RM.app.st.real.elements.find(e=>e.id===RM.app.st.sel).z)"),
                    p.js("RM.app.view.Y(-%f)" % 9))
    p.move(5, h - 5)
    time.sleep(0.4)
    path = os.path.join(OUT, fname + ".png")
    p.shot(path)
    print("wrote", os.path.relpath(path, ROOT), "errors:", p.errors or "none")
    p.errors.clear()

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[1:]
    p = Page(W, H, scale=2)
    try:
        for s in SHOTS:
            if only and s[1] not in only: continue
            take(p, s[0], s[1], s[2] if len(s) > 2 else {})
    finally:
        p.close()
