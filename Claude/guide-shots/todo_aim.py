"""Pictures for TODO.md, idea 1 ("aim a ray through a point after the lens"), made with RayMan:
the Köhler collector (lamp at its F, field diaphragm at F′). Picture 3 is a mock-up: the
proposed snap does not exist, so its preview is set by hand. Run: python3 Claude/guide-shots/todo_aim.py"""
import os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from cdp import Page, ROOT

OUT = os.path.join(ROOT, "Claude", "todo-img")
HIDE_UI = "#tools,#rail,#hint,#toast,#props,#brand,#coords{display:none!important}"
W, H = 860, 340
RED, GREY = "#d9422b", "#9aa3b2"

BUILD = """
(function (r) {
  var S = RM.scene, R = RM.rays, app = RM.app, real = app.st.real, ax = S.axes(real)[0].id;
  var lamp = S.addFilament(real, 0); lamp.top = 7; lamp.bottom = -7; lamp.label = 'lamp'; lamp.axis = ax;
  var L = S.addLens(real, 50, 50, 34, ax); L.label = 'collector';
  var I = S.addIris(real, 100, ax); I.r = r; I.label = 'field';
  window.T = { L: L, I: I, lamp: lamp, ray: function (h, col, zEnd) {
    var x = S.addRay(real, { at: { el: lamp.id, pt: 'top' } }); x.axis = ax; x.color = col;
    x.nodes.push({ dir: { kind: 'free' }, end: { kind: 'lens', el: L.id, y: h } },
                 { dir: { kind: 'refract', el: L.id }, end: { kind: 'z', z: zEnd || 150 } });
    return x;
  } };
})(%s)
"""

def shot(p, name, r, js):
    p.open()
    p.js(BUILD % r)
    p.js("RM.app.view.fit({z0: -10, z1: 155, y0: -26, y1: 38}, %d, %d, 20); RM.app.redraw()" % (W, H))
    p.js(js)
    p.js("(()=>{const s=document.createElement('style');s.textContent=%r;document.head.appendChild(s);})()" % HIDE_UI)
    p.js("RM.app.redraw()")
    time.sleep(0.3)
    p.shot(os.path.join(OUT, name + ".png"))
    print("wrote", name, p.errors or "")

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    p = Page(W, H, port=9334, scale=2)
    try:
        # 1. the ray wanted: from the top of the lamp, through the top edge of the field diaphragm
        shot(p, "aim-1-goal", 19, "T.ray(26, '%s'); RM.app.st.hints = [{z: 100, y: 19, text: ''}]" % RED)
        # 2. today: where must it hit the collector? Guesses miss the edge (or hit the blade)
        shot(p, "aim-2-today", 19, "T.ray(21, '%s'); T.ray(31, '%s'); RM.app.st.hints = [{z: 100, y: 19, text: ''}]" % (GREY, GREY))
        # 3. mock-up of the proposal: drawing from the lamp top, cursor past the collector, on the edge
        shot(p, "aim-3-proposal", 19, """(()=>{ var st = RM.app.st, v = RM.app.view;
            RM.app.redraw();
            st.draft = { from: { z: 0, y: 7 }, pts: [{ z: 50, y: 26 }, { z: 100, y: 19 }], color: '%s' };
            st.hints = [{ z: 100, y: 19, text: '' }, { z: 50, y: 26, text: '', small: true }];
            st.caption = { x: v.X(100) + 6, y: v.Y(19) - 2, text: 'to collector, aimed through the top edge of field' };
          })()""" % RED)
        # 4. after the click: close the field diaphragm and the ray follows its edge
        shot(p, "aim-4-follows", 12, "T.ray(19, '%s'); RM.app.st.hints = [{z: 100, y: 12, text: ''}]" % RED)
    finally:
        p.close()
