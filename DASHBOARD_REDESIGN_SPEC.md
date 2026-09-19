# HitRepublic â€” User Dashboard Redesign Technical Specification

**Document:** Technical Specification & Design Plan
**Project:** HitRepublic (`D:\hdd\templates\fitness`)
**Stack Baseline:** Vanilla HTML/CSS/JS frontend, Node.js + Express 4.18.2 backend, PostgreSQL via Neon (`pg` 8.11.0)
**Status:** Draft â€” Implementation Plan
**Date:** 2026-08-05

---

## 0. Executive Summary

The current `user-dashboard.html` (819 lines) is a static presentation layer: all
data is hardcoded (profile, goals, workouts, nutrition), there is **no API
integration**, **no authentication guard**, and **no real-time updates**. The
backend (`server.js`, 395 lines) defines the `users`, `fitness_goals`,
`workouts`, and `nutrition_logs` tables but exposes **zero endpoints** for them
(7 of 11 endpoints documented in `NEON_SETUP.md` are missing).

This specification defines the end-to-end redesign that:

1. Replaces static mock data with a **dynamic, API-driven** fitness dashboard.
2. Implements a **responsive UI/UX** optimized for goal tracking, activity
   summaries, and progress visualization across mobile and desktop.
3. Adds **real-time synchronization** via WebSocket so the dashboard updates
   instantly when data changes.
4. Establishes a clean **data-flow architecture** from PostgreSQL â†’ Express API â†’
   React-style frontend components â†’ UI, with caching and error boundaries.

**Recommended frontend path:** Given the codebase is vanilla-only today, this spec
proposes a **progressive enhancement** approach â€” keep the existing page as an
integration shell while introducing a lightweight component layer in vanilla JS
(no build step, no new framework dependency). This honors the project's
"no-framework" convention while enabling reactivity and maintainability.

---

## 1. UI/UX Design

### 1.1 Design Principles

| Principle | Rationale |
|-----------|-----------|
| **Goal-centric hierarchy** | Fitness users scan for progress, targets, and deltas first. Layout must surface goal completion, weekly activity, and trend direction within the first viewport. |
| **Glass-morphism + fitness palette** | Inherits the existing dark theme (`#0a0a0a`) and gradient system (`--primary-gradient`, `--fitness-gradient`, `--nutrition-gradient`) from the current dashboard. No design-system churn. |
| **Dense-but-clean metric density** | Fit meaningful data on a 375px mobile screen: use expandable cards, horizontal scroll carousels for charts, and progressive disclosure. |
| **Motivational micro-interactions** | Progress-bar fill animations, goal-completion celebrations, and haptic-style button feedback reinforce positive behavior loops. |
| **Accessibility baseline** | WCAG 2.1 AA: color-contrast on gradients via solid fallbacks, focus rings, semantic `<section>`/`<article>` landmarks, `aria-live` for live-updating metrics. |

### 1.2 Layout & Grid System

```
Mobile (â‰¤ 480px)           Tablet (768px)            Desktop (â‰¥ 1024px)
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ NAVBAR             â”‚    â”‚ NAVBAR             â”‚    â”‚ NAVBAR                  â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤    â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤    â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚ HEADER (h1 + sub)  â”‚    â”‚ HEADER             â”‚    â”‚ HEADER                  â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤    â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤    â”œâ”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚ STAT  STICKY BAR   â”‚    â”‚ STAT STICKY BAR    â”‚    â”‚ STATS â”‚ OVERVIEW  â”‚ SIDEBARâ”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤    â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤    â”‚ ROW  â”‚ CHART     â”‚ NOTIF â”‚
â”‚ GOALS CARD         â”‚    â”‚ GOALS  â”‚ OVERVIEW  â”‚    â”œâ”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”¤
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤    â”‚ CARD   â”‚ CHART     â”‚    â”‚ WORK- â”‚ NUTR-  â”‚       â”‚
â”‚ WORKOUTS CARD      â”‚    â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤    â”‚ OUTS  â”‚ ITION  â”‚       â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤    â”‚ NUTRI- â”‚ GOALS     â”‚    â”‚ CARD  â”‚ CARD   â”‚       â”‚
â”‚ NUTRITION CARD     â”‚    â”‚ TION   â”‚ CARD      â”‚    â”‚  â”‚     â”‚  â”‚      â”‚       â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤    â”‚ CARD   â”‚           â”‚    â”‚  â”‚     â”‚  â”‚      â”‚       â”‚
â”‚ EMPTY-STATE / CTA   â”‚    â”‚        â”‚           â”‚    â”‚  â–¼     â”‚  â–¼      â”‚       â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Grid mechanics:**

- **Container:** `max-width: 1400px; margin: 0 auto; padding: 24px;` with
  `gap: 24px` between grid items (matches existing `--border-radius: 20px` scale).
- **Breakpoints:** `@media (max-width: 768px)` collapses to single column;
  `@media (max-width: 480px)` reduces padding to 12px and font-size scales down
  to 14px base. These match the existing media-query conventions.
- **Sticky stat bar:** On desktop, a 4-card summary (`Today's Calories`,
  `Active Minutes`, `Workouts`, `Goal Progress`) is `position: sticky; top: 24px`
  so it remains visible during scroll â€” the current dashboard scrolls past its
  stat data immediately.

### 1.3 Component Catalog

