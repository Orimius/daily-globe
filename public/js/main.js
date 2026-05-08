document.addEventListener('DOMContentLoaded', () => {
  const intro = document.getElementById('intro');
  const topbar = document.querySelector('.topbar');
  if (intro) {
    setTimeout(() => {
      intro.classList.add('hide');
      if (topbar) topbar.classList.add('show');
    }, 1800);
    setTimeout(() => { intro.style.display = 'none'; }, 2400);
  } else if (topbar) {
    topbar.classList.add('show');
  }

  const modal = document.getElementById('imageModal');
  const modalImg = document.getElementById('imageModalImg');
  document.querySelectorAll('.zoomable-image, .clickable-media img').forEach(img => {
    img.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (!modal || !modalImg) return;
      modalImg.src = img.dataset.full || img.src;
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
    });
  });
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target.matches('[data-close-modal="true"]')) {
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
      }
    });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal && modal.classList.contains('open')) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('modal-open');
    }
  });
});
