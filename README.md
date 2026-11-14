# 🔐 CaseVault

### Secure Case & Document Management System

CaseVault is a web-based platform for securely storing, organizing, and sharing case documents. It combines case management, role-based access control, team collaboration, and a full audit trail in one dashboard, backed by Supabase.
App Link- https://case-vault-smoky.vercel.app/ 
## ✨ Features

### 📁 Document Management
* Upload documents to private storage (PDF, images, Word, Excel, PowerPoint, text, CSV, ZIP; up to 25 MB).
* Organize documents by case and category.
* Version tracking and controlled overwrite.
* Download through short-lived signed URLs.
* Per-document permissions (view, upload, edit, download).

### 📂 Case Management
* Create, view, and manage cases with auto-generated case numbers.
* Track status (Open, In Review, Closed, Archived) and priority.
* Assign cases and manage case teams.
* Searchable case list and dashboard.

### 🔑 Authentication & Access Control
* Real Supabase Auth sessions (no client-side credentials).
* Roles: `admin`, `investigator`, `officer`, `analyst`, stored in the `profiles` table.
* Multi-factor authentication with TOTP (authenticator app). Admins must enrol on first login.
* Role changes can only be made by an existing admin.

### 🛡️ Security & Audit
* PostgreSQL Row Level Security (RLS) on all tables.
* Private Supabase Storage bucket with path-based storage policies.
* Activity log per case and a global audit history.
* Two-admin approval workflow for permanent deletions.

## 🛠️ Tech Stack

| Technology   | Purpose                                   |
| ------------ | ----------------------------------------- |
| React        | Frontend UI                               |
| TypeScript   | Type safety                               |
| Vite         | Development and build tool                |
| Tailwind CSS | Styling                                   |
| Supabase     | Authentication, database and file storage |
| Lucide React | Icons                                     |

## 📂 Project Structure

```text
casevault/
├── src/
│   ├── components/     # UI screens and widgets
│   ├── context/        # Auth provider (Supabase session + MFA)
│   ├── hooks/
│   ├── lib/            # Supabase client, database and storage helpers
│   ├── types/
│   ├── app.tsx
│   └── main.tsx
├── supabase/
│   ├── migrations/     # Schema, RLS and storage policies (run in order)
│   └── seed.sql        # Optional local-only demo users
├── .env.example
├── package.json
└── README.md
```

## ⚙️ Getting Started

### Prerequisites
* Node.js (LTS) and npm
* Git
* A Supabase account and project

### 1. Clone and install

```bash
git clone https://github.com/nk0273926/casevault.git
cd casevault
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` in the project root and fill in your values from **Supabase → Project Settings → API Keys**:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
```

* Use the base project URL only (no `/rest/v1/` at the end).
* Use the **publishable / anon** key. **Never** put the secret / `service_role` key in the app or commit it.
* Restart `npm run dev` after changing `.env`.

### 3. Set up the database

In the Supabase **SQL Editor**, run every file in `supabase/migrations/` in filename order:

1. `20260822172014_create_case_management_schema.sql`
2. `20260822172036_create_storage_bucket.sql`
3. `20260823065358_add_rbac_schema.sql`
4. `20260823120000_security_hardening.sql`
5. `20260823130000_security_hardening_v2.sql`
6. `20260823140000_security_hardening_v3.sql`
7. `20260823150000_safe_storage_policies.sql`

Afterwards, confirm no public (`anon`) policies remain:

```sql
select count(*) from pg_policies where 'anon' = any(roles);  -- should be 0
```

### 4. Create your first admin

1. Supabase → **Authentication → Users → Add user → Create new user** (tick **Auto Confirm User**).
2. In the SQL Editor, promote the user:

```sql
update profiles set role = 'admin' where email = 'you@example.com';
```

New users start as `analyst`. To change a role later, update `profiles.role` (admins only). `supabase/seed.sql` can create demo users for **local development only**; it contains known demo passwords, so never run it against a real project.

### 5. Run the app

```bash
npm run dev
```

Sign in with your admin account. On first login an admin is asked to scan a QR code with an authenticator app (Google Authenticator, Authy, etc.) and enter a 6-digit code. Later logins only ask for the code.

## 🧪 Available Scripts

| Command             | Description                  |
| ------------------- | ---------------------------- |
| `npm run dev`       | Start development server     |
| `npm run build`     | Build production application |
| `npm run preview`   | Preview production build     |
| `npm run lint`      | Run ESLint                   |
| `npm run typecheck` | Check TypeScript types       |

## 👥 Roles at a Glance

| Role         | Access                                                         |
| ------------ | -------------------------------------------------------------- |
| Admin        | All cases and users, approvals, audit history                  |
| Investigator | Cases they belong to; can upload and edit documents            |
| Officer      | Cases they belong to; view access, extra rights if granted     |
| Analyst      | Cases they belong to; view-only by default                     |

Non-admin users only see cases where they are on the case team. Document-level permissions can grant or restrict individual actions.

## 🔒 Security Notes

* Identity and role come from the Supabase session and the `profiles` table, never from browser storage.
* All tables use RLS; files live in a private bucket and are served through signed URLs.
* Keep `.env` out of Git (it is already in `.gitignore`).
* MFA is currently enforced in the app. For stricter protection, add `aal2` checks to your RLS policies.
* Review and test all authentication, database, and storage policies before storing real confidential documents.

## 🚧 Project Status

CaseVault is under active development. Core features (authentication, MFA, cases, documents, permissions, audit) are working, but the project still needs broader testing and production hardening (for example, an in-app user/role editor and backup/recovery planning).

## 👨‍💻 Author

**Nikhil Kumar** · GitHub: [@nk0273926](https://github.com/nk0273926)

---

<p align="center">Built with React, TypeScript and Supabase.</p>
