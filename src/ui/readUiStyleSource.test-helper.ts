type FileReader = {
  readFileSync: (path: URL, encoding: string) => string;
};

/**
 * Reads the UI stylesheet in the same order as the App.css import manifest.
 * Source-level UI contract tests use this instead of assuming all rules still
 * live in one physical file.
 */
export async function readUiStyleSource(): Promise<string> {
  const { readFileSync } = await import('node:' + 'fs') as FileReader;
  const manifestUrl = new URL('../App.css', import.meta.url);
  const manifest = readFileSync(manifestUrl, 'utf8');
  const imports = [...manifest.matchAll(/^@import\s+['"](.+?)['"];\s*$/gm)];

  if (imports.length === 0) {
    return manifest;
  }

  return imports
    .map((match) => readFileSync(new URL(match[1], manifestUrl), 'utf8'))
    .join('\n');
}
