// Just enough of gpui-kit to build a view's element tree and read it back: every style method is accepted and
// ignored, and the ones that carry meaning (children, id, handlers, when) are recorded.
class Node {
  constructor(tag) { this.tag = tag; this.kids = []; this.hd = {}; this.eid = null; }
  child(c) { this.kids.push(c); }
  children(list) { for (const c of list) this.kids.push(c); }
  when(cond, fn) { if (cond) fn(this.proxy); }
  id(x) { this.eid = x; }
  on_click(h) { this.hd.click = h; }
  on_mouse_down(button, h) { this.hd[`down:${button}`] = h; }
  on_key_down(h) { this.hd.key = h; }
}
const OWN = new Set(["child", "children", "when", "id", "on_click", "on_mouse_down", "on_key_down"]);
export function make(tag) {
  const node = new Node(tag);
  node.proxy = new Proxy(node, {
    get(o, k) {
      if (OWN.has(k)) return (...a) => { const r = o[k](...a); return r === undefined ? node.proxy : r; };
      if (k in o) return o[k];
      if (typeof k === "symbol") return undefined;
      return () => node.proxy;
    },
  });
  return node.proxy;
}
export class View {}
export const div = () => make("div");
export const svg = path => { const e = make("svg"); e.node_path = path; return e; };
