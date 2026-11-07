// Kopia, eksport CSV, wczytanie kopii. Wspólne dla Ustawień, banera na ekranie głównym i powitania.
import { exportBackup, exportCsv, shareFile, importBackup, setSetting } from '../db.js';
import { showToast } from './toast.js';

export async function backupNow(ctx) {
  const f = await exportBackup();
  const r = await shareFile(f.filename, 'application/json', f.text);
  if (r === 'shared' || r === 'downloaded') {
    await setSetting('lastBackupAt', new Date().toISOString());
    await ctx.reload();
    showToast(r === 'shared' ? 'Kopia zapisana' : 'Kopia pobrana jako plik');
  }
}

export async function csvNow(ctx) {
  const f = await exportCsv();
  const r = await shareFile(f.filename, 'text/csv', f.text);
  if (r === 'shared') showToast('Eksport CSV zapisany');
  else if (r === 'downloaded') showToast('CSV pobrany jako plik');
}

// Zwraca true, gdy import się udał. Wynik (albo błąd) trafia do ui.importMsg.
export async function importText(ctx, text) {
  const raw = String(text || '').trim();
  if (!raw) {
    ctx.ui.importMsg = { ok: false, text: 'Brak treści kopii do wczytania.' };
    ctx.render();
    return false;
  }
  try {
    const r = await importBackup(raw);
    await setSetting('onboarded', true);
    ctx.ui.importMsg = {
      ok: true,
      text: 'Wczytano: dodano ' + r.added + ', zaktualizowano ' + r.updated + ', bez zmian ' + r.unchanged + '.',
    };
    ctx.ui.pasteText = '';
    ctx.ui.welcomeText = '';
    await ctx.reload();
    return true;
  } catch (err) {
    ctx.ui.importMsg = { ok: false, text: (err && err.message) ? err.message : 'Nie udało się wczytać kopii.' };
    ctx.render();
    return false;
  }
}

export async function importFile(ctx, file) {
  if (!file) return false;
  let text;
  try { text = await file.text(); } catch (err) {
    ctx.ui.importMsg = { ok: false, text: 'Nie udało się odczytać pliku.' };
    ctx.render();
    return false;
  }
  return importText(ctx, text);
}
