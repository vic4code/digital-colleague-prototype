import { readFileSync, writeFileSync } from "node:fs";

const [templatePath, outputPath, label, runner, installRoot, id, appCurrent, stdout, stderr] =
  process.argv.slice(2);

if (!stderr) {
  throw new Error("render-plist.mjs received incomplete arguments");
}

const escapeXml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const values = {
  __LABEL__: label,
  __RUNNER__: runner,
  __INSTALL_ROOT__: installRoot,
  __ID__: id,
  __APP_CURRENT__: appCurrent,
  __STDOUT__: stdout,
  __STDERR__: stderr,
};

let plist = readFileSync(templatePath, "utf8");
for (const [placeholder, value] of Object.entries(values)) {
  plist = plist.replaceAll(placeholder, escapeXml(value));
}
writeFileSync(outputPath, plist, { encoding: "utf8", mode: 0o644 });
