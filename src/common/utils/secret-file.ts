import { writeFileSync, chmodSync } from 'fs';

/**
 * Write a secret file (e.g. the generated `.env`, the raw admin key) with owner-only permissions.
 *
 * `writeFileSync`'s `mode` is honored only when the file is CREATED — on an overwrite it keeps the
 * existing permissions. So we chmod to 0o600 BEFORE writing too: if the file already exists with
 * looser perms, the new secret content is never briefly world-readable during the rewrite. The
 * post-write chmod is a backstop. Both chmods are best-effort (a mount that can't chmod, or an
 * absent file on the pre-write call, shouldn't break the write — create-mode covers new files).
 */
export function writeSecretFile(filePath: string, content: string): void {
  try {
    chmodSync(filePath, 0o600);
  } catch (error) {
    // A missing file is the expected first-write path; create-mode below protects it. Warn only
    // when an existing path could not be tightened, so a chmod-unsupported filesystem or another
    // unexpected failure is still visible without making every clean installation look broken.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[OpenWA] pre-write chmod 0o600 failed for ${filePath}: ${(error as Error).message}`);
    }
  }
  writeFileSync(filePath, content, { mode: 0o600 });
  try {
    chmodSync(filePath, 0o600);
  } catch (error) {
    console.warn(`[OpenWA] post-write chmod 0o600 failed for ${filePath}: ${(error as Error).message}`);
  }
}
