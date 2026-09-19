require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

// Middleware
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://hitrepublic.iyonicorp.com',
  'https://www.hitrepublic.iyonicorp.com',
  'http://localhost:3000',
  'null', // requests from file:/// send Origin: null
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(bodyParser.json({ limit: '20mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '20mb' }));
app.use(cookieParser());
app.use(express.static('.'));

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Neon PostgreSQL connection
let pool;
let dbConnected = false;

if (process.env.NEON_DATABASE_URL) {
  try {
    const neonUrl = new URL(process.env.NEON_DATABASE_URL);

    pool = new Pool({
      connectionString: process.env.NEON_DATABASE_URL,
      ssl: { rejectUnauthorized: false, servername: neonUrl.hostname },
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 10,
    });

    pool.on('error', (err, client) => {
      console.error('Unexpected database error:', err.message);
    });

    dbConnected = true;
    console.log('Pool initialized');
  } catch (err) {
    console.error('Pool initialization error:', err.message);
  }
}

if (!dbConnected) {
  console.log('Database not configured - using mock mode');
}

// Initialize database tables
async function initializeDb() {
  if (!dbConnected) {
    console.log('Database not configured - skipping table initialization');
    return;
  }

  try {
    await pool.query('SELECT 1');
    await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        booking_uuid TEXT UNIQUE NOT NULL,
        timestamp TIMESTAMP DEFAULT NOW(),
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        program TEXT,
        sessions INTEGER,
        class TEXT,
        phone TEXT,
        experience TEXT,
        date TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        user_uuid UUID DEFAULT gen_random_uuid() UNIQUE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        password_hash TEXT NOT NULL,
        membership_status TEXT DEFAULT 'basic',
        profile_picture TEXT,
        assigned_workout_plan_id INTEGER REFERENCES workout_plans(id),
        workout_plan_completed BOOLEAN DEFAULT FALSE,
        join_date TIMESTAMP DEFAULT NOW(),
        last_active TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS workout_plans (
        id SERIAL PRIMARY KEY,
        plan_uuid TEXT UNIQUE NOT NULL,
        plan_name TEXT NOT NULL,
        description TEXT,
        difficulty TEXT DEFAULT 'intermediate',
        exercises JSONB NOT NULL,
        created_by UUID REFERENCES coaches(coach_uuid),
        is_mandatory BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS fitness_goals (
        id SERIAL PRIMARY KEY,
        user_uuid UUID REFERENCES users(user_uuid) ON DELETE CASCADE,
        goal_name TEXT NOT NULL,
        target_value TEXT,
        current_progress INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS workouts (
        id SERIAL PRIMARY KEY,
        user_uuid UUID REFERENCES users(user_uuid) ON DELETE CASCADE,
        workout_type TEXT NOT NULL,
        workout_date DATE NOT NULL,
        duration_minutes INTEGER,
        calories_burned INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );

       CREATE TABLE IF NOT EXISTS nutrition_logs (
         id SERIAL PRIMARY KEY,
         user_uuid UUID REFERENCES users(user_uuid) ON DELETE CASCADE,
         meal_type TEXT NOT NULL,
         meal_name TEXT NOT NULL,
         calories INTEGER,
         log_date DATE NOT NULL,
         created_at TIMESTAMP DEFAULT NOW()
       );

       CREATE TABLE IF NOT EXISTS coaches (
          id SERIAL PRIMARY KEY,
          coach_uuid UUID DEFAULT gen_random_uuid() UNIQUE,
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          phone TEXT,
          specialty TEXT DEFAULT 'General Fitness',
          status TEXT DEFAULT 'active',
          temp_password BOOLEAN DEFAULT TRUE,
          force_password_change BOOLEAN DEFAULT TRUE,
          last_active TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
         );
      `);

       // Exercise library table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS exercise_library (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          description TEXT,
          default_sets INTEGER DEFAULT 3,
          default_reps TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(name)
        );
      `);

      // Workout sessions table (for timer tracking)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS workout_sessions (
          id SERIAL PRIMARY KEY,
          session_uuid TEXT UNIQUE NOT NULL,
          user_uuid UUID REFERENCES users(user_uuid) ON DELETE CASCADE,
          workout_type TEXT NOT NULL,
          plan_id INTEGER REFERENCES workout_plans(id),
          status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
          target_duration INTEGER DEFAULT 1800,
          elapsed_seconds INTEGER DEFAULT 0,
          start_time TIMESTAMP,
          pause_start TIMESTAMP,
          end_time TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `);

      // ===== MIGRATIONS: Add new columns if they don't exist (for pre-existing tables) =====
      const migrations = [
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture TEXT;',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS assigned_workout_plan_id INTEGER REFERENCES workout_plans(id);',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS workout_plan_completed BOOLEAN DEFAULT FALSE;',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS coach_uuid UUID REFERENCES coaches(coach_uuid) ON DELETE SET NULL;',
        'ALTER TABLE coaches ADD COLUMN IF NOT EXISTS temp_password BOOLEAN DEFAULT TRUE;',
        'ALTER TABLE coaches ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN DEFAULT TRUE;',
        'ALTER TABLE coaches ADD COLUMN IF NOT EXISTS last_active TIMESTAMP;',
        'ALTER TABLE coaches ADD COLUMN IF NOT EXISTS profile_picture TEXT;',
        'ALTER TABLE coaches ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();',
      ];
     for (const migration of migrations) {
       try {
         await pool.query(migration);
       } catch (migErr) {
         console.warn('Migration warning:', migErr.message);
       }
     }

     console.log('Connected to Neon PostgreSQL');
  } catch (err) {
    console.error('Database connection error:', err.message);
    dbConnected = false;
    console.log('Database connection failed - admin login still available, data features disabled');
  }
}

initializeDb();
setTimeout(seedExerciseLibrary, 3000);

// ============================================================================
// AUTHENTICATION & AUTH MIDDLEWARE
// ============================================================================

function requireAuth(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

// ============================================================================
// EVENT BUS (Real-time broadcast foundation)
// ============================================================================

class EventBus {
  constructor() {
    this.wsClients = new Map();
    this.sseClients = new Map();
    this.seq = 0;
  }

  addWsClient(user_uuid, ws) {
    if (!this.wsClients.has(user_uuid)) this.wsClients.set(user_uuid, new Set());
    this.wsClients.get(user_uuid).add(ws);
  }

  addSseClient(user_uuid, res) {
    if (!this.sseClients.has(user_uuid)) this.sseClients.set(user_uuid, new Set());
    this.sseClients.get(user_uuid).add(res);
  }

  removeWsClient(user_uuid, ws) {
    const clients = this.wsClients.get(user_uuid);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) this.wsClients.delete(user_uuid);
    }
  }

  removeSseClient(user_uuid, res) {
    const clients = this.sseClients.get(user_uuid);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) this.sseClients.delete(user_uuid);
    }
    if (res && !res.finished) res.end();
  }

  emit(user_uuid, type, payload) {
    this.seq++;
    const seq = this.seq;
    const data = JSON.stringify({ type, payload, seq });

    // Broadcast via WebSocket
    const wsClients = this.wsClients.get(user_uuid);
    if (wsClients) {
      for (const ws of wsClients) {
        if (ws.readyState === ws.OPEN) ws.send(data);
      }
    }

    // Broadcast via SSE
    const sseClients = this.sseClients.get(user_uuid);
    if (sseClients) {
      for (const res of sseClients) {
        res.write(`event: ${type}\ndata: ${data}\n\n`);
      }
    }
  }
}

const eventBus = new EventBus();

// ============================================================================
// EMAIL CONFIGURATION
// ============================================================================

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'iyonicorp@gmail.com',
    pass: process.env.EMAIL_PASS || 'dikfirjarvijwijwskx'
  }
});

const emailTemplates = {
  personalTraining: (booking) => `
    <h2>Personal Training Session Confirmed!</h2>
    <p>Dear ${booking.name},</p>
    <p>Thank you for booking your personal training session with HitRepublic!</p>
    <div style="background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 5px;">
      <h3>Booking Details:</h3>
      <p><strong>Program:</strong> ${booking.program}</p>
      <p><strong>Sessions:</strong> ${booking.sessions}</p>
      <p><strong>Start Date:</strong> ${booking.date}</p>
      <p><strong>Booking ID:</strong> ${booking.id}</p>
    </div>
    <p>Please arrive 10 minutes early for your first session. If you need to reschedule, contact us at least 24 hours in advance.</p>
    <p>We look forward to helping you achieve your fitness goals!</p>
    <p>Best regards,<br>HitRepublic Team</p>
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
    <p>Best regards,<br>HitRepublic Team</p>
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
    <p>Best regards,<br>HitRepublic Team</p>
  `
};

// ============================================================================
// AUTH ROUTES
// ============================================================================

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
    const token = jwt.sign({ email, isAdmin: true }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
     return res.json({ success: true, message: 'Admin authenticated', isAdmin: true, token });
  }

  if (!dbConnected) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  try {
    const coachResult = await pool.query(
      'SELECT coach_uuid, first_name, last_name, email, password_hash, phone, specialty, status, temp_password, force_password_change FROM coaches WHERE email = $1',
      [email]
    );

    if (coachResult.rows.length > 0) {
      const coach = coachResult.rows[0];
      const passwordValid = await bcrypt.compare(password, coach.password_hash);
      if (!passwordValid) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      await pool.query('UPDATE coaches SET last_active = NOW() WHERE coach_uuid = $1', [coach.coach_uuid]);

      const token = jwt.sign({
        coach_uuid: coach.coach_uuid,
        email: coach.email,
        isCoach: true,
        isAdmin: false,
        force_password_change: coach.force_password_change
      }, JWT_SECRET, { expiresIn: '7d' });

      return res.json({
        success: true,
        message: 'Coach authenticated',
        isCoach: true,
        isAdmin: false,
        forcePasswordChange: coach.force_password_change,
        coach: {
          coach_uuid: coach.coach_uuid,
          first_name: coach.first_name,
          last_name: coach.last_name,
          email: coach.email,
          specialty: coach.specialty
        },
        token
      });
    }

    const result = await pool.query(
      'SELECT user_uuid, first_name, last_name, email, password_hash, membership_status FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const user = result.rows[0];

    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    await pool.query('UPDATE users SET last_active = NOW() WHERE email = $1', [email]);

    const token = jwt.sign({ user_uuid: user.user_uuid, email: user.email, isAdmin: false }, JWT_SECRET, { expiresIn: '7d' });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        user_uuid: user.user_uuid,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        membership_status: user.membership_status
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

app.post('/api/auth/register', authLimiter, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({ success: false, message: 'Database not configured' });
  }
  try {
  const { firstName, lastName, email, phone, password, profile_picture } = req.body;

    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
    const password_hash = await bcrypt.hash(password, saltRounds);

    const result = await pool.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, profile_picture)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING user_uuid, first_name, last_name, email, membership_status, profile_picture`,
      [firstName, lastName, email, phone, password_hash, profile_picture || null]
    );

    const user = result.rows[0];
    const token = jwt.sign({ user_uuid: user.user_uuid, email: user.email, isAdmin: false }, JWT_SECRET, { expiresIn: '7d' });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.status(201).json({
      success: true,
      user: result.rows[0],
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === '23505') {
      res.status(409).json({ success: false, message: 'Email already registered' });
    } else {
      res.status(500).json({ success: false, message: 'Registration failed' });
    }
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  if (req.user.isAdmin) {
    return res.json({ success: true, user: { email: req.user.email, isAdmin: true } });
  }
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  try {
    const result = await pool.query(
      'SELECT user_uuid, first_name, last_name, email, phone, membership_status, profile_picture, join_date, last_active FROM users WHERE user_uuid = $1',
      [req.user.user_uuid]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, sameSite: 'lax' });
  res.json({ success: true, message: 'Logged out successfully' });
});

// ============================================================================
// BOOKING ROUTES (existing, preserved)
// ============================================================================

app.post('/api/bookings', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not configured. Please contact the administrator.'
    });
  }
  try {
    const bookingData = {
      booking_uuid: Date.now().toString(),
      ...req.body
    };

    const result = await pool.query(
      `INSERT INTO bookings (booking_uuid, type, name, email, program, sessions, class, phone, experience, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        bookingData.booking_uuid,
        bookingData.type,
        bookingData.name,
        bookingData.email,
        bookingData.program,
        bookingData.sessions,
        bookingData.class,
        bookingData.phone,
        bookingData.experience,
        bookingData.date
      ]
    );

    const booking = result.rows[0];

    const template = emailTemplates[booking.type] || emailTemplates.personalTraining;
    const mailOptions = {
      from: process.env.EMAIL_USER || 'your-email@gmail.com',
      to: booking.email,
      subject: 'Booking Confirmation - HitRepublic',
      html: template(booking)
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log('Confirmation email sent to:', booking.email);

      const adminMailOptions = {
        from: process.env.EMAIL_USER || 'your-email@gmail.com',
        to: 'iyonicorp@gmail.com',
        subject: `New Booking Alert - ${booking.type}`,
        html: `
          <h2>New Booking Received!</h2>
          <p>A new booking has been made on HitRepublic.</p>
          <div style="background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 5px;">
            <h3>Booking Details:</h3>
            <p><strong>Type:</strong> ${booking.type}</p>
            <p><strong>Name:</strong> ${booking.name}</p>
            <p><strong>Email:</strong> ${booking.email}</p>
            <p><strong>Date:</strong> ${booking.date}</p>
            <p><strong>Booking ID:</strong> ${booking.booking_uuid}</p>
            ${booking.program ? `<p><strong>Program:</strong> ${booking.program}</p>` : ''}
            ${booking.sessions ? `<p><strong>Sessions:</strong> ${booking.sessions}</p>` : ''}
            ${booking.class ? `<p><strong>Class:</strong> ${booking.class}</p>` : ''}
            ${booking.phone ? `<p><strong>Phone:</strong> ${booking.phone}</p>` : ''}
            ${booking.experience ? `<p><strong>Experience:</strong> ${booking.experience}</p>` : ''}
          </div>
          <p>Please check the admin panel for full details.</p>
        `
      };

      await transporter.sendMail(adminMailOptions);
      console.log('Admin notification sent to: iyonicorp@gmail.com');
    } catch (emailError) {
      console.error('Error sending email:', emailError);
    }

    eventBus.emit('admin', 'booking:created', { booking });

    res.status(201).json({
      success: true,
      message: 'Booking confirmed successfully!',
      bookingId: booking.booking_uuid
    });

  } catch (error) {
    console.error('Error processing booking:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing booking. Please try again.'
    });
  }
});

app.get('/api/bookings', requireAuth, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  try {
    const result = await pool.query('SELECT * FROM bookings ORDER BY timestamp DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Error fetching bookings' });
  }
});

// ============================================================================
// HERO VIDEO ROUTE (existing, preserved)
// ============================================================================

app.get('/api/hero-video', (req, res) => {
  const videoHtml = `
    <video autoplay muted loop playsinline class="hero-video">
      <source src="3196220-uhd_3840_2160_25fps.mp4" type="video/mp4">
    </video>
  `;
  res.send(videoHtml);
});

// ============================================================================
// USER PROFILE ROUTES
// ============================================================================

app.get('/api/users/:uuid', requireAuth, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  try {
    const result = await pool.query(
      'SELECT user_uuid, first_name, last_name, email, phone, membership_status, profile_picture, assigned_workout_plan_id, workout_plan_completed, coach_uuid, join_date, last_active FROM users WHERE user_uuid = $1',
      [req.params.uuid]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Error fetching user' });
  }
});

app.patch('/api/users/:uuid', requireAuth, async (req, res) => {
  if (req.params.uuid !== req.user.user_uuid && !req.user.isAdmin) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });

  const { first_name, last_name, phone, password, profile_picture } = req.body;
  try {
    const updates = [];
    const values = [];
    let idx = 1;

    if (first_name) { updates.push(`first_name = $${idx++}`); values.push(first_name); }
    if (last_name)  { updates.push(`last_name = $${idx++}`);  values.push(last_name); }
    if (phone)      { updates.push(`phone = $${idx++}`);      values.push(phone); }
    if (profile_picture) { updates.push(`profile_picture = $${idx++}`); values.push(profile_picture); }
    if (password) {
      const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
      const hashed = await bcrypt.hash(password, saltRounds);
      updates.push(`password_hash = $${idx++}`);
      values.push(hashed);
    }

    if (updates.length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });

    values.push(req.params.uuid);
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE user_uuid = $${idx} RETURNING user_uuid, first_name, last_name, email, phone, membership_status, profile_picture, join_date, last_active`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

    eventBus.emit(req.params.uuid, 'user:updated', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Error updating user' });
  }
});

// ============================================================================
// DASHBOARD (BATCHED ENDPOINT)
// ============================================================================

app.get('/api/dashboard/:uuid', requireAuth, async (req, res) => {
  if (req.params.uuid !== req.user.user_uuid && !req.user.isAdmin) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });

  const { uuid } = req.params;

  try {
    const [userRes, goalsRes, workoutsRes, nutritionRes] = await Promise.all([
      pool.query(
        'SELECT user_uuid, first_name, last_name, email, phone, membership_status, profile_picture, assigned_workout_plan_id, workout_plan_completed, coach_uuid, join_date, last_active FROM users WHERE user_uuid = $1',
        [uuid]
      ),
      pool.query(
        'SELECT id, goal_name, target_value, current_progress, status, created_at FROM fitness_goals WHERE user_uuid = $1 ORDER BY created_at DESC',
        [uuid]
      ),
      pool.query(
        'SELECT id, workout_type, workout_date, duration_minutes, calories_burned FROM workouts WHERE user_uuid = $1 ORDER BY workout_date DESC',
        [uuid]
      ),
      pool.query(
        "SELECT id, meal_type, meal_name, calories, log_date FROM nutrition_logs WHERE user_uuid = $1 AND log_date >= CURRENT_DATE - INTERVAL '1 day' ORDER BY log_date DESC, created_at DESC",
        [uuid]
      ),
    ]);

    const user = userRes.rows[0];
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Fetch assigned coach if any
    let coachObj = null;
    if (user.coach_uuid) {
      try {
        const coachRes = await pool.query(
          'SELECT coach_uuid, first_name, last_name, email, phone, specialty, profile_picture FROM coaches WHERE coach_uuid = $1',
          [user.coach_uuid]
        );
        coachObj = coachRes.rows[0] || null;
      } catch (e) {
        console.warn('Coach lookup failed:', e.message);
      }
    }

    // Fetch assigned workout plan if any
    let planObj = null;
    if (user.assigned_workout_plan_id) {
      try {
        const planRes = await pool.query(
          'SELECT id, plan_uuid, plan_name, description, difficulty, exercises, is_mandatory FROM workout_plans WHERE id = $1',
          [user.assigned_workout_plan_id]
        );
        planObj = planRes.rows[0] || null;
        if (planObj && typeof planObj.exercises === 'string') {
          planObj.exercises = JSON.parse(planObj.exercises);
        }
      } catch (e) {
        console.warn('Plan lookup failed:', e.message);
      }
    }

    // Weekly activity aggregation (last 7 days)
    const weekRes = await pool.query(
      `SELECT TO_CHAR(workout_date, 'Dy') AS day,
              COALESCE(SUM(calories_burned), 0) AS calories,
              COALESCE(SUM(duration_minutes), 0) AS minutes
       FROM workouts
       WHERE user_uuid = $1 AND workout_date >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY workout_date
       ORDER BY workout_date ASC`,
      [uuid]
    );

    const summary = {
      calories_burned_today: weekRes.rows.length > 0 ? weekRes.rows[weekRes.rows.length - 1].calories : 0,
      calories_burned_week: weekRes.rows.reduce((sum, r) => sum + parseInt(r.calories || 0), 0),
      calories_burned_weekly_target: 3500,
      active_minutes_today: weekRes.rows.length > 0 ? weekRes.rows[weekRes.rows.length - 1].minutes : 0,
      workouts_this_week: Math.max(weekRes.rows.length, 0),
      steps_today: 8420,
      daily_step_goal: 10000,
    };

    // Pad weekly array to 7 days if needed (client fills missing days)
    const weeklyActivity = weekRes.rows.map(r => ({
      day: r.day,
      calories: parseInt(r.calories || 0),
      minutes: parseInt(r.minutes || 0),
    }));

    res.json({
      user,
      summary,
      weeklyActivity,
      goals: goalsRes.rows,
      workouts: workoutsRes.rows,
      nutrition: nutritionRes.rows,
      workout_plan: planObj,
      coach: coachObj,
    });
  } catch (error) {
    console.error('Dashboard fetch error:', error);
    res.status(500).json({ success: false, message: 'Failed to load dashboard' });
  }
});

