# HitRepublic - Neon DB Integration Guide

## Installation

```bash
npm install
npm install dotenv pg --save
```

## Environment Setup

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Fill in your credentials in `.env`:
   - `ADMIN_EMAIL` - Admin panel login email
   - `ADMIN_PASSWORD` - Admin panel login password
   - `NEON_DATABASE_URL` - Your Neon PostgreSQL connection string (format: `postgresql://user:pass@host.region.aws.neon.tech/dbname?sslmode=require`)
   - `NEON_API_KEY` - Your Neon API key for database operations
   - `JWT_SECRET` - Secret key for JWT token signing
   - `SESSION_SECRET` - Secret for session management

## Required Tables

The tables are automatically created on server startup. If you need to create them manually:

```sql
-- Bookings table
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

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    user_uuid UUID DEFAULT gen_random_uuid() UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password_hash TEXT NOT NULL,
    membership_status TEXT DEFAULT 'basic',
    join_date TIMESTAMP DEFAULT NOW(),
    last_active TIMESTAMP DEFAULT NOW()
);

-- Fitness Goals table
CREATE TABLE IF NOT EXISTS fitness_goals (
    id SERIAL PRIMARY KEY,
    user_uuid TEXT REFERENCES users(user_uuid),
    goal_name TEXT NOT NULL,
    target_value TEXT,
    current_progress INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Workouts table
CREATE TABLE IF NOT EXISTS workouts (
    id SERIAL PRIMARY KEY,
    user_uuid TEXT REFERENCES users(user_uuid),
    workout_type TEXT NOT NULL,
    workout_date DATE NOT NULL,
    duration_minutes INTEGER,
    calories_burned INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Nutrition Logs table
CREATE TABLE IF NOT EXISTS nutrition_logs (
    id SERIAL PRIMARY KEY,
    user_uuid TEXT REFERENCES users(user_uuid),
    meal_type TEXT NOT NULL,
    meal_name TEXT NOT NULL,
    calories INTEGER,
    log_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## API Endpoints Structure

The dashboard connects to these local API endpoints to interact with Neon DB:

- `POST /api/auth/login` - Admin authentication (uses .env ADMIN_EMAIL/PASSWORD)
- `POST /api/auth/register` - User registration
- `GET /api/bookings` - Get all bookings (admin)
- `POST /api/bookings` - Create booking
- `GET /api/users/:uuid` - Get user profile
- `GET /api/goals/:user_uuid` - Get fitness goals
- `POST /api/goals` - Add new goal
- `GET /api/workouts/:user_uuid` - Get workout history
- `POST /api/workouts` - Log new workout
- `GET /api/nutrition/:user_uuid` - Get nutrition logs
- `POST /api/nutrition` - Log new meal

Setup complete! Configure your backend to connect to Neon DB using the connection URL.
