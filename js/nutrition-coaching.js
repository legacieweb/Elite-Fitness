const programData = {
    weightloss: {
        title: 'Weight Loss Nutrition',
        description: 'Strategic meal planning to shed pounds while maintaining muscle.',
        details: ['Calorie assessment', 'Macro nutrient calculations', 'Meal prep guidance', 'Recipe suggestions', 'Progress tracking', 'Grocery lists']
    },
    muscle: {
        title: 'Muscle Gain Nutrition',
        description: 'Protein-focused plans to maximize muscle growth.',
        details: ['High-protein planning', 'Supplement recommendations', 'Post-workout timing', 'Caloric surplus planning', 'Amino acid optimization', 'Recovery protocols']
    },
    athletic: {
        title: 'Athletic Performance',
        description: 'Optimize nutrition for peak athletic performance.',
        details: ['Pre-competition fueling', 'Hydration strategies', 'Endurance nutrition', 'Recovery meal planning', 'Sport protocols', 'Performance monitoring']
    },
    wellness: {
        title: 'Overall Wellness',
        description: 'Balanced nutrition for health and sustained energy.',
        details: ['Balanced meal planning', 'Nutritional education', 'Healthy habits', 'Allergy accommodations', 'Budget options', 'Sustainability']
    }
};

function viewProgram(program) {
    const data = programData[program];
    if (!data) return;
    const modal = document.getElementById('modalOverlay');
    const modalImage = modal.querySelector('.modal-image');
    const modalTitle = document.getElementById('modalTitle');
    const modalDescription = document.getElementById('modalDescription');
    const modalServices = document.getElementById('modalServices');
    modalTitle.textContent = data.title;
    modalDescription.textContent = data.description;
    modalServices.innerHTML = '';
    data.details.forEach(service => {
        const li = document.createElement('li');
        li.textContent = service;
        modalServices.appendChild(li);
    });
    modal.classList.add('active');
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
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
                const response = await fetch('https://elite-fitness-6av3.onrender.com/api/bookings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        type: 'nutritionCoaching',
                        name: name,
                        email: email,
                        program: program,
                        sessions: parseInt(sessions),
                        date: date
                    })
                });

                const result = await response.json();

                if (result.success) {
                    alert(`Thank you, ${name}!\n\nConsultation Booked!\nBooking ID: ${result.bookingId}\n\nConfirmation sent to ${email}`);
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
    document.getElementById('modalOverlay').addEventListener('click', function(e) {
        if (e.target === this) closeModal();
    });
});