// ============================================================================
// ADMIN: User Management & Progress Dashboard
// ============================================================================
// These endpoints require admin privileges.

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
}

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  try {
    const result = await pool.query(
      `SELECT u.user_uuid, u.first_name, u.last_name, u.email, u.phone, u.membership_status, u.profile_picture,
         u.assigned_workout_plan_id, u.workout_plan_completed, u.coach_uuid, u.join_date, u.last_active,
         c.first_name AS coach_first_name, c.last_name AS coach_last_name
       FROM users u LEFT JOIN coaches c ON c.coach_uuid = u.coach_uuid ORDER BY u.join_date DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Error fetching users' });
  }
});

app.get('/api/admin/users/:uuid/progress', requireAuth, requireAdmin, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  const { uuid } = req.params;

  try {
    const [userRes, goalsRes, workoutsRes, nutritionRes] = await Promise.all([
      pool.query(
        'SELECT user_uuid, first_name, last_name, email, phone, membership_status, profile_picture, assigned_workout_plan_id, workout_plan_completed, join_date, last_active FROM users WHERE user_uuid = $1',
        [uuid]
      ),
      pool.query(
        'SELECT id, goal_name, target_value, current_progress, status, created_at FROM fitness_goals WHERE user_uuid = $1 ORDER BY created_at DESC',
        [uuid]
      ),
      pool.query(
        'SELECT id, workout_type, workout_date, duration_minutes, calories_burned FROM workouts WHERE user_uuid = $1 ORDER BY workout_date DESC',
        [uuid]
      ),
      pool.query(
        'SELECT id, meal_type, meal_name, calories, log_date FROM nutrition_logs WHERE user_uuid = $1 ORDER BY log_date DESC, created_at DESC',
        [uuid]
      ),
    ]);

    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = userRes.rows[0];

    // Fetch assigned coach if any
    let coachObj = null;
    if (user.coach_uuid) {
      try {
        const coachRes = await pool.query(
          'SELECT coach_uuid, first_name, last_name, email, phone, specialty FROM coaches WHERE coach_uuid = $1',
          [user.coach_uuid]
        );
        coachObj = coachRes.rows[0] || null;
      } catch (e) {
        console.warn('Coach lookup failed:', e.message);
      }
    }

    // Fetch assigned workout plan if any
    let planObj = null;
    if (user.assigned_workout_plan_id) {
      try {
        const planRes = await pool.query(
          'SELECT id, plan_uuid, plan_name, description, difficulty, exercises, is_mandatory FROM workout_plans WHERE id = $1',
          [user.assigned_workout_plan_id]
        );
        planObj = planRes.rows[0] || null;
        if (planObj && typeof planObj.exercises === 'string') {
          planObj.exercises = JSON.parse(planObj.exercises);
        }
      } catch (e) {
        console.warn('Plan lookup failed:', e.message);
      }
    }
    const totalCaloriesBurned = workoutsRes.rows.reduce((sum, w) => sum + (parseInt(w.calories_burned) || 0), 0);
    const totalCaloriesConsumed = nutritionRes.rows.reduce((sum, n) => sum + (parseInt(n.calories) || 0), 0);
    const totalGoals = goalsRes.rows.length;
    const completedGoals = goalsRes.rows.filter(g => g.status === 'completed').length;

    // Weekly activity
    const weekRes = await pool.query(
      `SELECT workout_date,
              COALESCE(SUM(calories_burned), 0) AS calories,
              COALESCE(SUM(duration_minutes), 0) AS minutes
       FROM workouts
       WHERE user_uuid = $1 AND workout_date >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY workout_date
       ORDER BY workout_date ASC`,
      [uuid]
    );

    res.json({
      user,
      summary: {
        total_workouts: workoutsRes.rows.length,
        total_calories_burned: totalCaloriesBurned,
        total_calories_consumed: totalCaloriesConsumed,
        total_goals: totalGoals,
        completed_goals: completedGoals,
        active_goals: goalsRes.rows.filter(g => g.status === 'active').length,
        progress_percentage: totalGoals > 0 ? Math.round((completedGoals / totalGoals) * 100) : 0
      },
      weeklyActivity: weekRes.rows.map(r => ({
        day: new Date(r.workout_date).toLocaleDateString('en-US', { weekday: 'short' }),
        calories: parseInt(r.calories || 0),
        minutes: parseInt(r.minutes || 0)
      })),
        goals: goalsRes.rows,
        workouts: workoutsRes.rows,
        nutrition: nutritionRes.rows,
        workout_plan: planObj,
        coach: coachObj,
      });
  } catch (error) {
    console.error('Error fetching user progress:', error);
    res.status(500).json({ error: 'Error fetching user progress' });
  }
});

// ============================================================================
// ADMIN: Coach Management
// ============================================================================
// These endpoints allow admins to create, list, and manage coaches.

app.get('/api/admin/coaches', requireAuth, requireAdmin, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  try {
    const result = await pool.query(
      `SELECT c.coach_uuid, c.first_name, c.last_name, c.email, c.phone, c.specialty, c.status, c.profile_picture, c.created_at, c.updated_at,
          COUNT(u.user_uuid)::int AS client_count
        FROM coaches c LEFT JOIN users u ON u.coach_uuid = c.coach_uuid
        GROUP BY c.coach_uuid, c.first_name, c.last_name, c.email, c.phone, c.specialty, c.status, c.profile_picture, c.created_at, c.updated_at
        ORDER BY c.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching coaches:', error);
    res.status(500).json({ error: 'Error fetching coaches' });
  }
});