#### 1.3.1 Stat Card â€” Metric Summary (`StatCard`)
```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ [icon] Calories Burned        420 / 500 kcal   â”‚
â”‚ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ â”‚
â”‚ [==== 84% =====                  ]   -80 cal   â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```
- **Props:** `label`, `value`, `target`, `unit`, `icon`, `trend` (+/- delta),
  `color` (gradient var).
- **Behavior:** Progress bar animates from 0% to `target%` on mount. Trend
  indicator is color-coded green/red with an arrow. On hover, a tooltip shows
  last-7-day average.
- **Accessibility:** `role="figure"`, `aria-label` includes full value + trend.

#### 1.3.2 Progress Chart â€” Weekly Activity (`ActivityChart`)
- **Type:** Inline SVG bar chart (zero dependencies â€” avoids Chart.js/CDN bloat
  consistent with the project's no-build approach). Renders 7 bars for
    Monâ€“Sun calories or minutes.
- **Responsive:** On mobile, collapses to a compact horizontal scroller
    (`overflow-x: auto; scroll-snap-type: x mandatory`).
- **Real-time:** Bars re-render with a 300ms fade/stagger when new data arrives
    via WebSocket (Section 3).
- **Accessibility:** `<table>` fallback with `<caption>` and `<th>` scope for
    screen readers.

#### 1.3.3 Goal Tracker (`GoalTracker`)
- **Visual:** Vertical stack of goal items with colored progress bars. Color
    derived from `status`: `completed` â†’ `--success-gradient`, `active` â†’
    `--warning-gradient`, `overdue` â†’ `--secondary-gradient`.
- **Micro-interaction:** On reaching 100%, the bar pulses and a confetti
    particle effect (CSS-driven, 12 absolutely-positioned divs) plays once.
- **Actions:** Each goal has an inline `aria-label="Edit [goal]"` pencil button
    and a `â€¢â€¢â€¢` overflow menu (mark complete / delete). The current dashboard's
    `addGoal()` stub will be replaced with a modal form.
- **Empty state:** `EmptyStateCard` with a motivational message + CTA button.

#### 1.3.4 Workout Log (`WorkoutList`)
- **Each item** is an `<article>` with: type + trainer, date, calories badge,
  duration. On mobile, becomes a collapsible `<details>` element to save vertical
  space.
- **Add button:** Floating action button (`position: fixed; bottom: 24px; right:
  24px`) with `+Log Workout` â€” standard mobile UX pattern. On desktop, inline
  button in the card footer.
- **Filtering:** Quick-filter pills (Today / This Week / This Month / All Time)
  above the list. Default: `This Week`.

#### 1.3.5 Nutrition Log (`NutritionList`)
- **Daily calorie donut:** A CSS conic-gradient circle showing `consumed / goal`
  for the day â€” no SVG needed, pure CSS `background: conic-gradient(...)`.
- **Meal list:** Each `<article>` shows meal type (Breakfast/Lunch/...), meal
  name, calories, and a small nutrient micro-bar (protein/carb/fat via inline
  width-percent bars).
- **Add meal:** Inline form that validates inputs before POST (Section 2.3).

#### 1.3.6 Notification System (`NotificationSystem`)
- Replaces the single `#notification` toast div with a **queue system** that
  supports multiple toasts with `setTimeout`-based auto-dismiss and manual close.
- Types: `success` (green gradient), `error` (red), `info` (blue), `warning`
  (amber).
- `aria-live="polite"` container ensures screen-reader announcement.

#### 1.3.7 Navigation Bar (`Navbar`)
- Collapses to hamburger on mobile (`max-width: 768px`) with a slide-out panel
  â€” the existing dashboard has no hamburger; this is a new pattern.
- Nav items: Dashboard (default), Progress, Workouts, Nutrition, Profile,
  Settings.
- User avatar shows initials; tapping opens a dropdown with "Edit Profile" and
  "Logout".

### 1.4 Responsive Behavior Matrix

| Feature | Desktop | Tablet | Mobile |
|---------|---------|--------|--------|
| Navbar | Full horizontal links | Hamburger + slide panel | Hamburger + slide panel |
| Stat Bar | 4 columns sticky | 2Ã—2 grid | 1 column, scrollable |
| Activity Chart | Full 7-bar SVG | 7-bar SVG | Horizontal scroll |
| Dashboard Grid | 3-column | 2-column | 1-column |
| Goal/Workouts/Nutrition | Side-by-side cards | Stacked cards | Stacked cards |
| Workout items | Full detail row | Full detail row | `<details>` collapsible |
| Floating action BTN | Hidden (inline btn) | Hidden (inline btn) | Visible bottom-right |

---

## 2. Frontend Architecture

### 2.1 Architectural Overview

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    user-dashboard.html                       â”‚
â”‚                                                              â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”‚
â”‚  â”‚  <script type="module" src="js/dashboard.js">           â”‚ â”‚
â”‚  â”‚                                                          â”‚ â”‚
â”‚  â”‚  1. State Manager  (src/state/)                          â”‚ â”‚
â”‚  â”‚  2. API Client      (src/api/)                           â”‚ â”‚
â”‚  â”‚  3. Components      (src/components/)                    â”‚ â”‚
â”‚  â”‚  4. Router (SPA)     (src/router/)                       â”‚ â”‚
â”‚  â”‚  5. Realtime        (src/realtime/)                      â”‚ â”‚
â”‚  â”‚  6. Utils           (src/utils/)                         â”‚ â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚
â”‚                                                              â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”                    â”‚
â”‚  â”‚  <style> â”‚  â”‚ template â”‚  â”‚  inline  â”‚  (existing CSS     â”‚
â”‚  â”‚  (CSS    â”‚  â”‚  tags    â”‚  â”‚  HTML    â”‚   variables &      â”‚
â”‚  â”‚  vars)   â”‚  â”‚  per     â”‚  â”‚  shell   â”‚   glass theme)     â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚  comp.)  â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜                    â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Key constraint:** The project uses **no build system** (no Vite, Webpack, Babel,
or npm frontend scripts). All code runs as native browser ES modules. The
redesign must respect this â€” components are plain JS classes/objects using the
DOM API, CSS uses native variables, and templates live in `<template>` tags
within the HTML file.

