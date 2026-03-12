# KidSync — Co-Parent Calendar

Shared calendar for co-parents to coordinate kids' schedules, travel logistics, and activities. Built with Next.js 14, TypeScript, Supabase, and Tailwind CSS.

## Features

- **Shared calendar** — Both parents can view and edit all events
- **Three views** — Month, week, and list views with kid-specific color coding
- **Event types** — School, sports, medical, birthday, custody exchange, travel, activity
- **Travel details** — Flights, lodging, emergency contacts, documents, packing checklists
- **Email notifications** — Automatic email to the other parent on every change
- **iCal export** — Download .ics file or subscribe via URL in Apple Calendar/Google/Outlook
- **Realtime sync** — Changes appear instantly for both parents
- **Activity log** — Audit trail of all changes with timestamps

## Quick Start

### 1. Create Supabase Project

Go to [supabase.com](https://supabase.com) and create a new project.

### 2. Run Migrations

In the Supabase SQL Editor, run the four migration files from `kidsync-backend-scaffold.md` in order:
1. `001_core_schema.sql`
2. `002_travel_details.sql`
3. `003_change_log.sql`
4. `004_rls_policies.sql`

### 3. Create Auth Users

In Supabase Dashboard → Authentication → Users, create two users (one for each parent).

### 4. Run Seed Data

Update the seed SQL with your actual auth user IDs and run it.

### 5. Deploy Edge Functions

```bash
supabase functions deploy notify-parent
supabase functions deploy ical-feed
```

### 6. Configure Environment

```bash
cp .env.local.example .env.local
# Fill in your Supabase URL and keys
```

### 7. Install & Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 8. Configure Postgres Settings

In the Supabase SQL Editor:
```sql
ALTER DATABASE postgres SET app.settings.notify_function_url = 'https://your-project.supabase.co/functions/v1/notify-parent';
ALTER DATABASE postgres SET app.settings.service_role_key = 'your-service-role-key';
```

## Project Structure

```
src/
├── app/
│   ├── layout.tsx          # Root layout, fonts, metadata
│   ├── page.tsx            # Root redirect (→ login or calendar)
│   ├── login/page.tsx      # Auth: magic link or email/password
│   └── calendar/page.tsx   # Main calendar view
├── components/
│   ├── MonthView.tsx       # Calendar month grid
│   ├── WeekView.tsx        # Week agenda view
│   ├── ListView.tsx        # Chronological list view
│   ├── EventModal.tsx      # Create/edit event modal
│   ├── TravelModal.tsx     # Travel details (flights, lodging, docs)
│   ├── KidFilter.tsx       # Kid filter + view toggle bar
│   └── ActivityFeed.tsx    # Sidebar: activity log + iCal info
├── hooks/
│   ├── useAuth.ts          # Auth session + profile
│   ├── useFamily.ts        # Kids + family members
│   ├── useEvents.ts        # Event CRUD + realtime + travel details
│   └── useActivityLog.ts   # Change log with realtime
├── lib/
│   ├── supabase.ts         # Supabase client initialization
│   ├── types.ts            # TypeScript types matching DB schema
│   ├── dates.ts            # Date utilities (date-fns wrappers)
│   └── ical.ts             # iCal generation + download
└── middleware.ts            # Auth route protection
```

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Database**: Supabase (Postgres)
- **Auth**: Supabase Auth (Magic Link + Email/Password)
- **Realtime**: Supabase Realtime (Postgres Changes)
- **Styling**: Tailwind CSS
- **Email**: Resend (via Supabase Edge Functions)
- **Fonts**: Fraunces (display) + DM Sans (body)