app.post('/api/admin/coaches', requireAuth, requireAdmin, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  const { firstName, lastName, email, password, phone, specialty } = req.body;
  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ success: false, message: 'firstName, lastName, email, and password are required' });
  }
  try {
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
    const password_hash = await bcrypt.hash(password, saltRounds);

    const result = await pool.query(
       `INSERT INTO coaches (first_name, last_name, email, phone, password_hash, specialty, temp_password, force_password_change)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE, TRUE)
        RETURNING coach_uuid, first_name, last_name, email, phone, specialty, status, temp_password, created_at`,
      [firstName, lastName, email, phone, password_hash, specialty || 'General Fitness']
    );

    const coach = result.rows[0];

    // TODO: Send welcome email with credentials to the coach
    const welcomeTemplate = `
      <h2>Welcome to HitRepublic, ${coach.first_name}!</h2>
      <p>Your coach account has been created.</p>
      <div style="background:#f5f5f5;padding:20px;margin:20px 0;border-radius:5px;">
        <p><strong>Email:</strong> ${coach.email}</p>
        <p><strong>Temporary Password:</strong> ${password}</p>
        <p><strong>Specialty:</strong> ${coach.specialty}</p>
      </div>
      <p>Please log in to the admin dashboard using your email and the password above. You can change your password after first login.</p>
      <p>Best regards,<br>HitRepublic Admin Team</p>
    `;

    try {
      await transporter.sendMail({
        from: process.env.EMAIL_USER || 'noreply@hitrepublic.fitness',
        to: coach.email,
        subject: 'Welcome to HitRepublic — Coach Account Created',
        html: welcomeTemplate
      });
    } catch (emailError) {
      console.error('Error sending welcome email to coach:', emailError);
    }

    eventBus.emit('admin', 'coach:created', { coach: { ...coach, password } });
    res.status(201).json({ success: true, coach });
   } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'Email already registered as a coach' });
    }
    console.error('Error creating coach:', error.message || error);
    res.status(500).json({ success: false, message: 'Failed to create coach', error: error.message });
  }
});

app.patch('/api/admin/coaches/:uuid', requireAuth, requireAdmin, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  const { uuid } = req.params;
  const { status, specialty, phone, password } = req.body;
  try {
    const updates = [];
    const values = [];
    let idx = 1;

    if (status) { updates.push(`status = $${idx++}`); values.push(status); }
    if (specialty) { updates.push(`specialty = $${idx++}`); values.push(specialty); }
     if (phone) { updates.push(`phone = $${idx++}`); values.push(phone); }
     if (password) {
       const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
       const hashed = await bcrypt.hash(password, saltRounds);
       updates.push(`password_hash = $${idx++}`);
       values.push(hashed);
       updates.push(`temp_password = FALSE`);
       updates.push(`force_password_change = FALSE`);
     }
     updates.push(`updated_at = NOW()`);
     if (updates.length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });
     const result = await pool.query(
       `UPDATE coaches SET ${updates.join(', ')} WHERE coach_uuid = $${idx}
        RETURNING coach_uuid, first_name, last_name, email, phone, specialty, status, created_at, updated_at`,
      [...values, uuid]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Coach not found' });

    eventBus.emit('admin', 'coach:updated', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating coach:', error);
    res.status(500).json({ error: 'Error updating coach' });
  }
});

app.put('/api/admin/coaches/:uuid/clients', requireAuth, requireAdmin, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  const { uuid } = req.params;
  const clientUuids = Array.isArray(req.body.clientUuids) ? req.body.clientUuids : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const coachResult = await client.query('SELECT coach_uuid FROM coaches WHERE coach_uuid = $1', [uuid]);
    if (coachResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Coach not found' });
    }
    await client.query('UPDATE users SET coach_uuid = NULL WHERE coach_uuid = $1', [uuid]);
    if (clientUuids.length > 0) {
      await client.query('UPDATE users SET coach_uuid = $1 WHERE user_uuid = ANY($2::uuid[])', [uuid, clientUuids]);
    }
    await client.query('COMMIT');
    eventBus.emit('admin', 'coach:clients_updated', { coach_uuid: uuid, clientUuids });
    res.json({ success: true, coach_uuid: uuid, clientUuids });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error assigning coach clients:', error);
    res.status(500).json({ success: false, message: 'Failed to assign clients' });
  } finally {
    client.release();
  }
});

// Coach: Change password (first login password change)
app.put('/api/coaches/change-password', requireAuth, async (req, res) => {
  if (!req.user.isCoach) return res.status(403).json({ success: false, message: 'Coach access required' });
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
  }
  try {
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
    const password_hash = await bcrypt.hash(password, saltRounds);
    await pool.query(
      'UPDATE coaches SET password_hash = $1, temp_password = FALSE, force_password_change = FALSE, updated_at = NOW() WHERE coach_uuid = $2',
      [password_hash, req.user.coach_uuid]
    );
    eventBus.emit(req.user.coach_uuid, 'coach:password_changed', { coach_uuid: req.user.coach_uuid });
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Error changing coach password:', error);
    res.status(500).json({ success: false, message: 'Failed to update password' });
  }
});

// Coach: Get assigned clients
app.get('/api/coaches/clients', requireAuth, async (req, res) => {
  if (!req.user.isCoach) return res.status(403).json({ success: false, message: 'Coach access required' });
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  try {
     const result = await pool.query(
       `SELECT u.user_uuid, u.first_name, u.last_name, u.email, u.phone, u.membership_status,
               u.profile_picture, u.assigned_workout_plan_id, u.workout_plan_completed, u.last_active, u.join_date
        FROM users u
        WHERE u.coach_uuid = $1
        ORDER BY u.join_date DESC`,
       [req.user.coach_uuid]
     );
     res.json(result.rows);
   } catch (error) {
     console.error('Error fetching coach clients:', error);
     res.status(500).json({ error: 'Error fetching clients' });
   }
});

// Coach: Get own profile
app.get('/api/coaches/me', requireAuth, async (req, res) => {
  if (!req.user.isCoach) return res.status(403).json({ success: false, message: 'Coach access required' });
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  try {
    const result = await pool.query(
       'SELECT coach_uuid, first_name, last_name, email, phone, specialty, status, temp_password, force_password_change, profile_picture, created_at, updated_at FROM coaches WHERE coach_uuid = $1',
      [req.user.coach_uuid]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Coach not found' });
    res.json({ success: true, coach: result.rows[0] });
  } catch (error) {
    console.error('Error fetching coach profile:', error);
     res.status(500).json({ error: 'Error fetching coach profile' });
   }
});

// Coach: Update own profile
app.patch('/api/coaches/me', requireAuth, async (req, res) => {
   if (!req.user.isCoach) return res.status(403).json({ success: false, message: 'Coach access required' });
   if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
   const { first_name, last_name, phone, specialty, profile_picture } = req.body;
   try {
      const updates = [];
      const values = [];
      let idx = 1;

      if (first_name !== undefined && first_name !== null) { updates.push(`first_name = $${idx++}`); values.push(first_name); }
      if (last_name !== undefined && last_name !== null) { updates.push(`last_name = $${idx++}`); values.push(last_name); }
      if (phone !== undefined && phone !== null) { updates.push(`phone = $${idx++}`); values.push(phone); }
      if (specialty !== undefined && specialty !== null) { updates.push(`specialty = $${idx++}`); values.push(specialty); }
      if (profile_picture !== undefined && profile_picture !== null) { updates.push(`profile_picture = $${idx++}`); values.push(profile_picture); }

      if (updates.length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });

      updates.push(`updated_at = NOW()`);
      const result = await pool.query(
         `UPDATE coaches SET ${updates.join(', ')} WHERE coach_uuid = $${idx}
          RETURNING coach_uuid, first_name, last_name, email, phone, specialty, status, profile_picture, created_at, updated_at`,
         [...values, req.user.coach_uuid]
      );
      if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Coach not found' });

      eventBus.emit(req.user.coach_uuid, 'coach:profile_updated', result.rows[0]);
      res.json({ success: true, coach: result.rows[0] });
   } catch (error) {
      console.error('Error updating coach profile:', error);
      res.status(500).json({ error: 'Error updating coach profile' });
   }
});
function generateTempPassword() {
  return crypto.randomBytes(4).toString('base64url').slice(0, 10).replace(/[_-]/g, 'a') + Math.floor(100 + Math.random() * 900);
}

