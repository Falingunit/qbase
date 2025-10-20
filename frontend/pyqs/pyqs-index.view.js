// View for PYQs index (exams grid)
import { buildToolbar, checkEmpty } from './pyqs-ui.js';
import { ICON_FALLBACK, starredExams } from './pyqs-service.js';

export function hideBreadcrumb(els) {
  try { if (els.breadcrumb) els.breadcrumb.classList.add('d-none'); } catch {}
}

export function renderExamsView(els, exams, { onToggleStar }) {
  els.toolbar.innerHTML = '';
  buildToolbar(els.toolbar, ({ q }) => {
    els.content.innerHTML = '';

    if (els.starredExamsWrap && els.starredExamsGrid) {
      els.starredExamsGrid.innerHTML = '';
      const starredList = exams.filter((e) => starredExams.has(e.id) && matchExam(e, q));
      if (starredList.length > 0) {
        starredList.forEach((it) => els.starredExamsGrid.appendChild(examCard(it, { onToggleStar })));
        els.starredExamsWrap.classList.remove('d-none');
        if (els.starredExamsCount) els.starredExamsCount.textContent = `(${starredList.length})`;
      } else {
        els.starredExamsWrap.classList.add('d-none');
      }
    }

    const grid = document.createElement('div'); grid.className = 'as-grid';
    exams.forEach((ex) => {
      const card = examCard(ex, { onToggleStar });
      const isVisible = matchExam(ex, q);
      card.classList.toggle('d-none', !isVisible);
      grid.appendChild(card);
    });
    els.content.appendChild(grid);
    checkEmpty(els.content);
  }, { title: 'Exams', placeholder: 'Search exams…' });
}

function matchExam(exam, q) { const hay = `${exam.name}`.toLowerCase(); return !q || hay.includes(q); }

function examCard(exam, { onToggleStar }) {
  const card = document.createElement('div'); card.className = 'card as-card pyqs-card h-100';
  if (starredExams.has(exam.id)) card.classList.add('as-starred');
  const body = document.createElement('div'); body.className = 'card-body';
  const icoWrap = document.createElement('div'); icoWrap.className = 'pyqs-icon-wrap';
  const img = document.createElement('img'); img.className = 'pyqs-icon'; img.loading = 'lazy'; img.src = exam.icon || ICON_FALLBACK; img.onerror = () => { img.src = ICON_FALLBACK; };
  icoWrap.appendChild(img);
  const info = document.createElement('div'); info.className = 'flex-grow-1';
  const title = document.createElement('h5'); title.className = 'pyqs-title'; title.textContent = exam.name;
  info.append(title);
  
  const starBtn = document.createElement('button');
  starBtn.type = 'button'; starBtn.className = 'as-star-btn btn btn-sm btn-link p-0 m-0';
  const isStarred = starredExams.has(exam.id);
  starBtn.innerHTML = isStarred ? '<i class="bi bi-star-fill"></i>' : '<i class="bi bi-star"></i>';
  starBtn.title = isStarred ? 'Unstar' : 'Star';
  starBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onToggleStar?.(exam.id, !isStarred); });
  if (isStarred) card.classList.add('as-starred');

  card.append(starBtn, body); body.append(icoWrap, info);

  card.addEventListener('click', () => {
    const url = new URL('./pyqs_chapters.html', location.href);
    url.searchParams.set('exam', exam.id);
    location.href = url.toString();
  });
  return card;
}

