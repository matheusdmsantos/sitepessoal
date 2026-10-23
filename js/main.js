/* ─── js/main.js ─── */

/* =============================================
   1. LOADER
============================================= */
window.addEventListener('load', () => {
  const loader = document.getElementById('loader');
  setTimeout(() => {
    loader.classList.add('hidden');
    document.body.style.overflow = '';
    initCounters();
    initSkillBars();
  }, 1900);
});

document.body.style.overflow = 'hidden';



/* =============================================
   3. HEADER — scroll effect & active nav
============================================= */
const header   = document.getElementById('header');
const navLinks = document.querySelectorAll('.nav-link');
const sections = document.querySelectorAll('main section[id]');

window.addEventListener('scroll', () => {
  if (window.scrollY > 40) {
    header.classList.add('scrolled');
  } else {
    header.classList.remove('scrolled');
  }

  let current = '';
  sections.forEach(section => {
    const sectionTop = section.offsetTop - 120;
    if (window.scrollY >= sectionTop) {
      current = section.getAttribute('id');
    }
  });
  navLinks.forEach(link => {
    link.classList.remove('active');
    if (link.getAttribute('href') === '#' + current) {
      link.classList.add('active');
    }
  });
}, { passive: true });

/* =============================================
   4. MOBILE MENU
============================================= */
const navToggle  = document.getElementById('nav-toggle');
const mobileMenu = document.getElementById('mobile-menu');
const mobileLinks = document.querySelectorAll('.mobile-link');

navToggle.addEventListener('click', () => {
  const isOpen = !mobileMenu.hidden;
  mobileMenu.hidden = isOpen;
  navToggle.setAttribute('aria-expanded', !isOpen);

  const spans = navToggle.querySelectorAll('span');
  if (!isOpen) {
    spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
    spans[1].style.opacity = '0';
    spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
  } else {
    spans[0].style.transform = '';
    spans[1].style.opacity = '';
    spans[2].style.transform = '';
  }
});

mobileLinks.forEach(link => {
  link.addEventListener('click', () => {
    mobileMenu.hidden = true;
    navToggle.setAttribute('aria-expanded', 'false');
    const spans = navToggle.querySelectorAll('span');
    spans[0].style.transform = '';
    spans[1].style.opacity = '';
    spans[2].style.transform = '';
  });
});

/* =============================================
   5. SCROLL ANIMATIONS
============================================= */
const animateEls = document.querySelectorAll('[data-animate]');
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 }
);
animateEls.forEach(el => observer.observe(el));

/* =============================================
   6. COUNTER ANIMATION
============================================= */
function initCounters() {
  const counters = document.querySelectorAll('.stat-number[data-target]');
  counters.forEach(counter => {
    const target = parseInt(counter.dataset.target);
    const duration = 1600;
    const startTime = performance.now();
    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      counter.textContent = Math.floor(eased * target);
      if (progress < 1) requestAnimationFrame(update);
      else counter.textContent = target;
    }
    requestAnimationFrame(update);
  });
}

/* =============================================
   7. SKILL BAR ANIMATION (mantido por compatibilidade)
============================================= */
function initSkillBars() {
  const skillObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const fill = entry.target;
          const width = fill.dataset.width;
          fill.style.width = width + '%';
          skillObserver.unobserve(fill);
        }
      });
    },
    { threshold: 0.5 }
  );
  document.querySelectorAll('.skill-fill').forEach(el => skillObserver.observe(el));
}

/* =============================================
   8. CONTACT FORM
============================================= */
const contactForm  = document.getElementById('contact-form');
const formFeedback = document.getElementById('form-feedback');
const btnEnviar    = document.getElementById('btn-enviar');
const btnText      = document.getElementById('btn-enviar-text');

if (contactForm) {
  contactForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const name  = document.getElementById('form-name').value.trim();
    const email = document.getElementById('form-email').value.trim();
    const msg   = document.getElementById('form-message').value.trim();

    if (!name || !email || !msg) {
      showFeedback('Por favor, preencha os campos obrigatórios.', 'error');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showFeedback('Por favor, insira um e-mail válido.', 'error');
      return;
    }

    btnText.textContent = 'Enviando...';
    btnEnviar.disabled = true;

    setTimeout(() => {
      contactForm.reset();
      btnText.textContent = 'Enviar Mensagem';
      btnEnviar.disabled = false;
      showFeedback('✅ Mensagem enviada com sucesso! Entrarei em contato em breve.', 'success');
    }, 1800);
  });
}

function showFeedback(message, type) {
  formFeedback.textContent = message;
  formFeedback.className = 'form-feedback ' + type;
  formFeedback.hidden = false;
  setTimeout(() => { formFeedback.hidden = true; }, 5500);
}

/* =============================================
   9. FOOTER YEAR
============================================= */
const yearEl = document.getElementById('footer-year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

/* =============================================
   10. PROJECT CARDS — staggered reveal
============================================= */
const projectCards = document.querySelectorAll('.project-card');
const projectObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        setTimeout(() => {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
        }, i * 130);
        projectObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.08 }
);
projectCards.forEach(card => {
  card.style.opacity = '0';
  card.style.transform = 'translateY(28px)';
  card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
  projectObserver.observe(card);
});

/* =============================================
   11. SERVICE CARDS — staggered reveal
============================================= */
const serviceCards = document.querySelectorAll('.service-card');
const serviceObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        setTimeout(() => {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
        }, i * 90);
        serviceObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.06 }
);
serviceCards.forEach(card => {
  card.style.opacity = '0';
  card.style.transform = 'translateY(22px)';
  card.style.transition = 'opacity 0.55s ease, transform 0.55s ease';
  serviceObserver.observe(card);
});

/* =============================================
   12. KEYBOARD ACCESSIBILITY
============================================= */
document.querySelectorAll('.project-card').forEach(card => {
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const link = card.querySelector('a');
      if (link) link.click();
    }
  });
});