// Coach: Create a client account with a temporary password
app.post('/api/coaches/clients', requireAuth, async (req, res) => {
  if (!req.user.isCoach) return res.status(403).json({ success: false, message: 'Coach access required' });
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });

  const { firstName, lastName, email, phone, password: providedPassword, send_email } = req.body;
  if (!firstName || !lastName || !email) {
    return res.status(400).json({ success: false, message: 'firstName, lastName, and email are required' });
  }

  try {
    const tempPassword = providedPassword || generateTempPassword();
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
    const password_hash = await bcrypt.hash(tempPassword, saltRounds);

    const result = await pool.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, membership_status, coach_uuid)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING user_uuid, first_name, last_name, email, phone, membership_status, join_date`,
      [firstName, lastName, email, phone || null, password_hash, 'basic', req.user.coach_uuid]
    );

    const user = result.rows[0];

    // Send welcome email with temporary password (unless explicitly opted out)
    if (send_email !== false) {
      try {
        const coachRes = await pool.query(
          'SELECT first_name, last_name FROM coaches WHERE coach_uuid = $1',
          [req.user.coach_uuid]
        );
        const coachName = coachRes.rows[0] ? `${coachRes.rows[0].first_name} ${coachRes.rows[0].last_name}` : 'Your coach';

        await transporter.sendMail({
          from: process.env.EMAIL_USER || 'noreply@hitrepublic.fitness',
          to: user.email,
          subject: 'Welcome to HitRepublic � Account Created by Your Coach',
          html: `
            <h2>Welcome to HitRepublic!</h2>
            <p>Your account has been created by ${coachName}.</p>
            <div style="background:#f5f5f5;padding:20px;margin:20px 0;border-radius:5px;">
              <p><strong>Email:</strong> ${user.email}</p>
              <p><strong>Temporary Password:</strong> ${tempPassword}</p>
            </div>
            <p>Please log in using your email and the temporary password above. You will be prompted to change your password after first login.</p>
            <p>Best regards,<br>HitRepublic Team</p>
          `
        });
      } catch (emailError) {
        console.error('Error sending welcome email to client:', emailError);
      }
    }

    eventBus.emit('coach', 'client:created', { coach_uuid: req.user.coach_uuid, user });
    res.status(201).json({ success: true, user, tempPassword });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }
    console.error('Error creating client:', error.message || error);
    res.status(500).json({ success: false, message: 'Failed to create client', error: error.message });
  }
});

// Coach: Get available workout plans
app.get('/api/coaches/workout-plans', requireAuth, async (req, res) => {
  if (!req.user.isCoach) return res.status(403).json({ success: false, message: 'Coach access required' });
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  try {
    const result = await pool.query(
      `SELECT wp.id, wp.plan_uuid, wp.plan_name, wp.description, wp.difficulty, wp.exercises, wp.is_mandatory, wp.created_at,
              c.first_name, c.last_name
       FROM workout_plans wp
       LEFT JOIN coaches c ON wp.created_by = c.coach_uuid
       ORDER BY wp.created_at DESC`
    );
    const plans = result.rows.map(row => ({
      ...row,
      id: String(row.id),
      exercises: typeof row.exercises === 'string' ? JSON.parse(row.exercises) : row.exercises
    }));
    res.json(plans);
  } catch (error) {
    console.error('Error fetching workout plans for coach:', error);
     res.status(500).json({ error: 'Error fetching workout plans' });
   }
});

// Coach: Create a workout plan
app.post('/api/coaches/workout-plans', requireAuth, async (req, res) => {
   if (!req.user.isCoach) return res.status(403).json({ success: false, message: 'Coach access required' });
   if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
   const { plan_name, description, difficulty, exercises, is_mandatory } = req.body;
   if (!plan_name) return res.status(400).json({ success: false, message: 'plan_name is required' });
   if (!exercises || !Array.isArray(exercises) || exercises.length === 0) {
     return res.status(400).json({ success: false, message: 'At least one exercise is required' });
   }
   try {
     const plan_uuid = 'plan_' + Date.now().toString();
     const result = await pool.query(
       `INSERT INTO workout_plans (plan_uuid, plan_name, description, difficulty, exercises, created_by, is_mandatory)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, plan_uuid, plan_name, description, difficulty, exercises, is_mandatory, created_at`,
       [plan_uuid, plan_name, description, difficulty || 'intermediate', JSON.stringify(exercises), req.user.coach_uuid, is_mandatory || false]
     );
     const plan = result.rows[0];
     plan.exercises = typeof plan.exercises === 'string' ? JSON.parse(plan.exercises) : plan.exercises;
     eventBus.emit('admin', 'workoutplan:created', plan);
     res.status(201).json({ success: true, plan });
   } catch (error) {
      console.error('Error creating workout plan by coach:', error);
      res.status(500).json({ success: false, message: 'Failed to create workout plan' });
   }
});

// Coach: Assign a workout plan to one of their clients
app.post('/api/coaches/clients/:uuid/assign-workout-plan', requireAuth, async (req, res) => {
  if (!req.user.isCoach) return res.status(403).json({ success: false, message: 'Coach access required' });
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  const { uuid } = req.params;
  const { plan_id, is_mandatory } = req.body;
  try {
    const clientCheck = await pool.query(
      'SELECT user_uuid FROM users WHERE user_uuid = $1 AND coach_uuid = $2',
      [uuid, req.user.coach_uuid]
    );
    if (clientCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    if (plan_id !== null && plan_id !== undefined) {
      const planCheck = await pool.query('SELECT id FROM workout_plans WHERE id = $1', [plan_id]);
      if (planCheck.rows.length === 0) return res.status(404).json({ success: false, message: 'Workout plan not found' });
    }

    const result = await pool.query(
      `UPDATE users SET assigned_workout_plan_id = $1, workout_plan_completed = FALSE WHERE user_uuid = $2
       RETURNING user_uuid, first_name, last_name, email, assigned_workout_plan_id, workout_plan_completed`,
      [plan_id, uuid]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

    eventBus.emit(uuid, plan_id === null ? 'workout:plan_unassigned' : 'workout:plan_assigned', { plan_id, is_mandatory, coach_uuid: req.user.coach_uuid });
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('Error assigning workout plan by coach:', error);
    res.status(500).json({ error: 'Error assigning workout plan' });
  }
});

// Coach: Get a single client's progress data
app.get('/api/coaches/clients/:uuid/progress', requireAuth, async (req, res) => {
  if (!req.user.isCoach) return res.status(403).json({ success: false, message: 'Coach access required' });
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  const { uuid } = req.params;

  try {
    // Security: ensure this client actually belongs to the requesting coach
    const clientCheck = await pool.query(
      'SELECT user_uuid FROM users WHERE user_uuid = $1 AND coach_uuid = $2',
      [uuid, req.user.coach_uuid]
    );
    if (clientCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    const [userRes, goalsRes, workoutsRes, nutritionRes] = await Promise.all([
      pool.query(
        'SELECT user_uuid, first_name, last_name, email, phone, membership_status, profile_picture, assigned_workout_plan_id, workout_plan_completed, join_date, last_active FROM users WHERE user_uuid = $1',
        [uuid]
      ),
      pool.query(
        'SELECT id, goal_name, target_value, current_progress, status, created_at FROM fitness_goals WHERE user_uuid = $1 ORDER BY created_at DESC',
        [uuid]
      ),
      pool.query(
        'SELECT id, workout_type, workout_date, duration_minutes, calories_burned FROM workouts WHERE user_uuid = $1 ORDER BY workout_date DESC',
        [uuid]
      ),
      pool.query(
        'SELECT id, meal_type, meal_name, calories, log_date FROM nutrition_logs WHERE user_uuid = $1 ORDER BY log_date DESC, created_at DESC',
        [uuid]
      ),
    ]);

    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = userRes.rows[0];

    // Fetch assigned workout plan if any
    let planObj = null;
    if (user.assigned_workout_plan_id) {
      try {
        const planRes = await pool.query(
          'SELECT id, plan_uuid, plan_name, description, difficulty, exercises, is_mandatory FROM workout_plans WHERE id = $1',
          [user.assigned_workout_plan_id]
        );
        planObj = planRes.rows[0] || null;
        if (planObj && typeof planObj.exercises === 'string') {
          planObj.exercises = JSON.parse(planObj.exercises);
        }
      } catch (e) {
        console.warn('Plan lookup failed:', e.message);
      }
    }

    const totalCaloriesBurned = workoutsRes.rows.reduce((sum, w) => sum + (parseInt(w.calories_burned) || 0), 0);
    const totalCaloriesConsumed = nutritionRes.rows.reduce((sum, n) => sum + (parseInt(n.calories) || 0), 0);
    const totalGoals = goalsRes.rows.length;
    const completedGoals = goalsRes.rows.filter(g => g.status === 'completed').length;

    // Weekly activity (last 7 days)
    const weekRes = await pool.query(
      `SELECT workout_date,
              COALESCE(SUM(calories_burned), 0) AS calories,
              COALESCE(SUM(duration_minutes), 0) AS minutes
       FROM workouts
       WHERE user_uuid = $1 AND workout_date >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY workout_date
       ORDER BY workout_date ASC`,
      [uuid]
    );

    res.json({
      success: true,
      user,
      summary: {
        total_workouts: workoutsRes.rows.length,
        total_calories_burned: totalCaloriesBurned,
        total_calories_consumed: totalCaloriesConsumed,
        total_goals: totalGoals,
        completed_goals: completedGoals,
        active_goals: goalsRes.rows.filter(g => g.status === 'active').length,
        progress_percentage: totalGoals > 0 ? Math.round((completedGoals / totalGoals) * 100) : 0
      },
      weeklyActivity: weekRes.rows.map(r => ({
        day: new Date(r.workout_date).toLocaleDateString('en-US', { weekday: 'short' }),
        calories: parseInt(r.calories || 0),
        minutes: parseInt(r.minutes || 0)
      })),
      goals: goalsRes.rows,
      workouts: workoutsRes.rows,
      nutrition: nutritionRes.rows,
      workout_plan: planObj,
    });
  } catch (error) {
    console.error('Error fetching coach client progress:', error);
    res.status(500).json({ error: 'Error fetching client progress' });
  }
});

// ============================================================================
// ============================================================================
// WORKOUT LIBRARY (Exercise Catalog)
// ============================================================================
const DEFAULT_EXERCISE_LIBRARY = [
  { name: 'Push-ups', category: 'Chest', description: 'Standard push-up, hands shoulder-width apart', default_sets: 3, default_reps: '10-15' },
  { name: 'Squats', category: 'Legs', description: 'Bodyweight squat, feet shoulder-width apart', default_sets: 3, default_reps: '12-15' },
  { name: 'Pull-ups', category: 'Back', description: 'Overhand grip pull-up', default_sets: 3, default_reps: '5-8' },
  { name: 'Deadlifts', category: 'Legs', description: 'Barbell deadlift', default_sets: 4, default_reps: '8-10' },
  { name: 'Bench Press', category: 'Chest', description: 'Barbell bench press', default_sets: 4, default_reps: '8-12' },
  { name: 'Plank', category: 'Core', description: 'Forearm plank hold', default_sets: 3, default_reps: '30-60s' },
  { name: 'Lunges', category: 'Legs', description: 'Walking or stationary lunges', default_sets: 3, default_reps: '10 each leg' },
  { name: 'Burpees', category: 'Cardio', description: 'Full-body burpee', default_sets: 3, default_reps: '8-10' },
  { name: 'Mountain Climbers', category: 'Core', description: 'Dynamic mountain climbers', default_sets: 3, default_reps: '30s' },
  { name: 'Bicep Curls', category: 'Arms', description: 'Dumbbell bicep curl', default_sets: 3, default_reps: '12' },
  { name: 'Tricep Dips', category: 'Arms', description: 'Parallel bar or bench dip', default_sets: 3, default_reps: '8-12' },
  { name: 'Russian Twists', category: 'Core', description: 'Floor Russian twists with weight', default_sets: 3, default_reps: '20' },
  { name: 'Leg Raises', category: 'Core', description: 'Hanging or floor leg raises', default_sets: 3, default_reps: '15' },
  { name: 'Crunches', category: 'Core', description: 'Standard abdominal crunch', default_sets: 3, default_reps: '15-20' },
  { name: 'Jump Squats', category: 'Legs', description: 'Explosive jump squat', default_sets: 3, default_reps: '8-10' },
  { name: 'Dumbbell Rows', category: 'Back', description: 'Bent-over dumbbell row', default_sets: 4, default_reps: '10' },
  { name: 'Overhead Press', category: 'Shoulders', description: 'Standing overhead press', default_sets: 4, default_reps: '8-10' },
  { name: 'Calf Raises', category: 'Legs', description: 'Standing calf raise', default_sets: 3, default_reps: '15-20' },
  { name: 'Lat Pulldowns', category: 'Back', description: 'Machine lat pulldown', default_sets: 3, default_reps: '10-12' },
  { name: 'Leg Press', category: 'Legs', description: 'Machine leg press', default_sets: 4, default_reps: '10-15' }
];

// Seed exercise library into PostgreSQL if not exists
async function seedExerciseLibrary() {
  if (!dbConnected) return;
  try {
    const countRes = await pool.query('SELECT COUNT(*) FROM exercise_library');
    if (parseInt(countRes.rows[0].count) === 0) {
      for (const ex of DEFAULT_EXERCISE_LIBRARY) {
        await pool.query(
          'INSERT INTO exercise_library (name, category, description, default_sets, default_reps) VALUES ($1, $2, $3, $4, $5)',
          [ex.name, ex.category, ex.description, ex.default_sets, ex.default_reps]
        );
      }
      console.log('Seeded exercise library with ' + DEFAULT_EXERCISE_LIBRARY.length + ' exercises');
    }
  } catch (err) {
    console.warn('Exercise library seed failed:', err.message);
  }
}

app.get('/api/admin/exercises', requireAuth, requireAdmin, async (req, res) => {
  if (!dbConnected) {
    return res.json(DEFAULT_EXERCISE_LIBRARY);
  }
  try {
    const result = await pool.query('SELECT * FROM exercise_library ORDER BY category, name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching exercise library:', error);
    // Fallback: return default library if table doesn't exist yet
    if (error.code === '42P01' || error.message.includes('undefined_table') || error.message.includes('does not exist')) {
      return res.json(DEFAULT_EXERCISE_LIBRARY);
    }
    res.status(500).json({ error: 'Error fetching exercises' });
  }
});

app.get('/api/coaches/exercises', requireAuth, async (req, res) => {
    if (req.user && (req.user.isCoach || req.user.isAdmin)) {
        if (!dbConnected) {
            return res.json(DEFAULT_EXERCISE_LIBRARY);
        }
        try {
            const result = await pool.query('SELECT * FROM exercise_library ORDER BY category, name');
            return res.json(result.rows);
        } catch (error) {
            console.error('Error fetching exercise library:', error);
            if (error.code === '42P01' || error.message.includes('does not exist')) {
                return res.json(DEFAULT_EXERCISE_LIBRARY);
            }
            return res.status(500).json({ error: 'Error fetching exercises' });
        }
    }
    return res.status(403).json({ error: 'Unauthorized: coaches or admins only' });
});

// ============================================================================
// WORKOUT PLANS (Admin CRUD + Assignment)
// ============================================================================

app.get('/api/admin/workout-plans', requireAuth, requireAdmin, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  try {
    const result = await pool.query(
      `SELECT wp.id, wp.plan_uuid, wp.plan_name, wp.description, wp.difficulty, wp.exercises, wp.is_mandatory, wp.created_at, wp.updated_at,
              c.first_name, c.last_name
       FROM workout_plans wp
       LEFT JOIN coaches c ON wp.created_by = c.coach_uuid
       ORDER BY wp.created_at DESC`
    );
    const plans = result.rows.map(row => ({
      ...row,
      id: String(row.id),
      exercises: typeof row.exercises === 'string' ? JSON.parse(row.exercises) : row.exercises
    }));
    res.json(plans);
  } catch (error) {
    console.error('Error fetching workout plans:', error);
    res.status(500).json({ error: 'Error fetching workout plans' });
  }
});

app.post('/api/admin/workout-plans', requireAuth, requireAdmin, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  const { plan_name, description, difficulty, exercises, is_mandatory } = req.body;
  if (!plan_name) return res.status(400).json({ success: false, message: 'plan_name is required' });
  if (!exercises || !Array.isArray(exercises) || exercises.length === 0) {
    return res.status(400).json({ success: false, message: 'At least one exercise is required' });
  }
  try {
    const plan_uuid = 'plan_' + Date.now().toString();
    const result = await pool.query(
      `INSERT INTO workout_plans (plan_uuid, plan_name, description, difficulty, exercises, is_mandatory)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, plan_uuid, plan_name, description, difficulty, exercises, is_mandatory, created_at`,
      [plan_uuid, plan_name, description, difficulty || 'intermediate', JSON.stringify(exercises), is_mandatory || false]
    );
    const plan = result.rows[0];
    plan.exercises = typeof plan.exercises === 'string' ? JSON.parse(plan.exercises) : plan.exercises;
    eventBus.emit('admin', 'workoutplan:created', plan);
    res.status(201).json({ success: true, plan });
  } catch (error) {
    console.error('Error creating workout plan:', error);
    res.status(500).json({ success: false, message: 'Failed to create workout plan' });
  }
});

app.patch('/api/admin/workout-plans/:id', requireAuth, requireAdmin, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  const { id } = req.params;
  const { plan_name, description, difficulty, exercises, is_mandatory } = req.body;
  try {
    const updates = [];
    const values = [];
    let idx = 1;
    if (plan_name) { updates.push(`plan_name = $${idx++}`); values.push(plan_name); }
    if (description) { updates.push(`description = $${idx++}`); values.push(description); }
    if (difficulty) { updates.push(`difficulty = $${idx++}`); values.push(difficulty); }
    if (exercises) { updates.push(`exercises = $${idx++}`); values.push(JSON.stringify(exercises)); }
    if (is_mandatory !== undefined) { updates.push(`is_mandatory = $${idx++}`); values.push(is_mandatory); }
    updates.push(`updated_at = NOW()`);
    if (updates.length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });

    const result = await pool.query(
      `UPDATE workout_plans SET ${updates.join(', ')} WHERE id = $${idx}
       RETURNING id, plan_uuid, plan_name, description, difficulty, exercises, is_mandatory, created_at, updated_at`,
      [...values, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Workout plan not found' });
    const plan = result.rows[0];
    plan.exercises = typeof plan.exercises === 'string' ? JSON.parse(plan.exercises) : plan.exercises;
    eventBus.emit('admin', 'workoutplan:updated', plan);
    res.json(plan);
  } catch (error) {
    console.error('Error updating workout plan:', error);
    res.status(500).json({ error: 'Error updating workout plan' });
  }
});

app.delete('/api/admin/workout-plans/:id', requireAuth, requireAdmin, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  const { id } = req.params;
  try {
    await pool.query('UPDATE users SET assigned_workout_plan_id = NULL, workout_plan_completed = FALSE WHERE assigned_workout_plan_id = $1', [id]);
    const result = await pool.query('DELETE FROM workout_plans WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Workout plan not found' });
    eventBus.emit('admin', 'workoutplan:deleted', { id });
    res.json({ success: true, id: parseInt(id) });
  } catch (error) {
    console.error('Error deleting workout plan:', error);
    res.status(500).json({ error: 'Error deleting workout plan' });
  }
});

// Assign a workout plan to a user
app.post('/api/admin/users/:uuid/assign-workout-plan', requireAuth, requireAdmin, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  const { uuid } = req.params;
  const { plan_id, is_mandatory } = req.body;
  try {
    if (plan_id !== null && plan_id !== undefined) {
      const planCheck = await pool.query('SELECT id FROM workout_plans WHERE id = $1', [plan_id]);
      if (planCheck.rows.length === 0) return res.status(404).json({ success: false, message: 'Workout plan not found' });
    }

    const result = await pool.query(
      `UPDATE users SET assigned_workout_plan_id = $1, workout_plan_completed = FALSE WHERE user_uuid = $2
       RETURNING user_uuid, first_name, last_name, email, assigned_workout_plan_id, workout_plan_completed`,
      [plan_id, uuid]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

    eventBus.emit(uuid, plan_id === null ? 'workout:plan_unassigned' : 'workout:plan_assigned', { plan_id, is_mandatory });
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('Error assigning workout plan:', error);
    res.status(500).json({ error: 'Error assigning workout plan' });
  }
});

// Mark a user's workout plan as completed
app.post('/api/users/:uuid/complete-workout-plan', requireAuth, async (req, res) => {
  if (req.params.uuid !== req.user.user_uuid && !req.user.isAdmin) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  try {
    const result = await pool.query(
      'UPDATE users SET workout_plan_completed = TRUE WHERE user_uuid = $1 RETURNING user_uuid, workout_plan_completed',
      [req.params.uuid]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });
    eventBus.emit(req.params.uuid, 'workout:plan_completed', result.rows[0]);
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('Error completing workout plan:', error);
    res.status(500).json({ error: 'Error completing workout plan' });
  }
});

app.get('/api/goals/:uuid', requireAuth, async (req, res) => {
    if (req.params.uuid !== req.user.user_uuid && !req.user.isAdmin) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });

  try {
    const result = await pool.query(
      'SELECT id, goal_name, target_value, current_progress, status, created_at FROM fitness_goals WHERE user_uuid = $1 ORDER BY created_at DESC',
      [req.params.uuid]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching goals:', error);
    res.status(500).json({ error: 'Error fetching goals' });
  }
});

app.post('/api/goals', requireAuth, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });

  const { goal_name, target_value, current_progress = 0, status = 'active' } = req.body;
  if (!goal_name) return res.status(400).json({ success: false, message: 'goal_name is required' });

  try {
    const result = await pool.query(
      `INSERT INTO fitness_goals (user_uuid, goal_name, target_value, current_progress, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.user_uuid, goal_name, target_value, current_progress, status]
    );

    const goal = result.rows[0];
    eventBus.emit(req.user.user_uuid, 'goal:created', goal);
    res.status(201).json(goal);
  } catch (error) {
    console.error('Error creating goal:', error);
    res.status(500).json({ error: 'Error creating goal' });
  }
});

