const programData = {
    strength: {
        title: 'Strength Training',
        description: 'Build powerful muscles and increase your overall strength through resistance training. Our expert trainers will guide you through proper form and progressive overload techniques.',
        image: 'https://images.pexels.com/photos/3837344/pexels-photo-3837344.jpeg',
        activities: [
            'Barbell Squats - Intermediate',
            'Deadlifts - Advanced',
            'Bench Press - Intermediate',
            'Pull-ups & Dips - Intermediate',
            'Compound Movements - All Levels',
            'Olympic Lifts - Advanced'
        ]
    },
    cardio: {
        title: 'Cardio & Conditioning',
        description: 'Boost cardiovascular health and stamina with high-intensity workouts designed to improve endurance and metabolic performance.',
        image: 'https://images.pexels.com/photos/3621458/pexels-photo-3621458.jpeg',
        activities: [
            'HIIT Training - All Levels',
            'Circuit Training - Beginner',
            'Running Techniques - All Levels',
            'Interval Sprints - Advanced',
            'Jump Rope & Agility Drills - All Levels',
            'Stair Training - Intermediate'
        ]
    },
    flexibility: {
        title: 'Flexibility & Mobility',
        description: 'Enhance flexibility and reduce injury risk through targeted stretching and mobility work. Perfect for recovery and injury prevention.',
        image: 'https://images.pexels.com/photos/3820681/pexels-photo-3820681.jpeg',
        activities: [
            'Dynamic Stretching - Beginner',
            'Yoga & Pilates - All Levels',
            'Foam Rolling Techniques - Beginner',
            'Joint Stability Work - Intermediate',
            'Functional Movement Patterns - All Levels',
            'Myofascial Release - All Levels'
        ]
    },
    weightloss: {
        title: 'Weight Loss Program',
        description: 'Achieve your weight loss goals with combined cardio and strength training. Includes personalized nutrition consultation for optimal results.',
        image: 'https://images.pexels.com/photos/4397840/pexels-photo-4397840.jpeg',
        activities: [
            'Metabolic Conditioning - Beginner',
            'Fat-Burning Circuits - Intermediate',
            'Low-Impact Cardio - Beginner',
            'Strength & Cardio Combo - Intermediate',
            'Nutrition Consultation - All Levels',
            'Progress Monitoring - All Levels'
        ]
    },
    muscle: {
        title: 'Muscle Building',
        description: 'Build lean muscle mass with strategic training and nutrition guidance. Our program focuses on hypertrophy and progressive strength gains.',
        image: 'https://images.pexels.com/photos/4761010/pexels-photo-4761010.jpeg',
        activities: [
            'Hypertrophy Training - Intermediate',
            'Progressive Overload - Intermediate',
            'Muscle Group Isolation - Intermediate',
            'Supplement Guidance - All Levels',
            'Recovery Protocols - All Levels',
            'Macronutrient Planning - All Levels'
        ]
    },
    sports: {
        title: 'Sports Performance',
        description: 'Enhance athletic performance with sport-specific training techniques. Designed for athletes looking to improve competitiveness.',
        image: 'https://images.pexels.com/photos/3808215/pexels-photo-3808215.jpeg',
        activities: [
            'Speed & Agility Drills - Advanced',
            'Power Development - Advanced',
            'Sport-Specific Conditioning - Advanced',
            'Injury Prevention - All Levels',
            'Mental Training Techniques - All Levels',
            'Performance Analytics - All Levels'
        ]
    }
};

function viewProgram(program) {
    const data = programData[program];
    if (!data) return;

    const modal = document.getElementById('modalOverlay');
    const modalImage = modal.querySelector('.modal-image');
    const modalTitle = document.getElementById('modalTitle');
    const modalDescription = document.getElementById('modalDescription');
    const modalActivities = document.getElementById('modalActivities');

    modalImage.style.backgroundImage = `url('${data.image}')`;
    modalTitle.textContent = data.title;
    modalDescription.textContent = data.description;
    
    modalActivities.innerHTML = '';
    data.activities.forEach(activity => {
        const li = document.createElement('li');
        li.textContent = activity;
        modalActivities.appendChild(li);
    });

    modal.classList.add('active');
}

function closeModal() {
    const modal = document.getElementById('modalOverlay');
    modal.classList.remove('active');
}

document.addEventListener('DOMContentLoaded', () => {
    const bookingForm = document.getElementById('booking-form');

    if (bookingForm) {
        bookingForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const submitBtn = this.querySelector('.book-btn');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = 'Processing...';
            submitBtn.disabled = true;

            const name = document.getElementById('name').value;
            const email = document.getElementById('email').value;
            const program = document.getElementById('program').value;
            const sessions = document.getElementById('sessions').value;
            const date = document.getElementById('date').value;

            try {
                const response = await fetch('http://localhost:3000/api/bookings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        type: 'personalTraining',
                        name: name,
                        email: email,
                        program: program,
                        sessions: parseInt(sessions),
                        date: date
                    })
                });

                const result = await response.json();

                if (result.success) {
                    alert(`Thank you, ${name}!\n\nBooking Confirmed!\nBooking ID: ${result.bookingId}\n\nWe'll send confirmation details to ${email}`);
                    this.reset();
                } else {
                    alert('Error processing booking. Please try again.');
                }
            } catch (error) {
                console.error('Booking error:', error);
                alert('Error processing booking. Please try again.');
            } finally {
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }
        });
    }

    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
        });
    });

    document.getElementById('modalOverlay').addEventListener('click', function(e) {
        if (e.target === this) {
            closeModal();
        }
    });

    const inputs = document.querySelectorAll('.booking-form input, .booking-form select');
    inputs.forEach(input => {
        input.addEventListener('focus', function() {
            this.style.transform = 'scale(1.01)';
        });
        
        input.addEventListener('blur', function() {
            this.style.transform = 'scale(1)';
        });
    });

    document.querySelectorAll('.program-card').forEach((card, index) => {
        card.style.animationDelay = `${index * 0.1}s`;
    });

    document.querySelectorAll('.result-card').forEach((card, index) => {
        card.style.animationDelay = `${index * 0.15}s`;
    });

    document.querySelectorAll('.testimonial-card').forEach((card, index) => {
        card.style.animationDelay = `${index * 0.1}s`;
    });
});

window.addEventListener('scroll', () => {
    const programCards = document.querySelectorAll('.program-card');
    programCards.forEach(card => {
        const rect = card.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
            card.style.opacity = '1';
        }
    });
});

document.querySelector('.cta-btn').addEventListener('click', function() {
    const bookingSection = document.querySelector('.booking-section');
    bookingSection.scrollIntoView({ behavior: 'smooth' });
});
