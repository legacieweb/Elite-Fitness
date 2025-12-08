const classData = {
    hiit: {
        title: 'HIIT Classes',
        description: 'High-intensity interval training for maximum calorie burn and cardiovascular fitness.',
        image: 'https://images.pexels.com/photos/3621458/pexels-photo-3621458.jpeg',
        details: ['45 minutes per session', 'All fitness levels', 'Monday & Wednesday 6:00 PM', 'Saturday 9:00 AM', 'Expert instructors', 'Community motivation']
    },
    yoga: {
        title: 'Yoga Classes',
        description: 'Flexibility, balance, and mindfulness practice for all experience levels.',
        image: 'https://images.pexels.com/photos/3820681/pexels-photo-3820681.jpeg',
        details: ['60 minutes per session', 'All levels welcome', 'Tuesday & Thursday 5:30 PM', 'Sunday 10:00 AM', 'Relaxation and strength', 'Mind-body connection']
    },
    pilates: {
        title: 'Pilates Classes',
        description: 'Core strengthening and body conditioning with precision movements.',
        image: 'https://images.pexels.com/photos/3807517/pexels-photo-3807517.jpeg',
        details: ['55 minutes per session', 'Beginner-Intermediate', 'Monday & Friday 5:00 PM', 'Saturday 10:30 AM', 'Core focus', 'Body awareness']
    },
    strength: {
        title: 'Strength Training',
        description: 'Build muscle and power with group motivation and expert guidance.',
        image: 'https://images.pexels.com/photos/3837344/pexels-photo-3837344.jpeg',
        details: ['60 minutes per session', 'Intermediate-Advanced', 'Tuesday & Thursday 6:30 PM', 'Sunday 11:30 AM', 'Resistance training', 'Progressive overload']
    },
    spinning: {
        title: 'Spinning Classes',
        description: 'Indoor cycling with high-energy beats and motivational atmosphere.',
        image: 'https://images.pexels.com/photos/1552252/pexels-photo-1552252.jpeg',
        details: ['45 minutes per session', 'All levels', 'Monday & Wednesday 7:00 PM', 'Saturday 8:00 AM', 'Cardio intensive', 'Music-driven']
    },
    zumba: {
        title: 'Zumba Dance',
        description: 'Fun, rhythmic dance workout that burns calories while having fun.',
        image: 'https://images.pexels.com/photos/3640519/pexels-photo-3640519.jpeg',
        details: ['50 minutes per session', 'All levels', 'Wednesday & Friday 5:45 PM', 'Sunday 5:00 PM', 'Dance fitness', 'Party atmosphere']
    }
};

function viewClass(classType) {
    const data = classData[classType];
    if (!data) return;
    const modal = document.getElementById('modalOverlay');
    const modalImage = modal.querySelector('.modal-image');
    const modalTitle = document.getElementById('modalTitle');
    const modalDescription = document.getElementById('modalDescription');
    const modalDetails = document.getElementById('modalDetails');
    
    modalImage.style.backgroundImage = `url('${data.image}')`;
    modalTitle.textContent = data.title;
    modalDescription.textContent = data.description;
    modalDetails.innerHTML = '';
    data.details.forEach(detail => {
        const li = document.createElement('li');
        li.textContent = detail;
        modalDetails.appendChild(li);
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

            const submitBtn = this.querySelector('.submit-btn');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = 'Processing...';
            submitBtn.disabled = true;

            const name = document.getElementById('name').value;
            const email = document.getElementById('email').value;
            const classType = document.getElementById('class').value;
            const date = document.getElementById('date').value;
            const phone = document.getElementById('phone').value;
            const experience = document.getElementById('experience').value;

            try {
                const response = await fetch('https://elite-fitness-6av3.onrender.com/api/bookings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        type: 'groupClass',
                        name: name,
                        email: email,
                        class: classType,
                        date: date,
                        phone: phone,
                        experience: experience
                    })
                });

                const result = await response.json();

                if (result.success) {
                    alert(`Thank you, ${name}!\n\nClass Reserved!\nBooking ID: ${result.bookingId}\n\nConfirmation sent to ${email}`);
                    this.reset();
                } else {
                    alert('Error processing reservation. Please try again.');
                }
            } catch (error) {
                console.error('Booking error:', error);
                alert('Error processing reservation. Please try again.');
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