app.patch('/api/goals/:id', requireAuth, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });

  const { id } = req.params;
  const { goal_name, target_value, current_progress, status } = req.body;

  try {
    const result = await pool.query(
      `UPDATE fitness_goals SET goal_name = COALESCE($1, goal_name), target_value = COALESCE($2, target_value),
       current_progress = COALESCE($3, current_progress), status = COALESCE($4, status)
       WHERE id = $5 AND user_uuid = $6 RETURNING *`,
      [goal_name, target_value, current_progress, status, id, req.user.user_uuid]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Goal not found' });

    const goal = result.rows[0];
    if (goal.current_progress >= parseInt(goal.target_value || 0) && goal.status !== 'completed') {
      await pool.query('UPDATE fitness_goals SET status = $1 WHERE id = $2', ['completed', id]);
      goal.status = 'completed';
      eventBus.emit(req.user.user_uuid, 'goal:completed', goal);
    }
    eventBus.emit(req.user.user_uuid, 'goal:updated', goal);
    res.json(goal);
  } catch (error) {
    console.error('Error updating goal:', error);
    res.status(500).json({ error: 'Error updating goal' });
  }
});

app.delete('/api/goals/:id', requireAuth, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });

  try {
    const result = await pool.query(
      'DELETE FROM fitness_goals WHERE id = $1 AND user_uuid = $2 RETURNING id',
      [req.params.id, req.user.user_uuid]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Goal not found' });

    eventBus.emit(req.user.user_uuid, 'goal:deleted', { id: req.params.id });
    res.json({ success: true, id: req.params.id });
  } catch (error) {
    console.error('Error deleting goal:', error);
    res.status(500).json({ error: 'Error deleting goal' });
  }
});

