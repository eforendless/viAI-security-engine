const { createHash } = require("node:crypto");
const { readFileSync, statSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

function generateUpdateManifest() {
  const packagePath = join(__dirname, "..", "package.json");
  const { version } = JSON.parse(readFileSync(packagePath, "utf8"));
  const releaseDirectory = join(__dirname, "..", "release");
  const installerName = `viAI.Security.Setup.${version}.exe`;
  const installerPath = join(releaseDirectory, installerName);
  const installer = readFileSync(installerPath);
  const installerStats = statSync(installerPath);
  const sha512 = createHash("sha512").update(installer).digest("base64");
  const releaseDate = installerStats.mtime.toISOString();
  const manifest = [
    `version: ${version}`,
    "files:",
    `  - url: ${installerName}`,
    `    sha512: ${sha512}`,
    `    size: ${installerStats.size}`,
    `path: ${installerName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    ""
  ].join("\n");

  const manifestPath = join(releaseDirectory, "latest.yml");
  writeFileSync(manifestPath, manifest);
  console.log(`Generated latest.yml for ${installerName}`);
  return manifestPath;
}

module.exports = async () => {
  return [generateUpdateManifest()];
};

if (require.main === module) generateUpdateManifest();