"""Tiny Chrome DevTools driver for RayMan: used to test by mouse and to take the guide's screenshots."""
import json, subprocess, time, urllib.request, websocket, base64, os, sys
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ROOT = "/Users/rob/UCL Dropbox/Microscopy/Teaching/SWC_Optics_Course/software_tools/RayMan"
URL = "file://" + ROOT.replace(" ", "%20") + "/index.html"

class Page:
    def __init__(self, w=1300, h=750, port=9333, scale=1):
        self.prof = "/private/tmp/claude-501/rmprof%d" % port
        self.p = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--remote-debugging-port=%d" % port,
            "--user-data-dir=" + self.prof, "--window-size=%d,%d" % (w, h), "--allow-file-access-from-files", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                tabs = json.load(urllib.request.urlopen("http://127.0.0.1:%d/json" % port)); break
            except Exception: time.sleep(0.2)
        tab = [t for t in tabs if t["type"] == "page"][0]
        self.ws = websocket.create_connection(tab["webSocketDebuggerUrl"], suppress_origin=True)
        self.i = 0; self.errors = []
        self.cmd("Runtime.enable"); self.cmd("Page.enable")
        self.cmd("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=scale, mobile=False)
    def cmd(self, method, **params):
        self.i += 1; self.ws.send(json.dumps({"id": self.i, "method": method, "params": params}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("method") == "Runtime.exceptionThrown": self.errors.append(m["params"]["exceptionDetails"])
            if m.get("method") == "Runtime.consoleAPICalled" and m["params"]["type"] == "error": self.errors.append(m["params"]["args"])
            if m.get("id") == self.i:
                if "error" in m: raise RuntimeError(m["error"])
                return m.get("result")
    def open(self, url=URL, clear=True):
        self.cmd("Page.navigate", url=url); time.sleep(0.8)
        if clear:
            self.js("localStorage.clear(); sessionStorage.clear()"); self.cmd("Page.reload"); time.sleep(0.8)
        self.splash = self.js("!document.getElementById('about').hidden")
        self.js("document.getElementById('about').hidden = true")
    def js(self, expr):
        r = self.cmd("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        if "exceptionDetails" in r: raise RuntimeError(r["exceptionDetails"])
        return r["result"].get("value")
    def mouse(self, typ, x, y, buttons=0, clicks=1, mods=0):
        self.cmd("Input.dispatchMouseEvent", type=typ, x=x, y=y, button="left" if typ != "mouseMoved" else "none",
                 buttons=buttons, clickCount=clicks, modifiers=mods)
    def click(self, x, y, mods=0, dbl=False):
        self.mouse("mouseMoved", x, y, mods=mods); time.sleep(0.05)
        self.mouse("mousePressed", x, y, 1, 1, mods); self.mouse("mouseReleased", x, y, 0, 1, mods)
        if dbl:
            self.mouse("mousePressed", x, y, 1, 2, mods); self.mouse("mouseReleased", x, y, 0, 2, mods)
        time.sleep(0.1)
    def move(self, x, y, mods=0): self.mouse("mouseMoved", x, y, mods=mods); time.sleep(0.08)
    def drag(self, x0, y0, x1, y1, steps=8, mods=0):
        self.mouse("mouseMoved", x0, y0); self.mouse("mousePressed", x0, y0, 1, 1, mods)
        for k in range(1, steps + 1):
            self.mouse("mouseMoved", x0 + (x1 - x0) * k / steps, y0 + (y1 - y0) * k / steps, 1, mods=mods); time.sleep(0.03)
        self.mouse("mouseReleased", x1, y1, 0, 1, mods); time.sleep(0.1)
    def key(self, k, mods=0):
        code = {"Escape": "Escape", "Delete": "Delete", "Backspace": "Backspace"}.get(k, "Key" + k.upper() if len(k) == 1 else k)
        self.cmd("Input.dispatchKeyEvent", type="keyDown", key=k, code=code, modifiers=mods,
                 text=k if len(k) == 1 else "", windowsVirtualKeyCode=ord(k.upper()) if len(k) == 1 else 0)
        self.cmd("Input.dispatchKeyEvent", type="keyUp", key=k, code=code, modifiers=mods); time.sleep(0.1)
    def shot(self, path, clip=None):
        time.sleep(0.15)
        args = {"format": "png"}
        if clip: args["clip"] = dict(clip, scale=1)
        d = self.cmd("Page.captureScreenshot", **args)["data"]
        open(path, "wb").write(base64.b64decode(d))
    def close(self):
        try: self.ws.close()
        except Exception: pass
        self.p.kill()
