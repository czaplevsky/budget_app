// Kopia, eksport CSV, wczytanie kopii. Wspólne dla Ustawień, banera na ekranie głównym i powitania.
import { exportBackup, exportCsv, shareFile, importBackup, setSetting } from '../db.js';
import { showToast } from './toast.js';

// Appka z ekranu początkowego: <a download> nie daje pewności, że plik trafił do Plików.
function isStandalone() {
  try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; }
}

async function markBackup(ctx, msg) {
  await setSetting('lastBackupAt', new Date().toISOString());
  await ctx.reload();
  showToast(msg);
}

// Awaryjnie: treść kopii do skopiowania (np. do Notatek), gdy udostępnianie pliku nie zadziałało.
function showCopyFallback(ctx, text) {
  const old = document.getElementById('bkFallback');
  if (old) old.remove();
  const box = document.createElement('div');
  box.id = 'bkFallback';
  box.setAttribute('role', 'dialog');
  box.style.cssText = 'position:absolute;inset:0;z-index:95;background:var(--bg);display:flex;flex-direction:column;gap:12px;' +
    'padding:calc(var(--sat) + 16px) 16px calc(var(--sab) + 16px)';
  box.innerHTML =
    '<h2 style="margin:0;font-size:22px">Kopia do skopiowania</h2>' +
    '<p style="margin:0;color:var(--muted);font-size:15px">Zapis pliku się nie udał. Skopiuj treść kopii i wklej ją np. do Notatek albo do pliku w Plikach. Wczytasz ją w Ustawieniach przez „Wklej kopię”.</p>' +
    '<textarea readonly style="flex:1;min-height:120px;width:100%;background:var(--surface);color:var(--muted);border:1px solid var(--line);border-radius:12px;padding:10px;font:12px ui-monospace,monospace"></textarea>' +
    '<button type="button" data-bk="copy" style="min-height:52px;border:0;border-radius:14px;background:var(--accent);color:var(--on-accent, #06101f);font-size:17px;font-weight:700">Kopiuj kopię</button>' +
    '<button type="button" data-bk="close" style="min-height:48px;border:1px solid var(--line);border-radius:14px;background:transparent;color:var(--ink);font-size:16px">Zamknij</button>';
  const ta = box.querySelector('textarea');
  ta.value = text;
  box.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-bk]');
    if (!b) return;
    if (b.dataset.bk === 'close') { box.remove(); return; }
    try {
      await navigator.clipboard.writeText(text);
      box.remove();
      await markBackup(ctx, 'Kopia skopiowana. Wklej ją w bezpieczne miejsce.');
    } catch (e) {
      ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length);
      showToast('Zaznaczone. Skopiuj z menu.');
    }
  });
  (document.querySelector('.app') || document.body).appendChild(box);
}

export async function backupNow(ctx) {
  const f = await exportBackup();
  const r = await shareFile(f.filename, 'application/json', f.text);
  if (r === 'shared') {
    await markBackup(ctx, 'Kopia zapisana');
  } else if (r === 'downloaded') {
    // w appce z ekranu początkowego pobranie nie jest dowodem zapisu → dajemy treść do skopiowania
    if (isStandalone()) showCopyFallback(ctx, f.text);
    else await markBackup(ctx, 'Kopia pobrana jako plik');
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
