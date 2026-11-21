// Sends the three modules a mod imports to the fakes next to this file.
const fakes = { "gpui-kit": "gpui-kit.mjs", "gpui-base": "gpui-base.mjs", herdr: "herdr.mjs" };
export async function resolve(specifier, context, next) {
  if (fakes[specifier]) return { url: new URL(fakes[specifier], import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