### 2.2 State Management

A lightweight **pub/sub store** replaces the current pattern of direct DOM
manipulation:

```js
// src/state/store.js
class Store {
  constructor(initial = {}) {
    this.state = reactive(initial);   // Proxy-based reactivity
    this.subscribers = new Map();
  }
  // subscribe(key, callback) â†’ returns unsubscribe
  // setState(key, value)     â†’ triggers subscribers + deep-diff
  // batch(updates)           â†’ single render cycle
}
```

**State shape:**
```js
{
  user: { user_uuid, first_name, last_name, email, membership_status, avatar },
  dashboard: {
    summary:    { calories_burned, calories_goal, active_minutes, workouts, steps },
    weeklyActivity: [ { day, value } Ã— 7 ],
    goals:      [ { id, goal_name, target_value, current_progress, status, unit } ],
    workouts:   [ { id, type, date, duration, calories } ],
    nutrition:  [ { id, meal_type, meal_name, calories, logged_at } ],
  },
  ui: {
    activeSection: 'dashboard',
    isLoading: false,
    error: null,
    notifications: [ { id, type, message, duration } ],
  }
}
```

This is the critical shift: currently `user-dashboard.html` reads from
hardcoded `<div>` content. The new architecture routes everything through
`Store`, so when state updates, subscribed components re-render automatically.

### 2.3 API Client

A dedicated `api.js` module wraps `fetch()` with:

```js
// src/api/client.js
const API_BASE = 'http://localhost:3000/api';

class ApiClient {
  constructor(baseURL, token = null) {
    this.baseURL = baseURL;
    this.headers = { 'Content-Type': 'application/json' };
    if (token) this.headers.Authorization = `Bearer ${token}`;
  }

  async request(path, opts = {}) {
    const url = `${this.baseURL}${path}`;
    const attempts = opts.retries ?? 1;
    let lastError;

    for (let i = 0; i <= attempts; i++) {
      try {
        const res = await fetch(url, { ...opts, headers: this.headers });
        if (!res.ok) throw new ApiError(res.status, await res.json());
        return await res.json();
      } catch (err) {
        lastError = err;
        if (i < attempts) await sleep(2 ** i * 1000); // exponential backoff
      }
    }
    throw lastError;
  }

  // Typed methods per resource:
  // getUser(uuid) â†’ GET /api/users/:uuid
  // getDashboard(uuid) â†’ GET /api/dashboard/:uuid  (single batched endpoint)
  // getGoals(uuid), createGoal(data), updateGoal(id, data), deleteGoal(id)
  // getWorkouts(uuid, range), createWorkout(data)
  // getNutrition(uuid, range), createNutrition(data)
  // updateProfile(uuid, data)
}
```

**Design decision â€” batched dashboard endpoint:** Rather than N+1 calls
(`/goals`, `/workouts`, `/nutrition`, `/users`), the backend exposes
`GET /api/dashboard/:uuid` which returns all four datasets in one response. This
reduces waterfall requests and is the single source of truth for the initial
dashboard render. See Section 4.2.

### 2.4 Component Pattern

Each component is a vanilla JS class that extends a `BaseComponent`:

```js
// src/components/StatCard.js
import { BaseComponent } from '../core/BaseComponent.js';

export class StatCard extends BaseComponent {
  static template = `
    <div class="stat-card {{colorClass}}">
      <div class="stat-header">
        <div class="stat-icon">{{icon}}</div>
        <span class="stat-label">{{label}}</span>
      </div>
      <div class="stat-value">{{value}}</div>
      <div class="stat-target">{{displayTarget}}</div>
      <div class="stat-bar"><div class="stat-fill" style="width: {{pct}}%"></div></div>
      <div class="stat-trend {{trendClass}}">{{trendText}}</div>
    </div>
  `;

  constructor(props) {
    super(props);
    this.render();
  }

  onStateChange(nextState, prevState) {
    // Only re-render if the slice this component cares about changed
    if (shallowDiff(this.propsSlice(nextState), this.propsSlice(prevState))) {
      this.render();
    }
  }
}
```

**Template strategy:** `<template>` tags in `user-dashboard.html` hold compiled
HTML strings. Components use a minimal mustache-style `{{var}}` interpolation â€”
no external templating library (keeps the zero-dependency convention).

### 2.5 Client-Side Routing

A hash-based SPA router (`#dashboard`, `#progress`, `#profile`) enables
navigation without page reloads. Each route lazily renders its component tree:

