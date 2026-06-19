# Demo Request Flow

1. Prospect submits the expression-of-interest form on `index.html`.
2. The request is stored in `public.demo_requests`.
3. A live `super_admin` opens `Demo Requests` in the platform workspace.
4. The request is approved and a private link is generated in `public.demo_access_links`.
5. The forwarded link points to `demo-access.html` and expires 7 days after issue.
6. The token is stored as a SHA-256 hash in the database, not as raw text.
