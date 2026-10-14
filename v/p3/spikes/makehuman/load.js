// Reads a packed data file in the browser (fetch) and in node (fs), so no script has to shim fetch for file: URLs.
// gz(url): a .gz file, inflated, as an ArrayBuffer. json(url): a parsed JSON file.
const node = typeof process !== "undefined" && !!process.versions?.node;

async function raw(url) {
  if (!node) return (await fetch(url)).body;
  const { readFile } = await import("node:fs/promises");
  return new Blob([await readFile(url)]).stream();
}
export const gz = async (url) => new Response((await raw(url)).pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
export const json = async (url) => new Response(await raw(url)).json();