```
#dashboard  â†’ StatBar + ActivityChart + GoalTracker + WorkoutList + NutritionList
#progress   â†’ ActivityChart (expanded) + WeightTrendLine + GoalTracker (expanded)
#workouts   â†’ WorkoutList (full) + "Log Workout" modal
#nutrition  â†’ NutritionList (full) + "Log Meal" modal
#profile    â†’ ProfileCard + EditProfileForm
#settings   â†’ ThemeToggle + NotificationPrefs
```

The current `showSection()` function (which does `scrollIntoView`) is replaced
by the router â€” this aligns with the existing nav structure but adds URL state.

### 2.6 Build & Asset Strategy

- **No bundler.** All JS is written as native ES modules with relative `import`
  paths. Files go in `js/src/` (new directory).
- **CSS:** Extend the existing `<style>` block with new component classes that
  reuse the `:root` gradient variables already defined (`--fitness-gradient`,
  `--nutrition-gradient`, etc.).
- **External libs:** Font Awesome 6.4.0 CDN (keep), Google Fonts Inter + JetBrains
  Mono (keep). No new CDN dependencies introduced.
- **Icon fallback:** If the FA CDN fails, the UI degrades gracefully (icons
  become empty spans â€” semantic text labels are always present).

### 2.7 Error Boundaries & Loading States

- **Skeleton loaders** replace content areas during fetch: gray animated bars
  using the existing `--glass-bg` / `rgba(255,255,255,0.05)` pattern.
- **Error boundaries:** If `/api/dashboard/:uuid` fails, a full-screen error
  component with a "Retry" button and a contact-support link renders. Uses the
  `--secondary-gradient` (red) theme for error states.
- **Offline detection:** `window.addEventListener('offline')` triggers a
  "Working offline â€” showing cached data" banner; the existing toast system
  surfaces it.

---

## 3. Real-Time Synchronization

### 3.1 Technology Choice: WebSocket (primary) + SSE (fallback)

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **WebSocket** (`ws` or Socket.IO) | Bidirectional, binary support, sub-second latency | Requires a running WS server, connection management | **PRIMARY** â€” enables live workout logging sync |
| **SSE** (Server-Sent Events) | Built into Express easily, auto-reconnect, simpler | Unidirectional (serverâ†’client only), text-only | **FALLBACK** for environments where WS is blocked |
| **Polling** (current 30s in admin.html) | Simple, works everywhere | Wasteful, delayed | **DEPRECATED** â€” replaced by push |

**Selected stack:** `ws` library (lightweight, zero-opinion) over Socket.IO to
keep the dependency footprint minimal and consistent with the project's lean
`package.json`.

### 3.2 Connection Lifecycle

```js
// src/realtime/WebSocketClient.js
class WebSocketClient {
  constructor(apiBase) {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnect = 5;
    this.backoffBase = 1000;     // 1s
    this.reconnectJitter = 500;  // Â±500ms
  }

  connect() {
    // Upgrade from the same origin: ws://localhost:3000/ws
    this.ws = new WebSocket(`${window.location.origin.replace('http', 'ws')}/ws`);

    this.ws.onopen =    () => this.onOpen();
    this.ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
    this.ws.onerror =   (e) => this.onError(e);
    this.ws.onclose =   () => this.onClose();
  }

  onOpen() {
    this.reconnectAttempts = 0;
    // Re-subscribe the authenticated user
    this.send({ type: 'subscribe', payload: { user_uuid: currentUser.uuid } });
  }

  onMessage(event) {
    const { type, payload } = event;
    switch (type) {
      case 'dashboard:update':
        store.batch(payload);
        break;
      case 'heartbeat':
        // server pings every 30s; client confirms liveness
        break;
      case 'auth:revoked':
        redirectToLogin();
        break;
    }
  }

  onClose() {
    if (this.reconnectAttempts < this.maxReconnect) {
      const delay = this.backoffBase * 2 ** this.reconnectAttempts + randomJitter();
      this.reconnectAttempts++;
      setTimeout(() => this.connect(), delay);
    } else {
      // Fallback to SSE polling
      this.fallbackToSSE();
    }
  }
}
```

### 3.3 Event Contract

The server emits typed events over the WS channel. The client subscribes by
user UUID and receives only events scoped to that user.

| Event Type | Direction | Payload | Trigger |
|------------|-----------|---------|---------|
| `subscribe` | Câ†’S | `{ user_uuid }` | On WS connect + on route change to dashboard |
| `dashboard:update` | Sâ†’C | Partial dashboard state (goals, workouts, nutrition) | After any mutation |
| `workout:created` | Sâ†’C | `{ id, user_uuid, workout_type, date, duration_minutes, calories_burned }` | POST `/api/workouts` |
| `workout:updated` | Sâ†’C | Same shape | PATCH `/api/workouts/:id` |
| `workout:deleted` | Sâ†’C | `{ id }` | DELETE `/api/workouts/:id` |
| `goal:created` | Sâ†’C | `{ id, user_uuid, goal_name, target_value, current_progress, status }` | POST `/api/goals` |
| `goal:updated` | Sâ†’C | Same shape | PATCH `/api/goals/:id` |
| `goal:completed` | Sâ†’C | Full goal + user UUID | When `current_progress >= target_value` |
| `nutrition:created` | Sâ†’C | `{ id, meal_type, meal_name, calories, log_date }` | POST `/api/nutrition` |
| `heartbeat` | Sâ†’C | `{ timestamp }` | Every 30s (server â†’ client liveness) |
| `auth:revoked` | Sâ†’C | `{ reason }` | Session expired / admin revoked |

