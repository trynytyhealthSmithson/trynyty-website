// Mobile navigation toggle
document.addEventListener('DOMContentLoaded', function () {
  const hamburger = document.querySelector('.nav-hamburger');
  const navLinks = document.querySelector('.nav-links');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', function () {
      navLinks.classList.toggle('open');
    });
    navLinks.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => navLinks.classList.remove('open'));
    });
  }

  // Scroll-based nav shadow
  const nav = document.querySelector('.nav');
  if (nav) {
    window.addEventListener('scroll', function () {
      nav.style.boxShadow = window.scrollY > 40
        ? '0 4px 32px rgba(0,0,0,0.4)' : 'none';
    });
  }

  // GA4 launch_explorer event — fires when any link to an Explorer subdomain is clicked
  document.querySelectorAll('.explorer-launch').forEach(link => {
    link.addEventListener('click', function () {
      if (typeof gtag === 'function') {
        gtag('event', 'launch_explorer', {
          explorer: this.dataset.explorer,
          source_page: window.location.pathname
        });
      }
    });
  });
});
