// Ekran powitalny (pierwsze uruchomienie): kopia startowa albo start od zera.
import { setSetting } from '../db.js';
import { esc, ICON } from './util.js';
import { importText } from './backup.js';
import { importMsgHtml } from './settings.js';

export function shouldShowWelcome(data) {
  const s = data.settings || {};
  if (s.onboarded) return false;
  if (data.entries && data.entries.length > 0) return false;
  return data.baskets.every((b) => !b.limit);
}

export function renderWelcome(ctx) {
  const ui = ctx.ui;
  let h = '<div class="logo">' + ICON.basket + '</div>' +
    '<h1>Koszyki</h1>' +
    '<p>Budżet w koszykach z miesięcznymi limitami. Dane zostają w tym telefonie. Na start wczytaj kopię startową z limitami i płatnościami albo zacznij od pustych koszyków.</p>' +
    '<label class="btn pri block filebtn" style="position:relative;overflow:hidden">Wczytaj kopię startową z pliku' +
    '<input type="file" accept=".json,application/json" data-change="file-import" style="position:absolute;inset:0;width:100%;height:100%;opacity:0;font-size:16px"></label>';
  if (ui.welcomePaste) {
    h += '<textarea class="paste" id="welcomeBox" data-input="welcome-paste" placeholder="Wklej tu treść kopii (JSON)" spellcheck="false" autocapitalize="off" autocomplete="off" style="margin-top:8px">' + esc(ui.welcomeText || '') + '</textarea>' +
      '<button type="button" class="btn sec2 block" data-act="welcome-import">Wczytaj wklejony tekst</button>';
  } else {
    h += '<button type="button" class="btn sec2 block" data-act="welcome-paste">Wklej kopię</button>';
  }
  h += importMsgHtml(ctx);
  h += '<button type="button" class="btn sec2 block" data-act="welcome-skip" style="margin-top:24px">Zacznij od zera</button>';
  return h;
}

export const actions = {
  'welcome-paste'(el, ctx) {
    ctx.ui.welcomePaste = true;
    ctx.render();
  },
  async 'welcome-import'(el, ctx) {
    const box = document.getElementById('welcomeBox');
    await importText(ctx, box ? box.value : ctx.ui.welcomeText);
  },
  async 'welcome-skip'(el, ctx) {
    await setSetting('onboarded', true);
    await ctx.reload();
  },
};

export const inputs = {
  'welcome-paste'(el, ctx) { ctx.ui.welcomeText = el.value; },
};