### 3.4 Frontend Integration with State

When a WS message arrives, the store is updated and **only affected components**
re-render:

```js
// Real-time handler in store
store.subscribe('dashboard.goals', (newGoals) => {
  // Re-sort: completed first, then active, then overdue
  ui.GoalTracker.render(newGoals);
  ui.StatBar.updateGoalProgress(calculateGoalPct(newGoals));
});

store.subscribe('dashboard.workouts', (newWorkouts) => {
  ui.WorkoutList.render(newWorkouts);
  ui.ActivityChart.update(newWorkouts.map(w => w.calories));
  ui.StatBar.updateCalories(weeklyCalories(newWorkouts));
});
```

This leverages the **incremental update** capability â€” not a full dashboard
refetch on every change.

### 3.5 SSE Fallback Implementation

If WebSocket fails to connect after 3 attempts, the client falls back:

```js
// src/realtime/EventSourceClient.js
const es = new EventSource('/sse/dashboard/:uuid');

es.addEventListener('dashboard:update', (e) => {
  store.batch(JSON.parse(e.data));
});

es.addEventListener('workout:created', (e) => {
  store.mutate('dashboard.workouts', (w) => [JSON.parse(e.data), ...w]);
});
```

The Express server registers **both** `/ws` (WebSocket) and `/sse/:channel`
(Server-Sent Events) routes. The same event publisher feeds both transports.

### 3.6 Server-Sent Events Route (Express)

```js
// server.js â€” SSE endpoint
app.get('/sse/dashboard/:uuid', (req, res) => {
  const { uuid } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });

  sseClients.add(uuid, res);
  req.on('close', () => sseClients.delete(uuid));
});
```

A shared **EventBus** (in-memory `Set` of WS clients + SSE clients keyed by
user UUID) is the single broadcast point. When a REST mutation succeeds, the
handler emits on the EventBus rather than touching transports directly.

---

## 4. Data Flow & Integration

### 4.1 End-to-End Data Flow Diagram

```
User performs action (e.g., "Log Workout")
         â”‚
         â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  1. Component (WorkoutList)         â”‚
â”‚     Calls store.mutate('create')   â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
              â”‚
              â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  2. Optimistic Update               â”‚
â”‚   store.setState â†’ re-render UI     â”‚
â”‚   (shows new workout instantly)     â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
              â”‚
              â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  3. API Client                      â”‚
â”‚   POST /api/workouts  (with auth)   â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
              â”‚
              â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  4. Express Backend                   â”‚
â”‚   â€¢ Validate input                   â”‚
â”‚   â€¢ INSERT into PostgreSQL (Neon)    â”‚
â”‚   â€¢ On success: publish to EventBus  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
              â”‚
              â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  5. EventBus Broadcast              â”‚
â”‚   â†’ WebSocket client(s) for user    â”‚
â”‚   â†’ SSE client(s) for user          â”‚
â”‚   (if WS failed)                    â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
              â”‚
              â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  6. Frontend Store                  â”‚
â”‚   Receives real-time event          â”‚
â”‚   â†’ Merges server-confirmed data    â”‚
â”‚   â†’ Re-renders affected components   â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
              â”‚
              â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  7. UI (DOM) Updated                â”‚
â”‚   (user sees confirmed state)       â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Critical data-integrity guarantees:**

- **Optimistic updates are reversible.** If the API call fails (500/401/403),
  the store rolls back to the pre-mutation snapshot and fires an error
  notification. The rollback is keyed by a client-generated request ID sent with
  the mutation â€” on rollback, the component replaces the optimistic item with
  the error state (e.g., a red X that can be retried).
- **Server is the source of truth.** The WS/SSE message always carries the
  server-confirmed record (with DB-generated `id`, `created_at`, etc.). The
  client deep-merges by primary key, so the optimistic temporary ID is swapped
  for the real one.
- **No client-side data mutation is trusted.** Even though the client does an
  optimistic update, the server's response (and the broadcast) is the canonical
  version the store adopts.

### 4.2 API Endpoint Specification (Backend Additions)

The current `server.js` has **0 user-facing endpoints** for the dashboard.
The following endpoints must be added:

#### 4.2.1 Auth & Session (JWT)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/register` | âŒ | Existing â€” **fix**: hash password with bcrypt, generate `user_uuid` via `gen_random_uuid()` |
| `POST` | `/api/auth/login` | âŒ | Existing â€” **fix**: bcrypt compare, return `JWT` in `HttpOnly` cookie |
| `GET` | `/api/auth/me` | âœ… | Validate JWT cookie, return current user object |
| `POST` | `/api/auth/logout` | âœ… | Clear JWT cookie |

**JWT implementation:** The `.env` already declares `JWT_SECRET` (unused).
Add `jsonwebtoken` to `package.json` dependencies. The server signs a token
with `{ user_uuid, email, isAdmin }` and sets it as an `HttpOnly`,
`SameSite=Lax` cookie. The frontend never reads the token (no `localStorage`
leak vector).

