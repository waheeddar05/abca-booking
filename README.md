This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Admin Access

To create the first admin user, you have two options:

### Option 1: Using Environment Variables (Recommended for New Installations)
Add the following to your `.env` file:
```env
INITIAL_ADMIN_EMAIL="your-email@example.com"
INITIAL_ADMIN_MOBILE="+1234567890"
```
When a user signs in for the first time with this email (via Google) or mobile number (via OTP), they will automatically be granted the `ADMIN` role.

### Option 2: Using the Bootstrap Script (For Existing Users)
If you have already created a user and want to promote them to admin, run the following command in your terminal:
```bash
npx tsx scripts/make-admin.ts <email_or_mobile_number>
```
Example:
```bash
npx tsx scripts/make-admin.ts admin@example.com
```
Once promoted, the "Admin" link will appear in the navigation bar after the user logs in again.

## Deployment to Vercel

To deploy this application to Vercel, follow these steps:

1.  **Push your code to GitHub/GitLab/Bitbucket.**
2.  **Import your repository into Vercel.**
3.  **Configure Environment Variables** in the Vercel project settings:
    *   `DATABASE_URL`: Your PostgreSQL connection string (e.g., from Supabase or Vercel Postgres).
    *   `NEXTAUTH_SECRET`: A random secret string for session encryption (you can generate one using `openssl rand -base64 32`).
    *   `NEXTAUTH_URL`: Your production URL (e.g., `https://your-app.vercel.app`).
    *   `GOOGLE_CLIENT_ID`: Your Google OAuth Client ID.
    *   `GOOGLE_CLIENT_SECRET`: Your Google OAuth Client Secret.
    *   `JWT_SECRET`: Secret for signing custom JWTs (used for OTP auth).
    *   `FAST2SMS_API_KEY`: API key for SMS service (if using OTP auth).
    *   `INITIAL_ADMIN_EMAIL`: (Optional) Email that will be granted admin access on first login.
    *   `INITIAL_ADMIN_MOBILE`: (Optional) Mobile number that will be granted admin access on first login.
    *   `OTP_TTL_MINUTES`: (Optional) Minutes before OTP expires (default: 10).
4.  **Automatic Build Configuration**:
    *   The `package.json` includes a `postinstall` script (`prisma generate`) that ensures the Prisma client is generated during the build process on Vercel.
    *   Vercel will automatically detect Next.js and use `npm run build` to build the project.

## Creator

This project was created by **Waheed**.