// ============================================================================
// WORKOUTS ROUTES
// ============================================================================

app.get('/api/workouts/master', requireAuth, (req, res) => {
  const { category } = req.query;
  if (category && category !== 'all') {
    return res.json(WORKOUT_LIBRARY.filter(w => w.category === category));
  }
  res.json(WORKOUT_LIBRARY);
});

app.get('/api/workouts/master/:id', requireAuth, (req, res) => {
  const workout = WORKOUT_LIBRARY.find(w => w.id === parseInt(req.params.id));
  if (!workout) return res.status(404).json({ success: false, message: 'Workout not found' });
  res.json(workout);
});

app.get('/api/workouts/:uuid', requireAuth, async (req, res) => {
  if (req.params.uuid !== req.user.user_uuid && !req.user.isAdmin) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });

  const range = req.query.range || 'week';
  let rangeClause = 'workout_date >= CURRENT_DATE - INTERVAL \'6 days\'';
  if (range === 'all') rangeClause = 'true';
  if (range === 'month') rangeClause = 'workout_date >= CURRENT_DATE - INTERVAL \'30 days\'';

  try {
    const result = await pool.query(
      `SELECT id, workout_type, workout_date, duration_minutes, calories_burned, created_at
       FROM workouts WHERE user_uuid = $1 AND ${rangeClause} ORDER BY workout_date DESC`,
      [req.params.uuid]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching workouts:', error);
    res.status(500).json({ error: 'Error fetching workouts' });
  }
});

app.post('/api/workouts', requireAuth, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });

  const { workout_type, workout_date, duration_minutes, calories_burned } = req.body;
  if (!workout_type || !workout_date) return res.status(400).json({ success: false, message: 'workout_type and workout_date are required' });

  try {
    const result = await pool.query(
      `INSERT INTO workouts (user_uuid, workout_type, workout_date, duration_minutes, calories_burned)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.user_uuid, workout_type, workout_date, duration_minutes, calories_burned]
    );

    const workout = result.rows[0];
    eventBus.emit(req.user.user_uuid, 'workout:created', workout);
    res.status(201).json(workout);
  } catch (error) {
    console.error('Error creating workout:', error);
    res.status(500).json({ error: 'Error creating workout' });
  }
});

app.patch('/api/workouts/:id', requireAuth, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });

  const { id } = req.params;
  const { workout_type, workout_date, duration_minutes, calories_burned } = req.body;

  try {
    const result = await pool.query(
      `UPDATE workouts SET workout_type = COALESCE($1, workout_type), workout_date = COALESCE($2, workout_date),
       duration_minutes = COALESCE($3, duration_minutes), calories_burned = COALESCE($4, calories_burned)
       WHERE id = $5 AND user_uuid = $6 RETURNING *`,
      [workout_type, workout_date, duration_minutes, calories_burned, id, req.user.user_uuid]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Workout not found' });

    const workout = result.rows[0];
    eventBus.emit(req.user.user_uuid, 'workout:updated', workout);
    res.json(workout);
  } catch (error) {
    console.error('Error updating workout:', error);
    res.status(500).json({ error: 'Error updating workout' });
  }
});

app.delete('/api/workouts/:id', requireAuth, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });

  try {
    const result = await pool.query(
      'DELETE FROM workouts WHERE id = $1 AND user_uuid = $2 RETURNING id',
      [req.params.id, req.user.user_uuid]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Workout not found' });

    eventBus.emit(req.user.user_uuid, 'workout:deleted', { id: req.params.id });
    res.json({ success: true, id: req.params.id });
  } catch (error) {
    console.error('Error deleting workout:', error);
    res.status(500).json({ error: 'Error deleting workout' });
  }
});

// ============================================================================
// WORKOUT SESSIONS (Timer tracking for workouts)
// ============================================================================

app.get('/api/workout-sessions', requireAuth, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  try {
    const result = await pool.query(
      `SELECT id, session_uuid, workout_type, plan_id, status, target_duration, elapsed_seconds, start_time, pause_start, end_time, created_at, updated_at
       FROM workout_sessions
       WHERE user_uuid = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.user.user_uuid]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching workout sessions:', error);
    res.status(500).json({ error: 'Error fetching workout sessions' });
  }
});

app.get('/api/workout-sessions/active', requireAuth, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  try {
    const result = await pool.query(
      `SELECT id, session_uuid, workout_type, plan_id, status, target_duration, elapsed_seconds, start_time, pause_start, end_time, created_at, updated_at
       FROM workout_sessions
       WHERE user_uuid = $1 AND status IN ('active', 'paused')
       ORDER BY created_at DESC
       LIMIT 1`,
      [req.user.user_uuid]
    );
    if (result.rows.length === 0) {
      return res.json({ active: false });
    }
    res.json({ active: true, session: result.rows[0] });
  } catch (error) {
    console.error('Error fetching active session:', error);
    res.status(500).json({ error: 'Error fetching active session' });
  }
});

app.post('/api/workout-sessions', requireAuth, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  const { workout_type, plan_id, target_duration } = req.body;
  if (!workout_type) return res.status(400).json({ success: false, message: 'workout_type is required' });
  try {
    const session_uuid = 'sess_' + Date.now().toString();
    const target = target_duration || 1800;
    const now = new Date();
    const result = await pool.query(
      `INSERT INTO workout_sessions
       (session_uuid, user_uuid, workout_type, plan_id, status, target_duration, start_time, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, NOW(), NOW())
       RETURNING id, session_uuid, workout_type, plan_id, status, target_duration, elapsed_seconds, start_time, created_at`,
      [session_uuid, req.user.user_uuid, workout_type, plan_id || null, target, now]
    );
    const session = result.rows[0];
    eventBus.emit(req.user.user_uuid, 'workout:session_started', session);
    res.status(201).json({ success: true, session });
  } catch (error) {
    console.error('Error creating workout session:', error);
    res.status(500).json({ success: false, message: 'Failed to create workout session' });
  }
});

app.patch('/api/workout-sessions/:id/pause', requireAuth, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  try {
    const now = new Date();
    const result = await pool.query(
      `UPDATE workout_sessions
       SET status = 'paused',
           elapsed_seconds = elapsed_seconds + EXTRACT(EPOCH FROM (NOW() - COALESCE(start_time, NOW())))::INTEGER,
           pause_start = NOW(),
           start_time = NULL,
           updated_at = NOW()
       WHERE id = $1 AND user_uuid = $2 AND status = 'active'
       RETURNING id, session_uuid, status, elapsed_seconds, target_duration, pause_start`,
      [req.params.id, req.user.user_uuid]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Active session not found' });
    }
    const session = result.rows[0];
    eventBus.emit(req.user.user_uuid, 'workout:session_paused', session);
    res.json({ success: true, session });
  } catch (error) {
    console.error('Error pausing workout session:', error);
    res.status(500).json({ error: 'Error pausing workout session' });
  }
});

app.patch('/api/workout-sessions/:id/resume', requireAuth, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  try {
    const result = await pool.query(
      `UPDATE workout_sessions
       SET status = 'active',
           start_time = NOW(),
           pause_start = NULL,
           updated_at = NOW()
       WHERE id = $1 AND user_uuid = $2 AND status = 'paused'
       RETURNING id, session_uuid, status, elapsed_seconds, target_duration, start_time`,
      [req.params.id, req.user.user_uuid]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Paused session not found' });
    }
    const session = result.rows[0];
    eventBus.emit(req.user.user_uuid, 'workout:session_resumed', session);
    res.json({ success: true, session });
  } catch (error) {
    console.error('Error resuming workout session:', error);
    res.status(500).json({ error: 'Error resuming workout session' });
  }
});

