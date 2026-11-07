// Toast z opcjonalnym "Cofnij".
let timer = null;
let undoFn = null;

function $(id) { return document.getElementById(id); }

export function initToast() {
  $('toastUndo').addEventListener('click', async () => {
    const fn = undoFn;
    undoFn = null;
    hideToast();
    if (fn) {
      try { await fn(); } catch (err) { showToast('Nie udało się cofnąć'); }
    }
  });
}

export function hideToast() {
  clearTimeout(timer);
  $('toast').classList.remove('on');
}

export function showToast(msg, undo, ms) {
  $('toastTxt').textContent = msg;
  undoFn = typeof undo === 'function' ? undo : null;
  $('toastUndo').style.display = undoFn ? '' : 'none';
  $('toast').classList.add('on');
  clearTimeout(timer);
  timer = setTimeout(() => { $('toast').classList.remove('on'); undoFn = null; }, ms || (undoFn ? 6000 : 3500));
}
