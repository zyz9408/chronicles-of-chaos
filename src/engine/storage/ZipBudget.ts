/** fflate calls this before allocating each entry's output buffer. */
export function createZipBudgetFilter(maxBytes: number, maxEntries: number, maxEntryBytes = maxBytes) {
  let bytes = 0;
  let entries = 0;
  const names = new Set<string>();
  return ({ name, originalSize }: { name: string; originalSize: number }): boolean => {
    entries++;
    bytes += originalSize;
    if (!Number.isSafeInteger(originalSize) || originalSize < 0 || originalSize > maxEntryBytes
      || bytes > maxBytes || entries > maxEntries) throw new Error('归档解压大小或文件数量超过安全上限。');
    if (names.has(name) || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
      throw new Error('归档包含重复或非法文件路径。');
    }
    names.add(name);
    return true;
  };
}