app.patch('/api/workout-sessions/:id/complete', requireAuth, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Calculate final elapsed time
    const sessionRes = await client.query(
      `SELECT id, user_uuid, workout_type, plan_id, target_duration, elapsed_seconds, status, start_time, pause_start
       FROM workout_sessions
       WHERE id = $1 AND user_uuid = $2 AND status IN ('active', 'paused')`,
      [id, req.user.user_uuid]
    );
    if (sessionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Active session not found' });
    }
    const session = sessionRes.rows[0];
    let totalElapsed = parseInt(session.elapsed_seconds) || 0;
    if (session.status === 'active' && session.start_time) {
      totalElapsed += Math.floor((Date.now() - new Date(session.start_time).getTime()) / 1000);
    }
    const durationMinutes = Math.ceil(totalElapsed / 60);

    // Mark session completed
    await client.query(
      `UPDATE workout_sessions
       SET status = 'completed',
           elapsed_seconds = $1,
           end_time = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [totalElapsed, session.id]
    );

    // Create a workout log entry
    await client.query(
      `INSERT INTO workouts (user_uuid, workout_type, workout_date, duration_minutes, calories_burned, created_at)
       VALUES ($1, $2, CURRENT_DATE, $3, $4, NOW())`,
      [session.user_uuid, session.workout_type, durationMinutes, req.body.calories_burned || null]
    );

    // If this session is tied to a plan, check if all plan exercises are done
    let planCompleted = false;
    if (session.plan_id) {
      // Mark the user's plan as completed
      await client.query(
        `UPDATE users SET workout_plan_completed = TRUE
         WHERE user_uuid = $1 AND assigned_workout_plan_id = $2`,
        [session.user_uuid, session.plan_id]
      );
    }

    await client.query('COMMIT');
    eventBus.emit(session.user_uuid, 'workout:session_completed', {
      session_id: session.id,
      workout_type: session.workout_type,
      duration_minutes: durationMinutes
    });
    res.json({ success: true, message: 'Workout completed and logged', duration_minutes: durationMinutes, plan_completed: planCompleted });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error completing workout session:', error);
    res.status(500).json({ success: false, message: 'Failed to complete workout session' });
  } finally {
    client.release();
  }
});

app.patch('/api/workout-sessions/:id/cancel', requireAuth, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });
  try {
    const now = new Date();
    const result = await pool.query(
      `UPDATE workout_sessions
       SET status = 'cancelled',
           elapsed_seconds = elapsed_seconds + EXTRACT(EPOCH FROM (NOW() - COALESCE(start_time, NOW())))::INTEGER,
           start_time = NULL,
           end_time = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND user_uuid = $2 AND status IN ('active', 'paused')
       RETURNING id, session_uuid, status`,
      [req.params.id, req.user.user_uuid]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Active session not found' });
    }
    const session = result.rows[0];
    eventBus.emit(req.user.user_uuid, 'workout:session_cancelled', session);
    res.json({ success: true, session });
  } catch (error) {
    console.error('Error cancelling workout session:', error);
    res.status(500).json({ error: 'Error cancelling workout session' });
  }
});

// ============================================================================
// NUTRITION ROUTES
// ============================================================================

app.get('/api/nutrition/:uuid', requireAuth, async (req, res) => {
  if (req.params.uuid !== req.user.user_uuid && !req.user.isAdmin) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });

  const range = req.query.range || 'week';
  let rangeClause = 'log_date >= CURRENT_DATE - INTERVAL \'6 days\'';
  if (range === 'all') rangeClause = 'true';
  if (range === 'month') rangeClause = 'log_date >= CURRENT_DATE - INTERVAL \'30 days\'';

  try {
    const result = await pool.query(
      `SELECT id, meal_type, meal_name, calories, log_date, created_at
       FROM nutrition_logs WHERE user_uuid = $1 AND ${rangeClause} ORDER BY log_date DESC, created_at DESC`,
      [req.params.uuid]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching nutrition:', error);
    res.status(500).json({ error: 'Error fetching nutrition' });
  }
});

app.post('/api/nutrition', requireAuth, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });

  const { meal_type, meal_name, calories, log_date } = req.body;
  if (!meal_type || !meal_name || !log_date) return res.status(400).json({ success: false, message: 'meal_type, meal_name, and log_date are required' });

  try {
    const result = await pool.query(
      `INSERT INTO nutrition_logs (user_uuid, meal_type, meal_name, calories, log_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.user_uuid, meal_type, meal_name, calories, log_date]
    );

    const entry = result.rows[0];
    eventBus.emit(req.user.user_uuid, 'nutrition:created', entry);
    res.status(201).json(entry);
  } catch (error) {
    console.error('Error creating nutrition log:', error);
    res.status(500).json({ error: 'Error creating nutrition log' });
  }
});

app.patch('/api/nutrition/:id', requireAuth, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });

  const { id } = req.params;
  const { meal_type, meal_name, calories, log_date } = req.body;

  try {
    const result = await pool.query(
      `UPDATE nutrition_logs SET meal_type = COALESCE($1, meal_type), meal_name = COALESCE($2, meal_name),
       calories = COALESCE($3, calories), log_date = COALESCE($4, log_date)
       WHERE id = $5 AND user_uuid = $6 RETURNING *`,
      [meal_type, meal_name, calories, log_date, id, req.user.user_uuid]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Nutrition log not found' });

    const entry = result.rows[0];
    eventBus.emit(req.user.user_uuid, 'nutrition:updated', entry);
    res.json(entry);
  } catch (error) {
    console.error('Error updating nutrition log:', error);
    res.status(500).json({ error: 'Error updating nutrition log' });
  }
});