#### 4.2.2 User Profile

| Method | Path | Auth | Body | Returns |
|--------|------|------|------|---------|
| `GET` | `/api/users/:uuid` | âœ… | â€” | Full user profile (name, email, phone, membership_status, join_date, last_active) |
| `PATCH` | `/api/users/:uuid` | âœ… | `{ first_name, last_name, phone, password? }` | Updated user (password hashed if provided) |

#### 4.2.3 Dashboard (Batched Endpoint)

| Method | Path | Auth | Returns |
|--------|------|------|---------|
| `GET` | `/api/dashboard/:uuid` | âœ… | Single response containing profile, summary stats, weekly activity, goals, workouts (last 10), nutrition (today + yesterday). Avoids N+1 round-trips. |

**Response shape:**
```json
{
  "user": {
    "user_uuid": "abc-123",
    "first_name": "Alex",
    "last_name": "Morgan",
    "email": "alex@example.com",
    "membership_status": "premium",
    "join_date": "2024-01-15T10:00:00Z",
    "last_active": "2026-08-05T13:30:00Z"
  },
  "summary": {
    "calories_burned_today": 420,
    "calories_burned_week": 2840,
    "calories_burned_weekly_target": 3500,
    "active_minutes_today": 55,
    "workouts_this_week": 4,
    "steps_today": 8420,
    "daily_step_goal": 10000
  },
  "weekly_activity": [
    { "day": "Mon", "calories": 320, "minutes": 45 },
    { "day": "Tue", "calories": 450, "minutes": 60 },
    ...
  ],
  "goals": [
    { "id": 1, "goal_name": "Lose 15 lbs", "target_value": "150", "current_progress": 60, "unit": "%", "status": "active" },
    ...
  ],
  "workouts": [
    { "id": 1, "workout_type": "Upper Body", "workout_date": "2026-08-05", "duration_minutes": 45, "calories_burned": 320 },
    ...
  ],
  "nutrition": [
    { "id": 1, "meal_type": "breakfast", "meal_name": "Greek Yogurt Bowl", "calories": 380, "log_date": "2026-08-05" },
    ...
  ]
}
```

#### 4.2.4 Goals

| Method | Path | Auth | Body | Returns |
|--------|------|------|------|---------|
| `GET` | `/api/goals/:uuid` | âœ… | â€” | Array of goals for the user |
| `POST` | `/api/goals` | âœ… | `{ user_uuid, goal_name, target_value, unit, status }` | Created goal |
| `PATCH` | `/api/goals/:id` | âœ… | `{ current_progress?, status?, target_value?, goal_name? }` | Updated goal |
| `DELETE` | `/api/goals/:id` | âœ… | â€” | `{ success: true }` |

#### 4.2.5 Workouts

| Method | Path | Auth | Body | Returns |
|--------|------|------|------|---------|
| `GET` | `/api/workouts/:uuid?range=week` | âœ… | â€” | Array of workouts |
| `POST` | `/api/workouts` | âœ… | `{ user_uuid, workout_type, workout_date, duration_minutes, calories_burned }` | Created workout |
| `PATCH` | `/api/workouts/:id` | âœ… | Same, partial | Updated workout |
| `DELETE` | `/api/workouts/:id` | âœ… | â€” | `{ success: true }` |

#### 4.2.6 Nutrition

| Method | Path | Auth | Body | Returns |
|--------|------|------|------|---------|
| `GET` | `/api/nutrition/:uuid?range=week` | âœ… | â€” | Array of nutrition logs |
| `POST` | `/api/nutrition` | âœ… | `{ user_uuid, meal_type, meal_name, calories, log_date }` | Created log |
| `PATCH` | `/api/nutrition/:id` | âœ… | Same, partial | Updated log |
| `DELETE` | `/api/nutrition/:id` | âœ… | â€” | `{ success: true }` |

### 4.3 Backend Data Integrity & Schema Fixes

**Issues in the current schema that block the dashboard:**

1. **`user_uuid` is `TEXT UNIQUE` with no default** (server.js:88-90). The register
   `INSERT` (server.js:373-377) does not supply it. Fix: change to
   `user_uuid UUID DEFAULT gen_random_uuid() UNIQUE` and import `pgcrypto`
   (the `CREATE EXTENSION IF NOT EXISTS pgcrypto` is already called on line 52).

2. **Plaintext passwords** (server.js:342). Fix: import `bcrypt`, hash on
   register, `bcrypt.compare()` on login. The `.env` already has
   `BCRYPT_SALT_ROUNDS=12`.

3. **No authorization middleware.** Add:
   ```js
   function requireAuth(req, res, next) {
     const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
     if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
     try {
       const payload = jwt.verify(token, process.env.JWT_SECRET);
       req.user = payload;
       next();
     } catch { res.status(401).json({ success: false, message: 'Invalid token' }); }
   }
   ```
   All `/api/users`, `/api/goals`, `/api/workouts`, `/api/nutrition`,
   `/api/dashboard` routes require `requireAuth`. The `user_uuid` in the JWT
   payload is used to scope every query (`WHERE user_uuid = $1`), preventing
   IDOR.

4. **Destructive migration on startup** (server.js:60-69). This drops all tables
   if `user_uuid` column is missing. Post-fix, this migration is safe to run
   once; it should be replaced with a proper migration approach but is out of
   scope for this spec's MVP. Document it as a known risk.

