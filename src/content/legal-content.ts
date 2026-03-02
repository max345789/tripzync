const baseStyles = `
  :root {
    color-scheme: light;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.6;
    color: #0f172a;
    background: #f8fafc;
  }
  body {
    margin: 0;
    padding: 24px;
    background: #f8fafc;
  }
  main {
    max-width: 840px;
    margin: 0 auto;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    padding: 28px;
  }
  h1, h2 {
    line-height: 1.3;
    color: #0b1324;
  }
  a {
    color: #2563eb;
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
  code {
    background: #f1f5f9;
    padding: 2px 6px;
    border-radius: 6px;
  }
`;

function wrapHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${baseStyles}</style>
</head>
<body>
  <main>
    ${body}
  </main>
</body>
</html>`;
}

export const indexPageHtml = wrapHtml(
  "Tripzync Backend",
  `
    <h1>Tripzync Backend</h1>
    <p>This service powers Tripzync mobile apps.</p>
    <h2>Public URLs</h2>
    <ul>
      <li><a href="/health">/health</a></li>
      <li><a href="/privacy-policy">/privacy-policy</a></li>
      <li><a href="/terms-of-use">/terms-of-use</a></li>
      <li><a href="/account-deletion">/account-deletion</a></li>
    </ul>
  `
);

export const privacyPolicyHtml = wrapHtml(
  "Tripzync Privacy Policy",
  `
    <h1>Privacy Policy</h1>
    <p><strong>Effective date:</strong> March 3, 2026</p>
    <p>Tripzync ("we", "us") provides travel itinerary planning services.</p>

    <h2>Information We Collect</h2>
    <ul>
      <li>Account information: email, password hash, optional profile name.</li>
      <li>Trip content: destination, itinerary preferences, generated activities, and optional start city/location.</li>
      <li>Technical data: request metadata for security, reliability, and abuse prevention.</li>
    </ul>

    <h2>How We Use Data</h2>
    <ul>
      <li>To create and manage your itinerary data.</li>
      <li>To secure accounts and prevent abuse.</li>
      <li>To improve service quality and reliability.</li>
    </ul>

    <h2>Data Sharing</h2>
    <p>We do not sell personal data. We may use infrastructure vendors (hosting, database, analytics, AI providers) only to operate the service.</p>

    <h2>Data Retention</h2>
    <p>We retain account and trip data while your account is active, or as needed for legal and security obligations.</p>

    <h2>Your Choices</h2>
    <ul>
      <li>Access and update profile/trip data from the app.</li>
      <li>Request account deletion via the app or the process at <a href="/account-deletion">/account-deletion</a>.</li>
    </ul>

    <h2>Security</h2>
    <p>We use reasonable technical and organizational safeguards to protect stored data and service access.</p>

    <h2>Contact</h2>
    <p>For privacy requests, contact: <a href="mailto:support@tripzync.app">support@tripzync.app</a>.</p>
  `
);

export const termsOfUseHtml = wrapHtml(
  "Tripzync Terms of Use",
  `
    <h1>Terms of Use</h1>
    <p><strong>Effective date:</strong> March 3, 2026</p>
    <p>By using Tripzync, you agree to these terms.</p>

    <h2>Service Scope</h2>
    <p>Tripzync provides itinerary planning suggestions for informational use. Actual travel conditions may differ.</p>

    <h2>User Responsibilities</h2>
    <ul>
      <li>Provide accurate account information.</li>
      <li>Use the service lawfully.</li>
      <li>Verify schedules, transit, and venue availability independently.</li>
    </ul>

    <h2>Availability</h2>
    <p>We may update, suspend, or discontinue parts of the service to maintain reliability and security.</p>

    <h2>Liability</h2>
    <p>The service is provided "as is". To the extent allowed by law, Tripzync is not liable for indirect or consequential losses from use of itinerary suggestions.</p>

    <h2>Termination</h2>
    <p>We may suspend accounts involved in abuse or policy violations. You may stop using the service at any time.</p>

    <h2>Contact</h2>
    <p>Questions can be sent to <a href="mailto:support@tripzync.app">support@tripzync.app</a>.</p>
  `
);

export const accountDeletionHtml = wrapHtml(
  "Tripzync Account Deletion",
  `
    <h1>Account Deletion</h1>
    <p>You can permanently delete your Tripzync account and trip data.</p>

    <h2>In-App Method</h2>
    <ol>
      <li>Open Tripzync.</li>
      <li>Go to <code>Profile</code> and choose <code>Delete Account</code>.</li>
      <li>Confirm deletion.</li>
    </ol>

    <h2>Email Method</h2>
    <p>If app access is unavailable, send a request from your registered email to <a href="mailto:support@tripzync.app">support@tripzync.app</a> with subject <code>Account Deletion Request</code>.</p>

    <h2>Processing Timeline</h2>
    <p>Deletion requests are typically processed within 7 business days.</p>

    <h2>What Gets Deleted</h2>
    <ul>
      <li>Account profile and login identity.</li>
      <li>Stored trips and itinerary data associated with the account.</li>
    </ul>

    <h2>What May Be Retained</h2>
    <p>Minimal operational/security records may be retained only where required by law or for fraud prevention.</p>
  `
);
