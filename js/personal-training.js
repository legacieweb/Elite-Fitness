let currentTestimonialIndex = 0;

function toggleProgram(header) {
    const card = header.parentElement;
    const isActive = card.classList.contains('active');
    
    document.querySelectorAll('.program-card').forEach(c => {
        c.classList.remove('active');
    });
    
    if (!isActive) {
        card.classList.add('active');
    }
}

function changeTestimonial(direction) {
    const testimonials = document.querySelectorAll('.testimonial-card');
    testimonials[currentTestimonialIndex].classList.remove('active');
    
    currentTestimonialIndex += direction;
    if (currentTestimonialIndex >= testimonials.length) {
        currentTestimonialIndex = 0;
    } else if (currentTestimonialIndex < 0) {
        currentTestimonialIndex = testimonials.length - 1;
    }
    
    testimonials[currentTestimonialIndex].classList.add('active');
    updateDots();
}

function currentTestimonial(index) {
    const testimonials = document.querySelectorAll('.testimonial-card');
    testimonials[currentTestimonialIndex].classList.remove('active');
    currentTestimonialIndex = index;
    testimonials[currentTestimonialIndex].classList.add('active');
    updateDots();
}

function updateDots() {
    const dots = document.querySelectorAll('.dot');
    dots.forEach((dot, index) => {
        if (index === currentTestimonialIndex) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    });
}

function animateCounters() {
    const counters = document.querySelectorAll('.counter');
    
    counters.forEach(counter => {
        const target = parseInt(counter.getAttribute('data-target'));
        let current = 0;
        const increment = target / 50;
        
        const updateCounter = () => {
            current += increment;
            if (current < target) {
                counter.textContent = Math.floor(current);
                requestAnimationFrame(updateCounter);
            } else {
                counter.textContent = target;
            }
        };
        
        updateCounter();
    });
}

const observerOptions = {
    threshold: 0.3,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            if (entry.target.classList.contains('stats-grid')) {
                animateCounters();
                observer.unobserve(entry.target);
            }
        }
    });
}, observerOptions);

document.addEventListener('DOMContentLoaded', () => {
    const statsGrid = document.querySelector('.stats-grid');
    if (statsGrid) {
        observer.observe(statsGrid);
    }
    
    const bookingForm = document.getElementById('booking-form');
    if (bookingForm) {
        bookingForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const name = document.getElementById('name').value;
            const email = document.getElementById('email').value;
            const program = document.getElementById('program').value;
            const sessions = document.getElementById('sessions').value;
            const date = document.getElementById('date').value;
            
            alert(`Thank you, ${name}! Your booking for ${sessions} session(s) of ${program} on ${date} has been received. We'll confirm via email at ${email}.`);
            
            this.reset();
        });
    }
    
    document.querySelectorAll('.program-header').forEach((header, index) => {
        header.addEventListener('click', function() {
            toggleProgram(this);
        });
    });
    
    document.querySelectorAll('.benefit-card').forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.animation = 'none';
            setTimeout(() => {
                this.style.animation = '';
            }, 10);
        });
    });
});

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('booking-form');
    if (form) {
        const inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            input.addEventListener('focus', function() {
                this.style.boxShadow = '0 0 15px rgba(255, 0, 0, 0.4)';
            });
            input.addEventListener('blur', function() {
                this.style.boxShadow = 'none';
            });
        });
    }
});

window.addEventListener('scroll', () => {
    const stats = document.querySelector('.stats-section');
    if (stats && !stats.classList.contains('animated')) {
        const rect = stats.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
            stats.classList.add('animated');
        }
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const programCards = document.querySelectorAll('.program-card');
    programCards.forEach((card, index) => {
        card.style.animationDelay = `${index * 0.1}s`;
    });
});

function createRippleEffect(event) {
    const button = event.currentTarget;
    const ripple = document.createElement('span');
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = event.clientX - rect.left - size / 2;
    const y = event.clientY - rect.top - size / 2;
    
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    ripple.classList.add('ripple');
    
    button.appendChild(ripple);
    
    setTimeout(() => ripple.remove(), 600);
}

document.querySelectorAll('.cta-btn, .book-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
        createRippleEffect(e);
    });
});