app.delete('/api/nutrition/:id', requireAuth, async (req, res) => {
  if (!dbConnected) return res.status(503).json({ success: false, message: 'Database not configured' });

  try {
    const result = await pool.query(
      'DELETE FROM nutrition_logs WHERE id = $1 AND user_uuid = $2 RETURNING id',
      [req.params.id, req.user.user_uuid]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Nutrition log not found' });

    eventBus.emit(req.user.user_uuid, 'nutrition:deleted', { id: req.params.id });
    res.json({ success: true, id: req.params.id });
  } catch (error) {
    console.error('Error deleting nutrition log:', error);
    res.status(500).json({ error: 'Error deleting nutrition log' });
  }
});

// ============================================================================
// FOOD DATABASE (static — comprehensive nutrition data)
// ============================================================================

const FOOD_DATABASE = [
  { id: 1, name: "Grilled Chicken Breast", category: "protein", calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0, sugar: 0, calcium: 15, iron: 1, vitamin_c: 0, vitamin_a: 3, serving_size: "100g" },
  { id: 2, name: "Salmon Fillet", category: "protein", calories: 206, protein: 22, carbs: 0, fat: 13, fiber: 0, sugar: 0, calcium: 18, iron: 4, vitamin_c: 0, vitamin_a: 5, serving_size: "100g" },
  { id: 3, name: "Eggs (2 large)", category: "protein", calories: 140, protein: 12, carbs: 1.2, fat: 10, fiber: 0, sugar: 1.2, calcium: 60, iron: 1.8, vitamin_c: 0, vitamin_a: 60, serving_size: "2 eggs" },
  { id: 4, name: "Greek Yogurt (Plain, 200g)", category: "protein", calories: 130, protein: 20, carbs: 8, fat: 0, fiber: 0, sugar: 6, calcium: 200, iron: 0, vitamin_c: 0, vitamin_a: 5, serving_size: "200g" },
  { id: 5, name: "Brown Rice (1 cup cooked)", category: "carbs", calories: 218, protein: 5, carbs: 45, fat: 1.8, fiber: 3.5, sugar: 1.5, calcium: 20, iron: 1, vitamin_c: 0, vitamin_a: 0, serving_size: "1 cup" },
  { id: 6, name: "Avocado (1 medium)", category: "fat", calories: 220, protein: 3, carbs: 12, fat: 21, fiber: 10, sugar: 0.7, calcium: 40, iron: 1, vitamin_c: 15, vitamin_a: 140, serving_size: "1 medium" },
  { id: 7, name: "Broccoli (1 cup steamed)", category: "vegetable", calories: 55, protein: 4, carbs: 11, fat: 0.6, fiber: 5, sugar: 2, calcium: 60, iron: 1, vitamin_c: 89, vitamin_a: 700, serving_size: "1 cup" },
  { id: 8, name: "Spinach (2 cups raw)", category: "vegetable", calories: 14, protein: 2, carbs: 2.3, fat: 0.2, fiber: 1.3, sugar: 0.5, calcium: 30, iron: 1.2, vitamin_c: 14, vitamin_a: 900, serving_size: "2 cups" },
  { id: 9, name: "Sweet Potato (1 medium)", category: "carbs", calories: 112, protein: 2, carbs: 26, fat: 0.1, fiber: 4, sugar: 5, calcium: 40, iron: 1, vitamin_c: 30, vitamin_a: 1000, serving_size: "1 medium" },
  { id: 10, name: "Olive Oil (1 tbsp)", category: "fat", calories: 119, protein: 0, carbs: 0, fat: 14, fiber: 0, sugar: 0, calcium: 0, iron: 0.2, vitamin_c: 0, vitamin_a: 20, serving_size: "1 tbsp" },
  { id: 11, name: "Blueberries (1 cup)", category: "fruit", calories: 86, protein: 1, carbs: 22, fat: 0.5, fiber: 4, sugar: 15, calcium: 10, iron: 0.5, vitamin_c: 15, vitamin_a: 50, serving_size: "1 cup" },
  { id: 12, name: "Banana (1 medium)", category: "fruit", calories: 105, protein: 1, carbs: 27, fat: 0.4, fiber: 3, sugar: 14, calcium: 6, iron: 0.3, vitamin_c: 10, vitamin_a: 100, serving_size: "1 medium" },
  { id: 13, name: "Almonds (1 oz)", category: "fat", calories: 161, protein: 6, carbs: 6, fat: 14, fiber: 4, sugar: 1, calcium: 75, iron: 1, vitamin_c: 0, vitamin_a: 1, serving_size: "1 oz" },
  { id: 14, name: "Whole Wheat Bread (1 slice)", category: "carbs", calories: 69, protein: 4, carbs: 12, fat: 1, fiber: 2, sugar: 1, calcium: 25, iron: 1, vitamin_c: 0, vitamin_a: 0, serving_size: "1 slice" },
  { id: 15, name: "Mackerel (100g)", category: "protein", calories: 205, protein: 22, carbs: 0, fat: 14, fiber: 0, sugar: 0, calcium: 15, iron: 1, vitamin_c: 0, vitamin_a: 20, serving_size: "100g" },
  { id: 16, name: "Oats (1/2 cup dry)", category: "carbs", calories: 150, protein: 5, carbs: 27, fat: 2.5, fiber: 4, sugar: 1, calcium: 10, iron: 1.5, vitamin_c: 0, vitamin_a: 5, serving_size: "½ cup" },
  { id: 17, name: "Tomato (1 medium)", category: "vegetable", calories: 22, protein: 1, carbs: 5, fat: 0.2, fiber: 1.5, sugar: 3, calcium: 10, iron: 0.3, vitamin_c: 25, vitamin_a: 400, serving_size: "1 medium" },
  { id: 18, name: "Protein Powder (1 scoop)", category: "protein", calories: 120, protein: 24, carbs: 3, fat: 2, fiber: 0, sugar: 1, calcium: 100, iron: 1, vitamin_c: 0, vitamin_a: 0, serving_size: "1 scoop" },
  { id: 19, name: "Lettuce (2 cups)", category: "vegetable", calories: 10, protein: 1, carbs: 2, fat: 0.1, fiber: 1.2, sugar: 0.5, calcium: 10, iron: 0.4, vitamin_c: 12, vitamin_a: 200, serving_size: "2 cups" },
  { id: 20, name: "Peanut Butter (2 tbsp)", category: "fat", calories: 190, protein: 8, carbs: 6, fat: 16, fiber: 2, sugar: 3, calcium: 30, iron: 0.8, vitamin_c: 0, vitamin_a: 100, serving_size: "2 tbsp" },
  { id: 21, name: "Tuna (canned in water, 100g)", category: "protein", calories: 116, protein: 25, carbs: 0, fat: 1, fiber: 0, sugar: 0, calcium: 10, iron: 0.6, vitamin_c: 0, vitamin_a: 20, serving_size: "100g" },
  { id: 22, name: "Quinoa (1 cup cooked)", category: "carbs", calories: 222, protein: 8, carbs: 40, fat: 3.5, fiber: 5, sugar: 3, calcium: 30, iron: 2, vitamin_c: 0, vitamin_a: 0, serving_size: "1 cup" },
  { id: 23, name: "Green Beans (1 cup)", category: "vegetable", calories: 25, protein: 2, carbs: 6, fat: 0.2, fiber: 2, sugar: 3, calcium: 40, iron: 1, vitamin_c: 18, vitamin_a: 300, serving_size: "1 cup" }
];

app.get('/api/foods', requireAuth, (req, res) => {
  const { category } = req.query;
  if (category && category !== 'all') {
    const filtered = FOOD_DATABASE.filter(f => f.category === category);
    return res.json(filtered);
  }
  res.json(FOOD_DATABASE);
});

app.get('/api/foods/:id', requireAuth, (req, res) => {
  const food = FOOD_DATABASE.find(f => f.id === parseInt(req.params.id));
  if (!food) return res.status(404).json({ success: false, message: 'Food not found' });
  res.json(food);
});

// ============================================================================
// WORKOUT LIBRARY (static — comprehensive exercise database)
// ============================================================================

const WORKOUT_LIBRARY = [
  {
    id: 1, name: "Bench Press", category: "strength", muscle_group: "Chest",
    description: "Compound exercise targeting the pectoral muscles, anterior deltoids, and triceps.",
    instructions: [
      "Lie on a flat bench with feet flat on the floor.",
      "Grasp the barbell with hands slightly wider than shoulder-width.",
      "Lower the bar to the middle of your chest.",
      "Press the bar back up to starting position.",
      "Repeat for desired reps."
    ],
    difficulty: "Intermediate",
    equipment: "Barbell, Bench"
  },
  {
    id: 2, name: "Deadlift", category: "strength", muscle_group: "Full Body",
    description: "Fundamental compound movement targeting the posterior chain: hamstrings, glutes, back, and traps.",
    instructions: [
      "Stand with feet hip-width apart, barbell over mid-foot.",
      "Bend at hips and knees, grip the bar just outside knees.",
      "Keep back straight, chest up, and lift using your legs.",
      "Stand up by extending hips and knees simultaneously.",
      "Lower the weight under control."
    ],
    difficulty: "Intermediate",
    equipment: "Barbell"
  },
  {
    id: 3, name: "Squat", category: "strength", muscle_group: "Legs",
    description: "Compound exercise targeting quadriceps, hamstrings, glutes, and core.",
    instructions: [
      "Stand with feet shoulder-width apart, barbell across upper traps.",
      "Brace your core and unrack the barbell.",
      "Bend knees and lower until thighs are parallel to floor.",
      "Drive through heels to return to standing position.",
      "Keep chest up and back straight throughout."
    ],
    difficulty: "Intermediate",
    equipment: "Barbell, Squat Rack"
  },
  {
    id: 4, name: "Pull-ups", category: "strength", muscle_group: "Back",
    description: "Bodyweight exercise targeting the latissimus dorsi, rhomboids, and biceps.",
    instructions: [
      "Hang from a pull-up bar with palms facing away from you.",
      "Pull your chest up to the bar, squeezing shoulder blades.",
      "Lower yourself to a dead hang with control.",
      "Repeat for desired reps."
    ],
    difficulty: "Intermediate",
    equipment: "Pull-up Bar"
  },
  {
    id: 5, name: "Push-ups", category: "strength", muscle_group: "Chest",
    description: "Bodyweight exercise targeting chest, shoulders, and triceps.",
    instructions: [
      "Place hands shoulder-width apart, body in a straight line.",
      "Lower chest to floor, keeping elbows at 45 degrees.",
      "Push back up by extending arms fully.",
      "Keep core tight throughout."
    ],
    difficulty: "Beginner",
    equipment: "None"
  },
  {
    id: 6, name: "Plank", category: "strength", muscle_group: "Core",
    description: "Isometric hold targeting the entire core and stabilizing muscles.",
    instructions: [
      "Start in a forearm plank position, elbows under shoulders.",
      "Keep body in a straight line from head to heels.",
      "Engage glutes and core, don't let hips sag.",
      "Hold for 30-60 seconds."
    ],
    difficulty: "Beginner",
    equipment: "None"
  },
  {
    id: 7, name: "Cardio - Running", category: "cardio", muscle_group: "Full Body",
    description: "High-intensity cardiovascular exercise improving endurance and heart health.",
    instructions: [
      "Warm up with 5 minutes of walking.",
      "Run at a steady pace for your target duration.",
      "Maintain good posture with shoulders relaxed.",
      "Land mid-foot with each stride.",
      "Cool down with light walking."
    ],
    difficulty: "All Levels",
    equipment: "Running Shoes"
  },
  {
    id: 8, name: "Cardio - Cycling", category: "cardio", muscle_group: "Legs",
    description: "Low-impact cardiovascular exercise targeting legs and improving endurance.",
    instructions: [
      "Adjust seat height so leg is slightly bent at full extension.",
      "Start with a slow warm-up pace.",
      "Maintain steady cadence (80-100 RPM).",
      "Shift gears appropriately for terrain.",
      "Cool down and stretch after."
    ],
    difficulty: "Beginner",
    equipment: "Bicycle"
  },
  {
    id: 9, name: "Yoga - Sun Salutation", category: "flexibility", muscle_group: "Full Body",
    description: "Dynamic sequence improving flexibility, mobility, and core strength.",
    instructions: [
      "Start standing with feet together, arms overhead.",
      "Inhale: Raise arms up, exhale: Forward fold.",
      "Step back into high plank position.",
      "Lower to knees, chest, or toes.",
      "Lift into upward dog, then downward dog.",
      "Step forward and rise up to standing."
    ],
    difficulty: "Beginner",
    equipment: "Yoga Mat"
  },
  {
    id: 10, name: "Overhead Press", category: "strength", muscle_group: "Shoulders",
    description: "Compound movement targeting deltoids, triceps, and upper chest.",
    instructions: [
      "Stand with feet shoulder-width apart, barbell at shoulder height.",
      "Grip bar just outside shoulders, palms facing you.",
      "Press bar overhead until arms are fully extended.",
      "Lower back to shoulders under control.",
      "Repeat for desired reps."
    ],
    difficulty: "Intermediate",
    equipment: "Barbell, Dumbbells"
  },
  {
    id: 11, name: "Barbell Row", category: "strength", muscle_group: "Back",
    description: "Compound pulling exercise targeting lats, rhomboids, and middle traps.",
    instructions: [
      "Stand with feet hip-width, knees slightly bent.",
      "Bend at hips, back flat, bar hanging below shoulders.",
      "Pull bar to lower abdomen, squeezing shoulder blades.",
      "Lower bar under control back to starting position.",
      "Maintain straight back throughout."
    ],
    difficulty: "Intermediate",
    equipment: "Barbell"
  },
  {
    id: 12, name: "HIIT Circuit", category: "cardio", muscle_group: "Full Body",
    description: "High-intensity interval training combining cardio and strength for maximum efficiency.",
    instructions: [
      "Set timer for 20-30 seconds per exercise.",
      "Perform exercises back-to-back with 10s rest intervals.",
      "Complete 3-4 rounds with 60s rest between rounds.",
      "Exercises: burpees, mountain climbers, squat jumps, push-ups."
    ],
    difficulty: "Advanced",
    equipment: "None"
  },
  {
    id: 13, name: "Lunge", category: "strength", muscle_group: "Legs",
    description: "Unilateral exercise targeting quads, glutes, and hamstrings, improving balance.",
    instructions: [
      "Stand tall, feet hip-width apart.",
      "Step forward with right foot, lowering until both thighs are parallel.",
      "Push through front heel to return to start.",
      "Repeat on the other leg.",
      "Keep torso upright throughout."
    ],
    difficulty: "Beginner",
    equipment: "Bodyweight, Dumbbells"
  },
  {
    id: 14, name: "Lat Pulldown", category: "strength", muscle_group: "Back",
    description: "Machine-based pulling exercise targeting latissimus dorsi and biceps.",
    instructions: [
      "Adjust knee pad and grip bar wider than shoulders.",
      "Lean back slightly, pull bar to upper chest.",
      "Squeeze shoulder blades together.",
      "Return bar slowly to starting position.",
      "Maintain core engagement."
    ],
      difficulty: "Beginner",
    equipment: "Cable Machine"
  },
  {
    id: 15, name: "Bicep Curl", category: "strength", muscle_group: "Arms",
    description: "Isolation exercise targeting the biceps brachii and brachialis.",
    instructions: [
      "Stand with feet shoulder-width apart, barbell in hand.",
      "Curl the bar up toward your shoulders, squeezing biceps.",
      "Contract at the top, then lower slowly under control.",
      "Keep elbows close to your sides throughout."
    ],
    difficulty: "Beginner",
    equipment: "Barbell, Dumbbells"
  },
  {
    id: 16, name: "Tricep Dip", category: "strength", muscle_group: "Arms",
    description: "Bodyweight compound exercise targeting triceps, chest, and shoulders.",
    instructions: [
      "Place hands on parallel bars, legss extended forward.",
      "Lower your body until arms are at 90 degrees.",
      "Push up by extending elbows fully.",
      "Keep shoulders down and core engaged."
    ],
    difficulty: "Intermediate",
    equipment: "Parallel Bars, Dip Station"
  },
  {
    id: 17, name: "Hammer Curl", category: "strength", muscle_group: "Arms",
    description: "Variation of the bicep curl targeting brachialis and brachioradialis.",
    instructions: [
      "Stand with feet shoulder-width apart, dumbbells at sides.",
      "Palms face each other (neutral grip).",
      "Curl weights up, rotating wrists at the top.",
      "Lower slowly with control."
    ],
    difficulty: "Intermediate",
    equipment: "Dumbbells"
  }
];

// ============================================================================
// SERVER-SENT EVENTS (SSE) — fallback for real-time when WebSocket unavailable
// ============================================================================

app.get('/sse/dashboard/:uuid', requireAuth, (req, res) => {
  const { uuid } = req.params;
  if (uuid !== req.user.user_uuid && !req.user.isAdmin) {
    return res.status(403).end();
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  eventBus.addSseClient(uuid, res);

  req.on('close', () => {
    eventBus.removeSseClient(uuid, res);
  });
});

// ============================================================================
// START SERVER + WEBSOCKET
// ============================================================================

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, request) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const uuid = url.searchParams.get('uuid');

  if (!uuid) {
    ws.close(4401, 'Missing user UUID');
    return;
  }

  eventBus.addWsClient(uuid, ws);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'subscribe') {
        eventBus.addWsClient(msg.payload.user_uuid, ws);
      }
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (err) {
      console.error('WS message parse error:', err.message);
    }
  });

  ws.on('close', () => {
    eventBus.removeWsClient(uuid, ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

server.on('upgrade', (request, socket, head) => {
  if (request.url.startsWith('/ws')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`HitRepublic server running on port ${PORT}`);
  console.log(`Admin panel available at http://localhost:${PORT}/admin.html`);
});

module.exports = { app, server, eventBus };