# Phase 1 - Step 1: Scaffold the NestJS Backend

## Why Are We Doing This?

NestJS is a **Node.js framework for building server-side applications**. Think of it as the "brain" of our app — it handles:
- User authentication (login/register)
- Business logic (fetching employees, computing analytics)
- Orchestrating the AI pipeline (calling FastAPI + Groq LLM)
- Serving data to the frontend via REST APIs

**Why NestJS specifically (and not Express)?**
- NestJS uses **modules** — it forces you to organize code into separate, focused pieces (AuthModule, TeamsModule, ReportsModule). Express lets you throw everything in one file.
- It has **built-in dependency injection** — modules can share services without messy imports. This matters when 5+ services need database access.
- **Decorators** (@Controller, @Get, @Post, @UseGuards) make code readable and declarative.
- **TypeScript by default** — catches errors at compile time, not at 3am in production.
- It's what enterprise companies use (Adidas, Roche, Capgemini).

**Why `--skip-git`?**
You said no git. NestJS CLI normally creates a `.git` folder and initializes a repo. `--skip-git` tells it not to.

---

## What You Need Before Starting

Make sure you have these installed. Run each command in your terminal:

```bash
# Check Node.js version (need v18+)
node --version

# Check npm version
npm --version

# Check NestJS CLI (should be installed globally)
nest --version
```

**If NestJS CLI is NOT installed**, run this first:
```bash
npm install -g @nestjs/cli
```

---

## The Command

```bash
cd /home/syrine/hr-insight-ai
nest new backend --package-manager npm 
```

**Breaking down the command:**
| Part | What it does |
|------|-------------|
| `cd /home/syrine/hr-insight-ai` | Navigate to your project root |
| `nest new backend` | Create a new NestJS project inside a `backend/` folder |
| `--package-manager npm` | Use npm (not yarn or pnpm) for installing packages |
| `--skip-git` | Don't initialize a git repository |

The CLI will create the folder, generate skeleton files, and install default packages. Takes 1-2 minutes.

---

## What Files Get Created (and what they mean)

```
backend/
  src/
    main.ts                # ENTRY POINT — boots the server
    app.module.ts          # ROOT MODULE — master list of all feature modules
    app.controller.ts      # Sample controller (handles HTTP GET /)
    app.controller.spec.ts # Test for the controller
    app.service.ts         # Sample service (business logic)
  test/
    app.e2e-spec.ts        # End-to-end test template
    jest-e2e.json          # Test config
  node_modules/            # All installed packages (don't touch)
  package.json             # Dependencies + scripts
  tsconfig.json            # TypeScript config
  nest-cli.json            # NestJS CLI config
  .eslintrc.js             # Code linting rules
  .prettierrc              # Code formatting rules
```

### Key concepts:

**`main.ts`** — The entry point. When you run the server, Node.js executes this file first. It creates the NestJS app and starts listening for HTTP requests. Default port is 3000 (we'll change to 3001 later so it doesn't clash with the frontend).

**`app.module.ts`** — The root module. In NestJS, everything is organized into **modules**. Each module handles one feature (Auth, Teams, etc.). The root module imports all other modules. Think of it as the app's table of contents.

**`app.controller.ts`** — Controllers handle **incoming HTTP requests** and return responses. The sample controller responds to `GET /` with "Hello World!". Later we'll create controllers for `/auth/login`, `/teams`, `/employees`, etc.

**`app.service.ts`** — Services contain **business logic**. Controllers are thin — they receive the request, call a service, and return the result. This separation (Controller → Service → Database) is called the **layered architecture** pattern.

---

## How to Verify It Worked

**Step A: Start the server**
```bash
cd /home/syrine/hr-insight-ai/backend
npm run start:dev
```

`npm run start:dev` compiles TypeScript and starts the server with **hot reload** — meaning when you edit a file, the server restarts automatically.

**Expected terminal output (look for this line):**
```
Nest application successfully started
```

**Step B: Test the endpoint** (open a NEW terminal, keep the server running)
```bash
curl http://localhost:3000
```

**Expected response:**
```
Hello World!
```

If you see "Hello World!" — the backend is scaffolded and running correctly.

**Step C: Stop the server**
Press `Ctrl+C` in the terminal where the server is running.
