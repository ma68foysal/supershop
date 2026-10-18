# Setting up Dokan

## 1. Database (once)
1. Supabase dashboard → **SQL Editor** → New query.
2. Paste all of [`supabase/schema.sql`](../supabase/schema.sql) → **Run**.
   Then run each file in [`supabase/migrations`](../supabase/migrations) in number order.
3. Optional, so the shop opens/closes on schedule even when nobody has the app open:
   **Database → Extensions** → enable `pg_cron`, then run
   `select cron.schedule('dokan-auto-tick', '*/5 * * * *', 'select public.auto_tick()');`
   (Without it, the schedule is still applied whenever someone opens the app, and an
   automatic close is stamped with the scheduled closing time.)

## 2. Owner login (once)
1. **Authentication → Users → Add user → Create new user**.
2. Your email + a password, tick **Auto Confirm User**.
   The first user created becomes the **owner**. Staff are added later from the app's Settings screen.
3. **Authentication → Sign In / Providers** → turn off **Allow new users to sign up**,
   so nobody else can create an account.

## 3. Keys
`.env.local` (never committed) holds:
```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...        # server only, used to create staff logins
GEMINI_API_KEY=...                       # server only, for the in-app assistant (free key from aistudio.google.com)
```
Optional: `GEMINI_BACKUP_API_KEYS=key2,key3` — keys from other Google accounts, used only when every
model on the main key is busy or out for the day. Google's terms limit using extra accounts to get past
free-tier limits, so these accounts may be suspended if Google notices; use them as an emergency backup.
Optional: `GEMINI_MODELS=gemini-3.5-flash,gemini-3.1-flash-lite,gemini-3.8-flash` changes which
Gemini models the assistant tries, in order. Without `GEMINI_API_KEY` the app works; only the assistant
says it isn't set up.
Supabase → **Project Settings → API Keys** has them.

## 4. Run
```bash
npm run dev
```
Open http://localhost:3000 and sign in with the owner email.
First steps in the app: Settings (shop name, address, hours) → Products → Open shop → Sell.

## 5. Deploy to Vercel
1. Push the repo to GitHub, import it in Vercel.
2. Add the same variables (Supabase keys and `GEMINI_API_KEY`) in **Project → Settings → Environment Variables**.
3. Deploy, then open the site on each phone and use **Add to Home screen**.

## Staff logins
Owner → Settings → Staff → name, username, password. The person signs in with the username
(e.g. `rahim`) — no email needed. Turn a login off any time from the same list.
