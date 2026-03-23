# Phase 1 - Step 4: Install Backend Dependencies

## Why Are We Doing This?

NestJS was scaffolded with only its core packages (HTTP server, routing, dependency injection). To build our platform, we need specialized packages for:

- **Database access** — Prisma ORM to talk to Neon PostgreSQL
- **Authentication** — JWT tokens, password hashing, Passport strategies
- **Validation** — Reject bad data before it hits business logic
- **API documentation** — Auto-generated Swagger docs
- **HTTP client** — Call the Python AI service from NestJS
- **WebSocket** — Real-time progress updates during report generation
- **LLM integration** — Groq SDK to call the AI for summaries/action plans
- **PDF generation** — Export reports as downloadable PDFs
- **Configuration** — Load environment variables (.env files) safely

Each package solves a specific problem. Let's go through them.

---

## The Command

```bash
cd /home/syrine/hr-insight-ai/backend

# Database ORM
npm install prisma @prisma/client

# Authentication
npm install @nestjs/passport passport passport-jwt @nestjs/jwt bcrypt

# Type definitions for auth (development only)
npm install -D @types/passport-jwt @types/bcrypt

# Validation
npm install class-validator class-transformer

# Configuration (env variables)
npm install @nestjs/config

# HTTP client (to call AI service)
npm install @nestjs/axios axios

# API documentation
npm install @nestjs/swagger

# WebSocket (real-time progress)
npm install @nestjs/websockets @nestjs/platform-socket.io socket.io

# Rate limiting
npm install @nestjs/throttler

# LLM integration
npm install groq-sdk

# PDF generation
npm install pdfmake
npm install -D @types/pdfmake
```

You can run them all at once if you prefer:

```bash
cd /home/syrine/hr-insight-ai/backend

npm install prisma @prisma/client @nestjs/passport passport passport-jwt @nestjs/jwt bcrypt class-validator class-transformer @nestjs/config @nestjs/axios axios @nestjs/swagger @nestjs/websockets @nestjs/platform-socket.io socket.io @nestjs/throttler groq-sdk pdfmake

npm install -D @types/passport-jwt @types/bcrypt @types/pdfmake
```

---

## What Each Package Does (and why you need it)

### Database: Prisma

| Package | Purpose |
|---------|---------|
| `prisma` | **CLI tool** — runs migrations, generates client, manages schema. You use it via `npx prisma ...` |
| `@prisma/client` | **Runtime library** — the actual code that queries the database. Auto-generated from your schema |

**Why Prisma over raw SQL or TypeORM?**
- **Type-safe queries**: Prisma generates TypeScript types from your schema. If you query `user.email`, TypeScript knows it's a string. With raw SQL, everything is `any`.
- **Schema-as-code**: Your database structure is defined in `schema.prisma`, not in SQL files. Prisma converts it to SQL automatically.
- **Migrations**: When you change the schema, Prisma generates migration files that safely update the database without losing data.
- **Auto-completion**: Your IDE shows available columns, relations, and filters as you type queries.

### Authentication: Passport + JWT + bcrypt

| Package | Purpose |
|---------|---------|
| `@nestjs/passport` | NestJS wrapper for Passport.js (the most popular Node.js auth library) |
| `passport` | Core auth middleware — handles the "who is this user?" question |
| `passport-jwt` | **Strategy** that reads JWT tokens from the `Authorization: Bearer xxx` header |
| `@nestjs/jwt` | NestJS wrapper for signing and verifying JWT tokens |
| `bcrypt` | Hashes passwords. Never store plain-text passwords — bcrypt converts "MyPassword123" into an irreversible hash like "$2b$10$X4..." |

**How auth works in our app:**
```
1. User sends POST /auth/login { email, password }
2. Backend finds user by email
3. bcrypt.compare(password, storedHash) → true/false
4. If true: sign JWT with { userId, role } → return token
5. User sends JWT in every future request: Authorization: Bearer eyJ...
6. passport-jwt extracts and verifies the token
7. If valid: request proceeds. If not: 401 Unauthorized
```

**What is a JWT (JSON Web Token)?**
A JWT is a signed string that contains user data. It looks like: `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signature`

It has 3 parts separated by dots:
- **Header**: algorithm used (HS256)
- **Payload**: user data (userId, email, role) — base64 encoded, NOT encrypted. Anyone can read it. But they can't modify it because...
- **Signature**: a cryptographic hash using your secret key. If someone changes the payload, the signature won't match and the server rejects it.

JWTs are **stateless** — the server doesn't store sessions. Every request carries its own proof of identity. This is why JWT is the standard for APIs.

### Validation: class-validator + class-transformer

| Package | Purpose |
|---------|---------|
| `class-validator` | Decorators like `@IsEmail()`, `@MinLength(8)`, `@IsNumber()` that validate incoming data |
| `class-transformer` | Converts plain JSON objects into class instances so decorators work |

**Example DTO (Data Transfer Object):**
```typescript
export class RegisterDto {
  @IsEmail()           // Must be a valid email format
  email: string;

  @IsString()
  @MinLength(8)        // Password at least 8 characters
  password: string;
}
```

