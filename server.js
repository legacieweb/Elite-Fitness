const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from the root directory
app.use(express.static('.'));

// MongoDB connection
mongoose.connect('mongodb+srv://iyonicorp:iyonicorp@iyonicweb.ypgpsxv.mongodb.net/?retryWrites=true&w=majority&appName=iyonicweb', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Booking Schema
const bookingSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  timestamp: { type: Date, default: Date.now },
  type: { type: String, required: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  // Personal Training fields
  program: String,
  sessions: Number,
  // Group Class fields
  class: String,
  phone: String,
  experience: String,
  // All types
  date: { type: String, required: true }
});

const Booking = mongoose.model('Booking', bookingSchema);

// Email configuration (you'll need to set up your email service)
const transporter = nodemailer.createTransport({
  service: 'gmail', // or your email service
  auth: {
    user: process.env.EMAIL_USER || 'iyonicorp@gmail.com',
    pass: process.env.EMAIL_PASS || 'dikfirjarvijwskx'
  }
});


// Email templates
const emailTemplates = {
  personalTraining: (booking) => `
    <h2>Personal Training Session Confirmed!</h2>
    <p>Dear ${booking.name},</p>
    <p>Thank you for booking your personal training session with Elite Fitness!</p>
    <div style="background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 5px;">
      <h3>Booking Details:</h3>
      <p><strong>Program:</strong> ${booking.program}</p>
      <p><strong>Sessions:</strong> ${booking.sessions}</p>
      <p><strong>Start Date:</strong> ${booking.date}</p>
      <p><strong>Booking ID:</strong> ${booking.id}</p>
    </div>
    <p>Please arrive 10 minutes early for your first session. If you need to reschedule, contact us at least 24 hours in advance.</p>
    <p>We look forward to helping you achieve your fitness goals!</p>
    <p>Best regards,<br>Elite Fitness Team</p>
  `,

  groupClass: (booking) => `
    <h2>Group Class Reservation Confirmed!</h2>
    <p>Dear ${booking.name},</p>
    <p>Thank you for reserving your spot in our group class!</p>
    <div style="background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 5px;">
      <h3>Reservation Details:</h3>
      <p><strong>Class:</strong> ${booking.class}</p>
      <p><strong>Date:</strong> ${booking.date}</p>
      <p><strong>Experience Level:</strong> ${booking.experience}</p>
      <p><strong>Phone:</strong> ${booking.phone}</p>
      <p><strong>Booking ID:</strong> ${booking.id}</p>
    </div>
    <p>Please arrive 15 minutes early for check-in. Bring water and a towel.</p>
    <p>See you in class!</p>
    <p>Best regards,<br>Elite Fitness Team</p>
  `,

  nutritionCoaching: (booking) => `
    <h2>Nutrition Coaching Consultation Confirmed!</h2>
    <p>Dear ${booking.name},</p>
    <p>Thank you for booking your nutrition coaching consultation!</p>
    <div style="background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 5px;">
      <h3>Consultation Details:</h3>
      <p><strong>Program:</strong> ${booking.program}</p>
      <p><strong>Sessions:</strong> ${booking.sessions}</p>
      <p><strong>Date:</strong> ${booking.date}</p>
      <p><strong>Booking ID:</strong> ${booking.id}</p>
    </div>
    <p>Your coach will contact you within 24 hours to prepare for your consultation.</p>
    <p>We're excited to help you transform your nutrition habits!</p>
    <p>Best regards,<br>Elite Fitness Team</p>
  `
};

// API Routes
app.post('/api/bookings', async (req, res) => {
  try {
    const bookingData = {
      id: Date.now().toString(),
      ...req.body
    };

    // Create new booking in MongoDB
    const booking = new Booking(bookingData);
    await booking.save();

    // Send confirmation email
    const template = emailTemplates[booking.type] || emailTemplates.personalTraining;
    const mailOptions = {
      from: process.env.EMAIL_USER || 'your-email@gmail.com',
      to: booking.email,
      subject: 'Booking Confirmation - Elite Fitness',
      html: template(booking)
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log('Confirmation email sent to:', booking.email);

      // Send admin notification email
      const adminMailOptions = {
        from: process.env.EMAIL_USER || 'your-email@gmail.com',
        to: 'iyonicorp@gmail.com',
        subject: `New Booking Alert - ${booking.type}`,
        html: `
          <h2>New Booking Received!</h2>
          <p>A new booking has been made on Elite Fitness.</p>
          <div style="background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 5px;">
            <h3>Booking Details:</h3>
            <p><strong>Type:</strong> ${booking.type}</p>
            <p><strong>Name:</strong> ${booking.name}</p>
            <p><strong>Email:</strong> ${booking.email}</p>
            <p><strong>Date:</strong> ${booking.date}</p>
            <p><strong>Booking ID:</strong> ${booking.id}</p>
            ${booking.program ? `<p><strong>Program:</strong> ${booking.program}</p>` : ''}
            ${booking.sessions ? `<p><strong>Sessions:</strong> ${booking.sessions}</p>` : ''}
            ${booking.class ? `<p><strong>Class:</strong> ${booking.class}</p>` : ''}
            ${booking.phone ? `<p><strong>Phone:</strong> ${booking.phone}</p>` : ''}
            ${booking.experience ? `<p><strong>Experience:</strong> ${booking.experience}</p>` : ''}
            <p><strong>Timestamp:</strong> ${new Date(booking.timestamp).toLocaleString()}</p>
          </div>
          <p>Please check the admin panel for full details.</p>
        `
      };

      await transporter.sendMail(adminMailOptions);
      console.log('Admin notification sent to: iyonicorp@gmail.com');

    } catch (emailError) {
      console.error('Error sending email:', emailError);
      // Don't fail the booking if email fails
    }

    res.status(201).json({
      success: true,
      message: 'Booking confirmed successfully!',
      bookingId: booking.id
    });

  } catch (error) {
    console.error('Error processing booking:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing booking. Please try again.'
    });
  }
});

// Get all bookings (for admin)
app.get('/api/bookings', async (req, res) => {
  try {
    const bookings = await Booking.find().sort({ timestamp: -1 });
    res.json(bookings);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Error fetching bookings' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Elite Fitness server running on port ${PORT}`);
  console.log(`Admin panel available at http://localhost:${PORT}/admin.html`);
});

module.exports = app;