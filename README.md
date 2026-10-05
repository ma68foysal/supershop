# Supershop (Dokan)

Phone-first sales recorder for a neighbourhood grocery. No barcode scanner needed:
record a sale as a total only (৳100) or item by item like a super shop. Open and close
the shop by hand or on a schedule, and get a PDF report for every day that compares with
previous days. Every sale is cash in hand.

Built with Next.js 16, Supabase and Vercel.

- Setup and deployment: [docs/SETUP.md](docs/SETUP.md)
- Project plan: [docs/PLAN.md](docs/PLAN.md)
- Database schema: [supabase/schema.sql](supabase/schema.sql)
- Design prototype: [docs/design/prototype.html](docs/design/prototype.html)

## Run locally

```bash
npm install
npm run dev
```

Needs a `.env.local` with the Supabase keys (see SETUP.md). Never commit that file.
