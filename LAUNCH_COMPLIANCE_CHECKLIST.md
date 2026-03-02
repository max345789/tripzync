# Tripzync Launch Compliance Checklist

Use this checklist before Play Store and App Store submission.

## 1) Public legal URLs (hosted by backend)

- Privacy Policy: `https://tripzync.onrender.com/privacy-policy`
- Terms of Use: `https://tripzync.onrender.com/terms-of-use`
- Account Deletion: `https://tripzync.onrender.com/account-deletion`

## 2) Play Store requirements

- Complete **Data safety** form using actual app behavior.
- Add **Privacy Policy URL**.
- Add **Account deletion URL**.
- Complete **App content** declarations:
  - Ads
  - Target audience
  - News status
  - Data collection/disclosure
- Upload signed `.aab` and complete internal test rollout before production.

## 3) App Store requirements

- In App Store Connect:
  - Privacy policy URL
  - App privacy nutrition labels
  - Account deletion support details
- Ensure app provides an in-app account deletion path.
- Confirm Sign in with Apple rule compliance if third-party social login is re-enabled.

## 4) Backend production env minimum

- `NODE_ENV=production`
- `DATABASE_URL` (PostgreSQL)
- `JWT_SECRET` (>= 16 chars)
- `JWT_REFRESH_SECRET` (>= 16 chars)
- `CORS_ORIGIN` (no `*` in production)
- `OPENAI_API_KEY` (if AI generation is enabled)
- `SOCIAL_AUTH_ENABLED` (`false` unless Google/Apple IDs are configured)
- `GOOGLE_CLIENT_ID` (required only when social auth enabled)
- `APPLE_CLIENT_ID` (required only when social auth enabled)

## 5) Post-deploy smoke tests

- `GET /health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/generate-trip`
- `GET /api/trips?page=1&limit=10`
- `GET /api/trip/:id`
- `POST /api/trip/:id/regenerate`
- `DELETE /api/trip/:id`