### 4.4 Performance Characteristics

| Metric | Target | Mechanism |
|--------|--------|-----------|
| Initial dashboard load | < 800ms | Batched `/api/dashboard/:uuid` single query; `Promise.all` for parallelizable lookups |
| WS round-trip | < 100ms | In-process Node EventBus; no serialization for same-process clients |
| Re-render after mutation | < 50ms | Fine-grained store subscriptions; only dirty components re-render via `shallowDiff` |
| Memory (idle WS client) | < 2KB | Per-client state is a UUID + subscription list |
| Cache | Stale-while-revalidate 5s | In-memory LRU cache for `/api/dashboard/:uuid` keyed by UUID |
| Offline support | 5 min cache | Service Worker caches dashboard JSON in `localStorage` as fallback |

### 4.5 Caching Strategy

- **Backend (API):** `GET /api/dashboard/:uuid` is cached in-memory for 5 seconds
  (stale-while-revalidate). Cache is invalidated on any POST/PATCH/DELETE to
  that user's goals, workouts, or nutrition.
- **Frontend (Store):** The store retains the last-known dashboard snapshot. On
  WS reconnect, a `dashboard:sync` message triggers a soft refetch to reconcile
  any missed events (the server tracks per-user sequence numbers; the client
  sends `last_seen_seq` on subscribe and the server backfills missed events
  if the gap is < 100; otherwise triggers a full refetch).
- **Browser:** `localStorage` stores a timestamped copy of the dashboard JSON
  for offline-first rendering (Section 2.7).

### 4.6 Error Handling & Resilience

| Scenario | Handling |
|----------|----------|
| API returns 401 | Redirect to `/login.html` (clear client state first) |
| API returns 403 | Show "You don't have permission" banner; allow contact support |
| API returns 400 (validation) | Highlight the specific field in the form modal with inline error text |
| API returns 500 | Show retry button on the affected component; log to console |
| WS disconnects | Show "Live updates paused" indicator (yellow dot); auto-reconnect with backoff |
| WS reconnects after â‰¥ 30s offline | Trigger full dashboard refetch before resuming live events |
| Component render throws | `BaseComponent.render()` wraps in try/catch; surfaces `ErrorBoundary` fallback UI |

### 4.7 Security Considerations

1. **Passwords** â€” bcrypt with `BCRYPT_SALT_ROUNDS=12` (already in `.env`).
   Never store or compare plaintext. The current `password_hash !== password`
   comparison (server.js:342) must be replaced.
2. **JWT** â€” signed with `JWT_SECRET` (in `.env`), stored in `HttpOnly` cookie.
   The `Authorization: Bearer` header path is supported for API testing but the
   browser always uses the cookie.
3. **CORS** â€” the existing `app.use(cors())` is permissive (allows all origins).
   Restrict to the known frontend origin(s) in production:
   `cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' })`.
4. **Input validation** â€” all POST/PATCH endpoints validate with a minimal
   inline schema check (types, ranges, required fields) before hitting the DB.
5. **Rate limiting** â€” `express-rate-limit` on `/api/auth/login` (max 5 attempts
   / 15 min) to prevent brute-force. Add to `package.json`.
6. **No secrets in frontend** â€” the JWT is opaque to the client; all business
   logic (goal completion, calorie totals) lives on the server.

### 4.8 Deployment Notes

- The `start` script is `node server.js` (package.json:7). The WS server
  should be mounted on the same Express HTTP server (not a separate port) so
  the `/ws` upgrade shares the existing `app.listen(PORT)`.
- For production behind a reverse proxy (nginx, Render), ensure WebSocket
  upgrade headers (`Upgrade`, `Connection`) are forwarded and `ws` is used
  (the `ws` library handles this natively with `server.on('upgrade')`).
- The current Render deployment URL
  (`https://elite-fitness-6av3.onrender.com`) used in service-page JS should be
  replaced with environment-relative `http://localhost:3000` for local dev, or
  injected at build time. The dashboard will use `window.location.origin`-relative
  paths to avoid this mismatch.

---

## 5. Implementation Roadmap

| Phase | Scope | Effort | Dependencies |
|-------|-------|--------|--------------|
| **0 â€” Foundation** (Backend) | Fix schema (`user_uuid` default, bcrypt, JWT auth middleware), add 11 missing endpoints + batched `/api/dashboard/:uuid`, add WebSocket + SSE server, add EventBus | ~2-3 days | `bcrypt`, `jsonwebtoken`, `ws`, `express-rate-limit`, `cookie-parser` |
| **1 â€” State & API** (Frontend) | Create `js/src/` module structure: `store.js`, `api/client.js`, `realtime/WebSocketClient.js`, `router.js`. Auth guard on dashboard load. | ~1.5 days | Phase 0 backend |
| **2 â€” Components** (Frontend) | Port existing static HTML into component classes (`StatCard`, `ActivityChart`, `GoalTracker`, `WorkoutList`, `NutritionList`, `NotificationSystem`). Reuse existing CSS variables. | ~2 days | Phase 1 |
| **3 â€” Real-Time** (Full-stack) | Wire WebSocket events to store updates; implement optimistic mutations + rollback on all create/update/delete flows. | ~1.5 days | Phases 0+2 |
| **4 â€” Responsive Polish** (Frontend) | Mobile hamburger menu, collapsible workout `<details>`, floating action button, skeleton loaders, offline banner, error boundaries. | ~1 day | Phase 2 |
| **5 â€” Testing & Validation** | Mock data seeding for `user_uuid = uuid-ossp` demo user; verify dashboard renders from API; verify WS live updates when another client mutates data; verify rollback on 500. | ~1 day | Phases 0â€“3 |

