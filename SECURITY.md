# Security policy

## Reporting a vulnerability

Please do not disclose credentials, customer data, access tokens, or exploit details in a public issue.

If private vulnerability reporting is available for this repository, use the repository's GitHub **Security** tab and choose **Report a vulnerability**. If that option is unavailable, do not post sensitive details publicly; use a private maintainer channel provided by the repository owner.

Include the affected file or component, the smallest reliable reproduction, the impact, and any suggested mitigation. Redact secrets from logs and examples.

## Scope

The browser app currently stores data in local browser storage and has no authentication or shared backend. The server-side LINE adapter and Supabase schema are reference integration components; deploy them only after reviewing credentials, access control, row-level security, retries, and logging for the target environment.
