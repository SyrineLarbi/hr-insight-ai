# Phase 1 - Step 2: Scaffold the Next.js Frontend

## Why Are We Doing This?

Next.js is a **React framework** for building web applications. If NestJS is the brain, Next.js is the **face** — it's what HR users see and interact with in their browser: the login form, the dashboard, the charts, the "Generate Insight" button.

**Why Next.js specifically (and not plain React)?**
- **File-based routing** — every file inside `app/` automatically becomes a URL route. Create `app/dashboard/page.tsx` and you get `localhost:3000/dashboard`. No manual router configuration needed.
- **Server-side rendering (SSR)** — pages can load data on the server before sending HTML to the browser. This makes the app feel faster and is better for SEO.
- **Built-in API routes** — you can create backend endpoints inside the Next.js app itself (we won't use this since we have NestJS, but it's nice to know).
- **TypeScript support** out of the box — same language as your backend, reducing context switching.
- Used by Netflix, TikTok, Hulu, Nike — enterprise-proven.

**Why Ant Design (antd)?**
- Ant Design is a **complete enterprise UI component library** made by Alibaba. It gives you pre-built, professionally styled components: Tables, Forms, Modals, DatePickers, Charts, Menus, Layouts — everything an HR dashboard needs.
- **Why not Tailwind + custom components?** Tailwind is great for custom designs, but you'd spend weeks building a sortable Table or a DateRangePicker from scratch. Antd gives you these ready-made with accessibility, internationalization, and dark mode support. In corporate apps, speed > custom aesthetics.
- antd uses `dayjs` for dates (not `moment.js` which is heavy and deprecated).



---

## What You Need Before Starting

You already have Node.js and npm from Step 1. No additional global installs needed.

Verify you're in the right directory:
```bash
ls /home/syrine/hr-insight-ai/
```

You should see the `backend/` folder from Step 1 and the `docs/` folder.

---

## The Command

```bash
cd /home/syrine/hr-insight-ai
npx create-next-app@latest frontend --typescript --tailwind --eslint --app --src-dir --no-import-alias --no-git
```

**Breaking down the command:**


| Part | What it does |
|------|-------------|
| `npx create-next-app@latest` | Runs the latest Next.js project scaffolder without installing it globally |
| `frontend` | Creates the project inside a `frontend/` folder |
| `--typescript` | Use TypeScript (not JavaScript) |
| `--tailwind` | Include Tailwind CSS (we'll use it alongside antd for custom spacing/layout tweaks) |
| `--eslint` | Include ESLint for code quality checks |
| `--app` | Use the **App Router** (Next.js 13+ modern routing system, not the old Pages Router) |
| `--src-dir` | Put source code inside `src/` folder (keeps root clean) |
| `--no-import-alias` | Don't set up path aliases like `@/` (keeps imports simple) |

**What's `npx` vs `npm`?**
- `npm install` downloads a package to your project
- `npx` runs a package **once** without installing it permanently. Perfect for scaffolding tools you only use once.

The scaffolder will download the template and install dependencies. Takes 1-3 minutes.

---

## What Files Get Created (and what they mean)

```
frontend/
  src/
    app/
      layout.tsx       # ROOT LAYOUT — wraps every page (think: HTML skeleton)
      page.tsx         # HOME PAGE — what renders at localhost:3000/
      globals.css      # Global styles (Tailwind imports live here)
      favicon.ico      # Browser tab icon

  public/              # Static files (images, fonts) — served as-is
  node_modules/        # Installed packages (don't touch)
  package.json         # Dependencies + scripts
  tsconfig.json        # TypeScript config
  tailwind.config.ts   # Tailwind CSS configuration
  next.config.ts       # Next.js configuration
  postcss.config.mjs   # CSS processing config (Tailwind needs this)
  .eslintrc.json       # Linting rules
```

### Key concepts:

**`app/layout.tsx`** — The **root layout**. Every page in your app is wrapped by this file. It contains the `<html>` and `<body>` tags. Later, this is where we'll add the antd ConfigProvider (theme), the auth provider, and the sidebar/header layout.

**`app/page.tsx`** — The **home page**. When someone visits `localhost:3000/`, this file renders. Right now it shows the Next.js welcome page. We'll later redirect this to `/login` or `/dashboard`.

**`app/globals.css`** — Global CSS. Currently has Tailwind's `@tailwind base; @tailwind components; @tailwind utilities;` imports. Antd brings its own styles, so these will work together.

**How routing works in Next.js App Router:**
```
src/app/page.tsx           →  localhost:3000/
src/app/login/page.tsx     →  localhost:3000/login
src/app/dashboard/page.tsx →  localhost:3000/dashboard
src/app/teams/page.tsx     →  localhost:3000/teams
src/app/teams/[id]/page.tsx → localhost:3000/teams/abc-123  (dynamic route)
```

Every folder inside `app/` that contains a `page.tsx` becomes a route. The folder name IS the URL path. The `[id]` syntax means "any value" — it's a dynamic parameter (like a team ID).

---

## How to Verify It Worked

**Step A: Start the dev server**
```bash
cd /home/syrine/hr-insight-ai/frontend
npm run dev
```


**Expected terminal output (look for this):**
```
  ▲ Next.js 15.x.x
  - Local:        http://localhost:3001

  ✓ Starting...
  ✓ Ready in Xs
```

**Step B: Open in browser**

Open your browser and go to: **http://localhost:3001**

You should see the **Next.js welcome page** — a dark page with the Next.js logo and some links. This confirms the frontend is running.

**Step C: Test that it's a different service from the backend**

Remember: the backend (NestJS) runs on port 3000 too by default. That's why we'll change the backend to port 3001 later. For now, **don't run both at the same time** — they'd fight over port 3000.

**Step D: Stop the server**
Press `Ctrl+C` in the terminal.

---

## Understanding the Relationship: Frontend vs Backend

```
┌─────────────────────────────┐
│  BROWSER (User's computer)  │
│                             │
│  Next.js Frontend           │
│  localhost:3000             │
│                             │
│  - Shows login form         │
│  - Shows dashboard          │
│  - Shows charts             │
│  - Sends HTTP requests ─────┼──→  NestJS Backend
│                             │     localhost:3001
└─────────────────────────────┘
                                    - Validates JWT
                                    - Queries database
                                    - Calls AI service
                                    - Returns JSON data
```

The frontend **never touches the database directly**. It always asks the backend for data via HTTP requests (using `axios`). The backend is the gatekeeper — it checks authentication, enforces RBAC, and returns only what the user is allowed to see.

This is called a **client-server architecture** and it's how every production web app works.

---

## Checklist (confirm before moving to Step 3)

- [ ] `frontend/` folder exists inside `/home/syrine/hr-insight-ai/`
- [ ] `npm run dev` starts without errors
- [ ] Browser shows the Next.js welcome page at `http://localhost:3000`
- [ ] Server stops cleanly with Ctrl+C
- [ ] You now have 3 folders: `backend/`, `frontend/`, `docs/`

---

Once you've confirmed all checkboxes, tell me and I'll generate **Step 3: Create the Python FastAPI AI Service**.