**Total estimated effort:** ~9-10 developer-days (single engineer).

---

## 6. File Structure (Post-Redesign)

```
fitness/
â”œâ”€â”€ server.js                      (extended with auth, CRUD, WS, SSE, EventBus)
â”œâ”€â”€ user-dashboard.html            (refactored: template shell + module entry)
â”œâ”€â”€ js/
â”‚   â””â”€â”€ src/
â”‚       â”œâ”€â”€ core/
â”‚       â”‚   â”œâ”€â”€ BaseComponent.js
â”‚       â”‚   â”œâ”€â”€ EventBus.js        (client-side pub/sub)
â”‚       â”‚   â””â”€â”€ ErrorBoundary.js
â”‚       â”œâ”€â”€ state/
â”‚       â”‚   â”œâ”€â”€ Store.js
â”‚       â”‚   â””â”€â”€ hooks.js           (subscribe helpers)
â”‚       â”œâ”€â”€ api/
â”‚       â”‚   â”œâ”€â”€ client.js          (typed fetch wrapper)
â”‚       â”‚   â””â”€â”€ endpoints.js       (method-to-URL mapping)
â”‚       â”œâ”€â”€ components/
â”‚       â”‚   â”œâ”€â”€ StatCard.js
â”‚       â”‚   â”œâ”€â”€ ActivityChart.js
â”‚       â”‚   â”œâ”€â”€ GoalTracker.js
â”‚       â”‚   â”œâ”€â”€ WorkoutList.js
â”‚       â”‚   â”œâ”€â”€ NutritionList.js
â”‚       â”‚   â”œâ”€â”€ NotificationSystem.js
â”‚       â”‚   â”œâ”€â”€ Navbar.js
â”‚       â”‚   â””â”€â”€ forms/
â”‚       â”‚       â”œâ”€â”€ GoalForm.js
â”‚       â”‚       â”œâ”€â”€ WorkoutForm.js
â”‚       â”‚       â””â”€â”€ NutritionForm.js
â”‚       â”œâ”€â”€ realtime/
â”‚       â”‚   â”œâ”€â”€ WebSocketClient.js
â”‚       â”‚   â”œâ”€â”€ EventSourceClient.js  (SSE fallback)
â”‚       â”‚   â””â”€â”€ events.js             (event-type constants)
â”‚       â””â”€â”€ router/
â”‚           â”œâ”€â”€ Router.js
â”‚           â””â”€â”€ routes.js
â”œâ”€â”€ .env                           (bcrypt, jwt, ws secrets added)
â””â”€â”€ package.json                   (deps: bcrypt, jsonwebtoken, ws, cookie-parser, express-rate-limit)
```

---

## 7. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| No existing React/Vue expertise on team | Medium | Stick to vanilla JS components; document patterns clearly |
| WebSocket blocked by corporate proxies | Medium | SSE fallback (Section 3.6) ensures updates still arrive |
| Destructive DB migration on restart | High | Fix the `user_uuid` schema so the migration branch never triggers; back up Neon DB before deploy |
| Plaintext password migration | High | Existing `password_hash` column stores plaintext; on first login after deploy, bcrypt-compare will fail. **Mitigation:** Add a migration script that re-hashes all existing plaintext passwords (since the value IS the password, hash it in-place), or force password reset for legacy users. |
| WS connection storms on reconnect | Low | Jittered exponential backoff (Section 3.2); server-side rate limit on `/ws` upgrades |
| Offline data loss | Low | Optimistic updates with rollback; localStorage snapshot (Section 4.5) |

---

## 8. Acceptance Criteria

1. **Dashboard loads from API** â€” navigating to `user-dashboard.html` while
   authenticated fetches all data from `GET /api/dashboard/:uuid` and renders
   the correct profile, summary stats, goals, workouts, and nutrition for that
   user (not hardcoded "Alex Morgan").

2. **Real-time updates propagate** â€” when user A logs a workout in one browser
   tab, user A's other tab (or another device) shows the new workout within
   500ms via WebSocket, without a manual page refresh.

3. **Offline resilience** â€” with the network disconnected, the dashboard
   renders the last-known data from `localStorage`; a banner indicates
   offline mode.

4. **Mobile-first responsive** â€” dashboard is fully usable on a 375px-width
   viewport with hamburger navigation, collapsible sections, and a floating
   action button for logging.

5. **Auth guard** â€” unauthenticated navigation to `user-dashboard.html`
   redirects to `login.html`; the JWT cookie expires after 7 days
   (`SESSION_MAX_AGE` is already set to 86400000ms in `.env`).

6. **No console errors** on initial load, WS connect, WS disconnect+reconnect,
   or mutation failure.

7. **Backward compatibility** â€” `login.html` and `register.html` continue to
   work with the existing `/api/auth/login` and `/api/auth/register` endpoints
   (now returning a JWT cookie alongside the existing JSON body for non-breaking
   compatibility).

---

*End of specification.*
