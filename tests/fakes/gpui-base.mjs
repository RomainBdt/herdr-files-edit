import { make } from "./gpui-kit.mjs";
export const v_flex = () => make("v_flex");
export const h_flex = () => make("h_flex");
export const Editor = { new: state => { const e = make("editor"); e.state = state; return e; } };
export const EditorState = {
  new: options => {
    const handlers = {};
    const state = {
      options, released: false, text: options.value ?? "",
      value() { return this.text; },
      set_value(v) { this.text = v; },
      on(event, h) { handlers[event] = h; return true; },
      release() { this.released = true; return true; },
      // test helper: what typing does
      type(text, cx) { if (options.readonly) return; this.text = text; handlers.change?.({}, cx); },
    };
    (globalThis.__fake.states ??= []).push(state);
    return state;
  },
};