If someone sends `{ email: "not-an-email", password: "hi" }`, NestJS automatically returns:
```json
{
  "statusCode": 400,
  "message": ["email must be an email", "password must be longer than or equal to 8 characters"]
}
```

No manual `if/else` validation needed. This is how enterprise apps handle input — **never trust client data**.

### Configuration: @nestjs/config

| Package | Purpose |
|---------|---------|
| `@nestjs/config` | Loads `.env` files and makes values accessible via `ConfigService` |

Instead of `process.env.DATABASE_URL` scattered everywhere, you inject `ConfigService` and call `configService.get('DATABASE_URL')`. Benefits:
- Type-safe access
- Default values
- Validation at startup (crash immediately if required vars are missing, don't wait until someone hits that code path)

### HTTP Client: @nestjs/axios

| Package | Purpose |
|---------|---------|
| `@nestjs/axios` | NestJS wrapper for Axios HTTP client |
| `axios` | The actual HTTP library |

This is how the backend calls the Python AI service:
```typescript
const response = await this.httpService.post('http://localhost:8000/predict', employeeData);
```

### API Documentation: @nestjs/swagger

| Package | Purpose |
|---------|---------|
| `@nestjs/swagger` | Auto-generates Swagger/OpenAPI docs from your controllers and DTOs |

Like FastAPI's `/docs`, this gives you interactive API documentation at `http://localhost:3000/api`. You can test every endpoint from the browser. It reads your decorators (`@Get`, `@Post`, DTOs) and builds the docs automatically.

### WebSocket: socket.io

| Package | Purpose |
|---------|---------|
| `@nestjs/websockets` | NestJS WebSocket module |
| `@nestjs/platform-socket.io` | Socket.IO adapter for NestJS |
| `socket.io` | The Socket.IO library (bidirectional real-time communication) |

**Why WebSocket instead of regular HTTP?**
HTTP is request-response: client asks, server answers, connection closes. But report generation takes 10-30 seconds and we want to show progress updates (10%... 40%... 80%...).

With WebSocket, the connection stays open. The server can push messages to the client at any time without the client asking. This is how you get a live progress bar.

### Rate Limiting: @nestjs/throttler

| Package | Purpose |
|---------|---------|
| `@nestjs/throttler` | Limits how many requests a user can make per time window |

Example: max 30 requests per minute. This prevents abuse — someone can't hammer your API with thousands of requests. Enterprise requirement.

### LLM: groq-sdk

| Package | Purpose |
|---------|---------|
| `groq-sdk` | Official Groq API client — calls LLM models for text generation |

Groq runs LLMs (like Llama 3.3 70B) extremely fast. The SDK handles authentication, request formatting, and streaming. We use it to generate executive summaries and structured action plans.

### PDF: pdfmake

| Package | Purpose |
|---------|---------|
| `pdfmake` | Generates PDF documents from JavaScript objects |

Unlike Puppeteer (which needs a headless browser), pdfmake is pure JavaScript — it's lightweight and fast. You define the document as a JSON structure (headers, paragraphs, tables) and it outputs a PDF buffer.

### Dev Dependencies: @types/*

| Package | Purpose |
|---------|---------|
| `@types/passport-jwt` | TypeScript type definitions for passport-jwt |
| `@types/bcrypt` | TypeScript type definitions for bcrypt |
| `@types/pdfmake` | TypeScript type definitions for pdfmake |

These are installed with `-D` (devDependency) because they're only needed during development for TypeScript compilation. They don't ship in production.

---

## How to Verify It Worked

**Step A: Check package.json**

```bash
cd /home/syrine/hr-insight-ai/backend
cat package.json | grep -c "dependencies"
```

You should see `2` — one for `dependencies` and one for `devDependencies`.

**Step B: Verify key packages are listed**

```bash
cat package.json | grep prisma
cat package.json | grep passport
cat package.json | grep groq
cat package.json | grep socket.io
```

Each should return a line showing the package and its version.

**Step C: Make sure the backend still starts**

```bash
npm run start:dev
```

The backend should still start and show "Nest application successfully started". The new packages are installed but not yet imported — so no errors expected. If you see errors, it means a package had a dependency conflict. Let me know.

**Step D: Stop the server** with `Ctrl+C`.

---

## What's the `-D` Flag?

When you see `npm install -D`, the `-D` means **devDependency**. These are packages needed only during development (type definitions, testing tools, linters). They are NOT included when building for production. Regular `npm install` packages are runtime dependencies — they're needed both during development and production.

In `package.json`, you'll see two sections:
```json
{
  "dependencies": {      // Runtime — shipped to production
    "prisma": "^5.x",
    "@nestjs/jwt": "^10.x"
  },
  "devDependencies": {   // Dev only — NOT shipped to production
    "@types/bcrypt": "^5.x"
  }
}
```

---

## Checklist (confirm before moving to Step 5)

- [ ] All `npm install` commands completed without errors
- [ ] `package.json` contains prisma, @nestjs/passport, groq-sdk, socket.io, pdfmake
- [ ] `npm run start:dev` still starts successfully
- [ ] Server stops cleanly with Ctrl+C

---

Once confirmed, I'll generate **Step 5: Install Frontend Dependencies**.
